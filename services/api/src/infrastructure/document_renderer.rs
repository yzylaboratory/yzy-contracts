use std::{env, time::Duration};

use anyhow::{Context, bail};
use reqwest::{
    Body, Client, StatusCode, Url,
    header::{CONTENT_TYPE, HeaderValue},
    redirect::Policy,
};

use crate::{error::ApiError, modules::files::validation::FileKind};

#[derive(Clone)]
pub struct DocumentRenderer {
    client: Client,
    endpoint: Url,
    token: HeaderValue,
}

impl DocumentRenderer {
    pub fn from_env(timeout: Duration) -> anyhow::Result<Option<Self>> {
        let url = optional_env("DOCUMENT_RENDERER_URL")?;
        let token = optional_env("DOCUMENT_RENDERER_API_TOKEN")?;
        match (url, token) {
            (None, None) => Ok(None),
            (Some(url), Some(token)) => Self::new(&url, &token, timeout).map(Some),
            _ => bail!(
                "DOCUMENT_RENDERER_URL and DOCUMENT_RENDERER_API_TOKEN must be configured together"
            ),
        }
    }

    pub fn new(base_url: &str, token: &str, timeout: Duration) -> anyhow::Result<Self> {
        let base = Url::parse(base_url).context("Invalid DOCUMENT_RENDERER_URL")?;
        if !matches!(base.scheme(), "http" | "https")
            || !base.has_host()
            || !base.username().is_empty()
            || base.password().is_some()
            || base.query().is_some()
            || base.fragment().is_some()
        {
            bail!("Invalid DOCUMENT_RENDERER_URL");
        }
        let endpoint = Url::parse(&format!(
            "{}/v1/render/pdf",
            base.as_str().trim_end_matches('/')
        ))
        .context("Invalid document renderer endpoint")?;
        if token.trim().is_empty() {
            bail!("DOCUMENT_RENDERER_API_TOKEN must not be empty");
        }
        let mut token =
            HeaderValue::from_str(token).context("Invalid DOCUMENT_RENDERER_API_TOKEN")?;
        token.set_sensitive(true);
        let client = Client::builder()
            .redirect(Policy::none())
            .no_proxy()
            .timeout(timeout)
            .build()
            .context("Could not configure document renderer client")?;
        Ok(Self {
            client,
            endpoint,
            token,
        })
    }

    pub async fn render_pdf(
        &self,
        docx: impl Into<Body>,
        max_bytes: usize,
    ) -> Result<Vec<u8>, ApiError> {
        let mut response = self
            .client
            .post(self.endpoint.clone())
            .header(CONTENT_TYPE, FileKind::Docx.mime_type())
            .header("x-internal-api-key", self.token.clone())
            .body(docx)
            .send()
            .await
            .map_err(transport_error)?;

        match response.status() {
            StatusCode::OK => {}
            StatusCode::PAYLOAD_TOO_LARGE => return Err(ApiError::PayloadTooLarge),
            StatusCode::UNSUPPORTED_MEDIA_TYPE
            | StatusCode::BAD_REQUEST
            | StatusCode::UNPROCESSABLE_ENTITY => {
                return Err(ApiError::DocumentRenderFailed);
            }
            StatusCode::REQUEST_TIMEOUT | StatusCode::GATEWAY_TIMEOUT => {
                return Err(ApiError::Timeout);
            }
            _ => return Err(ApiError::DocumentRendererUnavailable),
        }
        if response
            .headers()
            .get(CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            != Some(FileKind::Pdf.mime_type())
        {
            return Err(ApiError::DocumentRendererUnavailable);
        }
        if response
            .content_length()
            .is_some_and(|size| size > max_bytes as u64)
        {
            return Err(ApiError::PayloadTooLarge);
        }
        let mut pdf = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(transport_error)? {
            if chunk.len() > max_bytes - pdf.len() {
                return Err(ApiError::PayloadTooLarge);
            }
            pdf.extend_from_slice(&chunk);
        }
        if !FileKind::Pdf.matches_signature(&pdf) {
            return Err(ApiError::DocumentRendererUnavailable);
        }
        Ok(pdf)
    }
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
        ApiError::DocumentRendererUnavailable
    }
}
