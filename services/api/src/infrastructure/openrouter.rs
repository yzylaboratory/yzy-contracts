//! Client for OpenRouter's chat completions API, used to read document images
//! and PDFs into JSON that follows a strict schema.

use std::{env, time::Duration};

use anyhow::{Context, bail};
use base64::{Engine, engine::general_purpose::STANDARD};
use reqwest::{
    Client, StatusCode, Url,
    header::{AUTHORIZATION, HeaderValue},
    redirect::Policy,
};
use serde::Deserialize;
use serde_json::{Value, json};

use crate::error::ApiError;

const OPENROUTER_BASE_URL: &str = "https://openrouter.ai/api/v1";
/// Shown in OpenRouter's dashboard to attribute the usage.
const APP_TITLE: &str = "YZY Contracts";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AttachmentKind {
    Jpeg,
    Png,
    Webp,
    Pdf,
}

impl AttachmentKind {
    pub fn from_mime(mime_type: &str) -> Option<Self> {
        match mime_type {
            "image/jpeg" | "image/jpg" => Some(Self::Jpeg),
            "image/png" => Some(Self::Png),
            "image/webp" => Some(Self::Webp),
            "application/pdf" => Some(Self::Pdf),
            _ => None,
        }
    }

    pub fn mime_type(self) -> &'static str {
        match self {
            Self::Jpeg => "image/jpeg",
            Self::Png => "image/png",
            Self::Webp => "image/webp",
            Self::Pdf => "application/pdf",
        }
    }

    pub fn matches_signature(self, bytes: &[u8]) -> bool {
        match self {
            Self::Jpeg => bytes.starts_with(&[0xFF, 0xD8, 0xFF]),
            Self::Png => bytes.starts_with(b"\x89PNG\r\n\x1a\n"),
            Self::Webp => bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP",
            Self::Pdf => bytes.starts_with(b"%PDF-"),
        }
    }
}

pub struct Attachment {
    pub kind: AttachmentKind,
    pub file_name: String,
    pub bytes: Vec<u8>,
}

/// What one schema-constrained reading needs from the caller.
pub struct ReadingRequest<'a> {
    pub instructions: &'a str,
    pub schema_name: &'a str,
    pub schema: Value,
    pub attachments: &'a [Attachment],
}

#[derive(Clone)]
pub struct DocumentReader {
    client: Client,
    endpoint: Url,
    api_key: HeaderValue,
    model: String,
}

impl DocumentReader {
    /// All three variables or none: without them the route answers 503.
    pub fn from_env() -> anyhow::Result<Option<Self>> {
        let api_key = optional_env("OPENROUTER_API_KEY")?;
        let model = optional_env("OPENROUTER_MODEL")?;
        let timeout = optional_env("OPENROUTER_TIMEOUT_SECS")?;
        match (api_key, model, timeout) {
            (None, None, None) => Ok(None),
            (Some(api_key), Some(model), Some(timeout)) => {
                let seconds: u64 = timeout
                    .trim()
                    .parse()
                    .ok()
                    .filter(|seconds| *seconds > 0)
                    .context("OPENROUTER_TIMEOUT_SECS must be a positive number of seconds")?;
                Self::new(
                    OPENROUTER_BASE_URL,
                    &api_key,
                    &model,
                    Duration::from_secs(seconds),
                )
                .map(Some)
            }
            _ => bail!(
                "OPENROUTER_API_KEY, OPENROUTER_MODEL and OPENROUTER_TIMEOUT_SECS must be configured together"
            ),
        }
    }

    pub fn new(
        base_url: &str,
        api_key: &str,
        model: &str,
        timeout: Duration,
    ) -> anyhow::Result<Self> {
        let base = Url::parse(base_url).context("Invalid OpenRouter base URL")?;
        if !matches!(base.scheme(), "http" | "https") || !base.has_host() {
            bail!("Invalid OpenRouter base URL");
        }
        let endpoint = Url::parse(&format!(
            "{}/chat/completions",
            base.as_str().trim_end_matches('/')
        ))
        .context("Invalid OpenRouter endpoint")?;
        if api_key.trim().is_empty() {
            bail!("OPENROUTER_API_KEY must not be empty");
        }
        if model.trim().is_empty() {
            bail!("OPENROUTER_MODEL must not be empty");
        }
        let mut api_key = HeaderValue::from_str(&format!("Bearer {}", api_key.trim()))
            .context("Invalid OPENROUTER_API_KEY")?;
        api_key.set_sensitive(true);
        let client = Client::builder()
            .redirect(Policy::none())
            .timeout(timeout)
            .build()
            .context("Could not configure OpenRouter client")?;
        Ok(Self {
            client,
            endpoint,
            api_key,
            model: model.trim().to_owned(),
        })
    }

    pub fn model(&self) -> &str {
        &self.model
    }

