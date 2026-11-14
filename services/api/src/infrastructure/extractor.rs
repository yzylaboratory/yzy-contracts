//! Client for `doc-extractor-api`. Its contract is owned by that service.

use anyhow::Context;
use reqwest::{Client, StatusCode};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::config::ExtractorConfig;

const API_KEY_HEADER: &str = "X-Internal-API-Key";
/// Contracts here are in Spanish, with occasional English.
const OCR_LANGUAGES: [&str; 2] = ["es", "en"];

#[derive(Debug, Clone)]
pub struct ConversionRequest<'a> {
    pub job_id: Uuid,
    pub file_name: &'a str,
    pub mime_type: &'a str,
    pub download_url: &'a str,
}

#[derive(Debug, Serialize)]
struct ExtractBody<'a> {
    job_id: Uuid,
    document: DocumentInput<'a>,
    options: ExtractOptions,
}

#[derive(Debug, Serialize)]
struct DocumentInput<'a> {
    filename: &'a str,
    content_type: &'a str,
    download_url: &'a str,
}

#[derive(Debug, Serialize)]
struct ExtractOptions {
    ocr_mode: &'static str,
    ocr_languages: [&'static str; 2],
    extract_tables: bool,
}

#[derive(Debug, Deserialize)]
struct ExtractResponse {
    job_id: Uuid,
    document: DocumentSummary,
    extraction: ExtractionPayload,
}

#[derive(Debug, Deserialize)]
struct DocumentSummary {
    page_count: Option<i32>,
}

#[derive(Debug, Deserialize)]
struct ExtractionPayload {
    markdown: String,
    warnings: Vec<ExtractionWarning>,
}

#[derive(Debug, Clone)]
pub struct ConversionOutput {
    pub markdown: String,
    pub page_count: Option<i32>,
    pub warnings: Vec<ExtractionWarning>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ExtractionWarning {
    pub code: String,
    pub message: String,
}

#[derive(Debug, Deserialize)]
struct RemoteErrorEnvelope {
    error: RemoteError,
}

#[derive(Debug, Deserialize)]
struct RemoteError {
    code: String,
}

/// Whether trying again could help decides the job's fate. Messages are fixed
/// strings because they are stored and shown to the user.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum ExtractorError {
    #[error("{code}")]
    Transient { code: &'static str },
    #[error("{code}")]
    Permanent { code: &'static str },
}

/// Translates the extractor's codes into a closed list, so nothing the remote
/// service sends reaches a user unfiltered.
fn classify(status: StatusCode, remote_code: Option<&str>) -> ExtractorError {
    use ExtractorError::{Permanent, Transient};
    match remote_code {
        // A new attempt signs a new URL.
        Some("PRESIGNED_URL_EXPIRED") => Transient {
            code: "EXTRACTOR_UNAVAILABLE",
        },
        Some("EXTRACTION_TIMEOUT") | Some("DOWNLOAD_TIMEOUT") => Transient {
            code: "EXTRACTOR_TIMEOUT",
        },
        Some("DOCUMENT_NOT_FOUND") => Permanent {
            code: "SOURCE_MISSING",
        },
        Some("UNSUPPORTED_DOCUMENT_FORMAT") => Permanent {
            code: "UNSUPPORTED_DOCUMENT",
        },
        Some("EMPTY_DOCUMENT") | Some("EMPTY_EXTRACTION") => Permanent {
            code: "EMPTY_EXTRACTION",
        },
        Some("CORRUPT_DOCUMENT") | Some("CONVERSION_FAILED") => Permanent {
            code: "CORRUPT_DOCUMENT",
        },
        Some("PASSWORD_PROTECTED_DOCUMENT") => Permanent {
            code: "PASSWORD_PROTECTED_DOCUMENT",
        },
        Some("DOCUMENT_TOO_LARGE") => Permanent {
            code: "DOCUMENT_TOO_LARGE",
        },
        // A rejected key, a busy service or a storage hiccup says nothing about the document.
        _ if status.is_server_error()
            || status == StatusCode::TOO_MANY_REQUESTS
            || status == StatusCode::UNAUTHORIZED
            || status == StatusCode::FORBIDDEN
            || status == StatusCode::REQUEST_TIMEOUT =>
        {
            Transient {
                code: "EXTRACTOR_UNAVAILABLE",
            }
        }
        _ => Permanent {
            code: "EXTRACTOR_REJECTED",
        },
    }
}

pub fn user_message(code: &str) -> &'static str {
    match code {
        "UNSUPPORTED_DOCUMENT" => "The document format could not be processed.",
        "CORRUPT_DOCUMENT" => "The document is damaged or could not be read.",
        "PASSWORD_PROTECTED_DOCUMENT" => "Password-protected documents cannot be converted.",
        "DOCUMENT_TOO_LARGE" => "The document exceeds the conversion limits.",
        "EMPTY_EXTRACTION" => {
            "No text could be extracted. The document may be a scan that OCR could not read."
        }
        "SOURCE_CHANGED" => "The stored file changed after it was registered.",
        "SOURCE_MISSING" => "The stored file could not be found.",
        "MARKDOWN_TOO_LARGE" => "The converted document exceeds the maximum template size.",
        "INVALID_EXTRACTOR_OUTPUT" => "The conversion service returned an invalid result.",
        "EXTRACTOR_REJECTED" => "The conversion service rejected the document.",
        "EXTRACTOR_TIMEOUT" => "The conversion took too long.",
        "EXTRACTOR_UNAVAILABLE" => "The conversion service is unavailable.",
        "STORAGE_UNAVAILABLE" => "The file storage is unavailable.",
        "WORKER_LEASE_EXPIRED" => "The conversion was interrupted too many times.",
        _ => "The conversion failed.",
    }
}

#[derive(Clone)]
pub struct ExtractorClient {
    http: Client,
    extract_url: String,
    api_key: String,
}

impl ExtractorClient {
    pub fn new(config: &ExtractorConfig) -> anyhow::Result<Self> {
        let http = Client::builder()
            .timeout(config.timeout)
            .build()
            .context("could not build the extractor HTTP client")?;
        Ok(Self {
            http,
            extract_url: format!("{}/internal/v1/extract", config.url.trim_end_matches('/')),
            api_key: config.api_token.clone(),
        })
    }

