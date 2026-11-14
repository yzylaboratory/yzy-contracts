//! Example Rust HTTP client for `doc-extractor-api` using `reqwest`, `serde`, and `uuid`.
//!
//! Add to your `Cargo.toml`:
//! ```toml
//! [dependencies]
//! anyhow = "1"
//! reqwest = { version = "0.12", default-features = false, features = ["json", "rustls-tls"] }
//! serde = { version = "1", features = ["derive"] }
//! uuid = { version = "1", features = ["serde", "v4"] }
//! ```

use std::time::Duration;

use reqwest::{Client, StatusCode};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize)]
pub struct ExtractionRequest<'a> {
    pub job_id: Uuid,
    pub document: DocumentInput<'a>,
    pub options: ExtractionOptions<'a>,
}

#[derive(Debug, Clone, Serialize)]
pub struct DocumentInput<'a> {
    pub filename: &'a str,
    pub content_type: &'a str,
    pub download_url: &'a str,
}

#[derive(Debug, Clone, Serialize)]
pub struct ExtractionOptions<'a> {
    pub ocr_mode: &'a str,
    pub ocr_languages: &'a [&'a str],
    pub extract_tables: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ExtractionResponse {
    pub job_id: Uuid,
    pub status: String,
    pub document: DocumentSummary,
    pub extraction: ExtractionResultPayload,
}

#[derive(Debug, Clone, Deserialize)]
pub struct DocumentSummary {
    pub filename: String,
    pub content_type: String,
    pub page_count: Option<i32>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ExtractionResultPayload {
    pub markdown: String,
    pub metadata: ExtractionMetadata,
    pub warnings: Vec<ExtractionWarning>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ExtractionMetadata {
    pub tables_detected: u32,
    pub ocr_used: Option<bool>,
    pub duration_ms: u64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ExtractionWarning {
    pub code: String,
    pub message: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ErrorEnvelope {
    pub error: ErrorDetail,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ErrorDetail {
    pub code: String,
    pub message: String,
}

#[derive(Debug, thiserror::Error)]
pub enum DocExtractorClientError {
    #[error("transient extractor error ({code}): {message}")]
    Transient { code: String, message: String },
    #[error("permanent extractor error ({code}): {message}")]
    Permanent { code: String, message: String },
}

pub struct DocExtractorClient {
    http: Client,
    endpoint: String,
    internal_api_key: String,
}

impl DocExtractorClient {
    pub fn new(base_url: &str, internal_api_key: String, timeout: Duration) -> anyhow::Result<Self> {
        let http = Client::builder().timeout(timeout).build()?;
        let endpoint = format!("{}/internal/v1/extract", base_url.trim_end_matches('/'));
        Ok(Self {
            http,
            endpoint,
            internal_api_key,
        })
    }

    pub async fn extract(
        &self,
        job_id: Uuid,
        filename: &str,
        content_type: &str,
        presigned_r2_url: &str,
    ) -> Result<ExtractionResponse, DocExtractorClientError> {
        let payload = ExtractionRequest {
            job_id,
            document: DocumentInput {
                filename,
                content_type,
                download_url: presigned_r2_url,
            },
            options: ExtractionOptions {
                ocr_mode: "auto",
                ocr_languages: &["es", "en"],
                extract_tables: true,
            },
        };

        let response = self
            .http
            .post(&self.endpoint)
            .header("X-Internal-API-Key", &self.internal_api_key)
            .header("X-Request-Id", job_id.to_string())
            .json(&payload)
            .send()
            .await
            .map_err(|err| {
                let code = if err.is_timeout() {
                    "EXTRACTION_TIMEOUT"
                } else {
                    "EXTRACTOR_UNAVAILABLE"
                };
                DocExtractorClientError::Transient {
                    code: code.to_owned(),
                    message: "Failed to reach doc-extractor-api".to_owned(),
                }
            })?;

        let status = response.status();
        if status.is_success() {
            return response.json::<ExtractionResponse>().await.map_err(|_| {
                DocExtractorClientError::Permanent {
                    code: "INVALID_EXTRACTOR_OUTPUT".to_owned(),
                    message: "Could not deserialize ExtractionResponse".to_owned(),
                }
            });
        }

        let envelope = response.json::<ErrorEnvelope>().await.unwrap_or(ErrorEnvelope {
            error: ErrorDetail {
                code: "UNKNOWN_EXTRACTOR_ERROR".to_owned(),
                message: format!("HTTP {status}"),
            },
        });

        if status.is_server_error()
            || status == StatusCode::TOO_MANY_REQUESTS
            || status == StatusCode::GATEWAY_TIMEOUT
        {
            return Err(DocExtractorClientError::Transient {
                code: envelope.error.code,
                message: envelope.error.message,
            });
        }

        Err(DocExtractorClientError::Permanent {
            code: envelope.error.code,
            message: envelope.error.message,
        })
    }
}