    /// Returns the JSON object the model produced. The caller checks it
    /// against its own types; the schema only constrains generation.
    pub async fn read(&self, request: ReadingRequest<'_>) -> Result<Value, ApiError> {
        let body = self.request_body(&request);
        let response = self
            .client
            .post(self.endpoint.clone())
            .header(AUTHORIZATION, self.api_key.clone())
            .header("X-Title", APP_TITLE)
            .json(&body)
            .send()
            .await
            .map_err(transport_error)?;

        let status = response.status();
        if !status.is_success() {
            tracing::warn!(status = status.as_u16(), "OpenRouter rejected the reading");
            return Err(match status {
                StatusCode::REQUEST_TIMEOUT | StatusCode::GATEWAY_TIMEOUT => ApiError::Timeout,
                StatusCode::PAYLOAD_TOO_LARGE => ApiError::PayloadTooLarge,
                _ => ApiError::DocumentReaderUnavailable,
            });
        }
        let completion: Completion = response.json().await.map_err(|error| {
            tracing::warn!(error = %error, "OpenRouter returned an unexpected body");
            ApiError::DocumentReaderUnavailable
        })?;
        // OpenRouter can answer 200 with an error object when the provider fails mid-stream.
        if let Some(error) = completion.error {
            tracing::warn!(code = ?error.code, "OpenRouter provider error");
            return Err(ApiError::DocumentReaderUnavailable);
        }
        let choice = completion
            .choices
            .into_iter()
            .next()
            .ok_or(ApiError::DocumentReaderUnavailable)?;
        if choice.finish_reason.as_deref() == Some("length") {
            tracing::warn!("OpenRouter reading was truncated");
            return Err(ApiError::DocumentUnreadable);
        }
        let content = choice.message.content.ok_or(ApiError::DocumentUnreadable)?;
        serde_json::from_str(strip_code_fence(&content)).map_err(|_| {
            tracing::warn!("OpenRouter reading was not valid JSON");
            ApiError::DocumentUnreadable
        })
    }

    fn request_body(&self, request: &ReadingRequest<'_>) -> Value {
        let mut content = vec![json!({
            "type": "text",
            "text": "Lee el documento adjunto y devuelve el JSON solicitado.",
        })];
        for attachment in request.attachments {
            let data_url = format!(
                "data:{};base64,{}",
                attachment.kind.mime_type(),
                STANDARD.encode(&attachment.bytes)
            );
            content.push(match attachment.kind {
                AttachmentKind::Pdf => json!({
                    "type": "file",
                    "file": { "filename": attachment.file_name, "file_data": data_url },
                }),
                _ => json!({ "type": "image_url", "image_url": { "url": data_url } }),
            });
        }
        let mut body = json!({
            "model": self.model,
            "temperature": 0,
            "messages": [
                { "role": "system", "content": request.instructions },
                { "role": "user", "content": content },
            ],
            "response_format": {
                "type": "json_schema",
                "json_schema": {
                    "name": request.schema_name,
                    "strict": true,
                    "schema": request.schema,
                },
            },
            // Identity documents: only providers that support the schema and
            // do not keep or train on the data.
            "provider": {
                "require_parameters": true,
                "data_collection": "deny",
            },
        });
        if request
            .attachments
            .iter()
            .any(|attachment| attachment.kind == AttachmentKind::Pdf)
        {
            // Scanned PDFs have no text layer: the model must see the pages.
            body["plugins"] = json!([{ "id": "file-parser", "pdf": { "engine": "native" } }]);
        }
        body
    }
}

#[derive(Deserialize)]
struct Completion {
    #[serde(default)]
    choices: Vec<Choice>,
    error: Option<CompletionError>,
}

#[derive(Deserialize)]
struct CompletionError {
    code: Option<Value>,
}

#[derive(Deserialize)]
struct Choice {
    message: Message,
    finish_reason: Option<String>,
}

#[derive(Deserialize)]
struct Message {
    content: Option<String>,
}

/// Some providers wrap structured output in a Markdown fence.
fn strip_code_fence(content: &str) -> &str {
    let trimmed = content.trim();
    trimmed
        .strip_prefix("```json")
        .or_else(|| trimmed.strip_prefix("```"))
        .and_then(|inner| inner.strip_suffix("```"))
        .map(str::trim)
        .unwrap_or(trimmed)
}

fn optional_env(name: &str) -> anyhow::Result<Option<String>> {
    match env::var(name) {
        Ok(value) => Ok((!value.trim().is_empty()).then_some(value)),
        Err(env::VarError::NotPresent) => Ok(None),
        Err(error) => Err(error).with_context(|| format!("Invalid {name}")),
    }
}

fn transport_error(error: reqwest::Error) -> ApiError {
    if error.is_timeout() {
        ApiError::Timeout
    } else {
        tracing::warn!(error = %error, "OpenRouter is unreachable");
        ApiError::DocumentReaderUnavailable
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_markdown_fences() {
        assert_eq!(strip_code_fence("```json\n{\"a\":1}\n```"), "{\"a\":1}");
        assert_eq!(strip_code_fence(" {\"a\":1} "), "{\"a\":1}");
    }

    #[test]
    fn recognizes_signatures() {
        assert!(AttachmentKind::Png.matches_signature(b"\x89PNG\r\n\x1a\n...."));
        assert!(AttachmentKind::Jpeg.matches_signature(&[0xFF, 0xD8, 0xFF, 0xE0]));
        assert!(AttachmentKind::Webp.matches_signature(b"RIFF\0\0\0\0WEBPVP8 "));
        assert!(!AttachmentKind::Pdf.matches_signature(b"\x89PNG"));
    }
}