    pub async fn convert(
        &self,
        request: &ConversionRequest<'_>,
    ) -> Result<ConversionOutput, ExtractorError> {
        let body = ExtractBody {
            job_id: request.job_id,
            document: DocumentInput {
                filename: request.file_name,
                content_type: request.mime_type,
                download_url: request.download_url,
            },
            options: ExtractOptions {
                ocr_mode: "auto",
                ocr_languages: OCR_LANGUAGES,
                extract_tables: true,
            },
        };
        let response = self
            .http
            .post(&self.extract_url)
            .header(API_KEY_HEADER, &self.api_key)
            .json(&body)
            .send()
            .await
            .map_err(|error| {
                let error = error.without_url();
                tracing::warn!(%error, job_id = %request.job_id, "extractor request failed");
                if error.is_timeout() {
                    ExtractorError::Transient {
                        code: "EXTRACTOR_TIMEOUT",
                    }
                } else {
                    ExtractorError::Transient {
                        code: "EXTRACTOR_UNAVAILABLE",
                    }
                }
            })?;

        let status = response.status();
        if !status.is_success() {
            let remote_code = response
                .json::<RemoteErrorEnvelope>()
                .await
                .ok()
                .map(|envelope| envelope.error.code);
            tracing::warn!(
                %status,
                remote_code = remote_code.as_deref().unwrap_or("<none>"),
                job_id = %request.job_id,
                "extractor returned an error"
            );
            return Err(classify(status, remote_code.as_deref()));
        }

        let output = response.json::<ExtractResponse>().await.map_err(|error| {
            if error.is_timeout() {
                ExtractorError::Transient {
                    code: "EXTRACTOR_TIMEOUT",
                }
            } else {
                tracing::error!(job_id = %request.job_id, "extractor returned an unreadable body");
                ExtractorError::Permanent {
                    code: "INVALID_EXTRACTOR_OUTPUT",
                }
            }
        })?;
        if output.job_id != request.job_id {
            tracing::error!(job_id = %request.job_id, "extractor answered for a different job");
            return Err(ExtractorError::Permanent {
                code: "INVALID_EXTRACTOR_OUTPUT",
            });
        }
        Ok(ConversionOutput {
            markdown: output.extraction.markdown,
            page_count: output.document.page_count,
            warnings: output.extraction.warnings,
        })
    }
}
