use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::types::Json;
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;
use validator::Validate;

use crate::modules::{companies::CompanySnapshot, files::validation::FileKind};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize, ToSchema, sqlx::Type)]
#[serde(rename_all = "snake_case")]
#[sqlx(type_name = "text", rename_all = "snake_case")]
pub enum DocumentFormat {
    Pdf,
    Docx,
    Email,
}

impl DocumentFormat {
    pub(super) fn file_kind(self) -> Option<FileKind> {
        match self {
            Self::Pdf => Some(FileKind::Pdf),
            Self::Docx => Some(FileKind::Docx),
            Self::Email => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Pdf => "pdf",
            Self::Docx => "docx",
            Self::Email => "email",
        }
    }

    pub fn extension(self) -> &'static str {
        match self {
            Self::Email => "eml",
            other => other.as_str(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum AttachmentFormat {
    Pdf,
    Docx,
}

impl AttachmentFormat {
    pub(super) fn file_kind(self) -> FileKind {
        match self {
            Self::Pdf => FileKind::Pdf,
            Self::Docx => FileKind::Docx,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize, Validate, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct EmailDraft {
    #[validate(email, length(max = 254))]
    pub to: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[validate(email, length(max = 254))]
    pub cc: Option<String>,
    #[validate(length(min = 1, max = 998))]
    pub subject: String,
    #[validate(length(min = 1, max = 12000))]
    pub message: String,
    pub attachment_format: AttachmentFormat,
}

#[derive(Debug, Deserialize, Validate, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct LegacyDocument {
    #[validate(length(min = 1, max = 200))]
    pub contract_name: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize, Validate, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct SaveDocument {
    pub contract_id: Uuid,
    pub format: DocumentFormat,
    #[validate(length(min = 1, max = 255))]
    pub filename: String,
    pub markdown: String,
    #[validate(nested)]
    pub email: Option<EmailDraft>,
    #[validate(nested)]
    pub legacy: Option<LegacyDocument>,
    // Only multipart exports can carry a company snapshot.
    #[serde(skip)]
    #[schema(ignore)]
    pub(super) company: Option<CompanySnapshot>,
    #[serde(skip)]
    #[schema(ignore)]
    pub(super) operation_id: Option<Uuid>,
    #[serde(skip)]
    #[schema(ignore)]
    pub(super) document_type: Option<String>,
}

#[derive(Deserialize, Validate, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct ArtifactMetadata {
    pub contract_id: Uuid,
    pub format: DocumentFormat,
    #[validate(length(min = 1, max = 255))]
    pub filename: String,
    pub markdown: String,
    #[validate(nested)]
    pub email: Option<EmailDraft>,
    pub(super) company: Option<CompanySnapshot>,
    /// Client operation in the selected company, if this export uses an expediente.
    pub(super) operation_id: Option<Uuid>,
    #[validate(length(min = 1, max = 64))]
    pub(super) document_type: Option<String>,
}

impl From<ArtifactMetadata> for SaveDocument {
    fn from(metadata: ArtifactMetadata) -> Self {
        Self {
            contract_id: metadata.contract_id,
            format: metadata.format,
            filename: metadata.filename,
            markdown: metadata.markdown,
            email: metadata.email,
            legacy: None,
            company: metadata.company,
            operation_id: metadata.operation_id,
            document_type: metadata.document_type,
        }
    }
}

#[allow(dead_code)]
#[derive(ToSchema)]
pub struct ArtifactMultipart {
    /// JSON metadata for the generated document.
    metadata: ArtifactMetadata,
    #[schema(value_type = String, format = Binary)]
    artifact: String,
}

#[derive(Debug, Clone, Copy, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum Period {
    Week,
    Month,
    Year,
}

impl Period {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Week => "week",
            Self::Month => "month",
            Self::Year => "year",
        }
    }
}

fn default_page() -> i64 {
    1
}

fn default_per_page() -> i64 {
    20
}

#[derive(Debug, Deserialize, Validate, IntoParams)]
#[serde(deny_unknown_fields)]
#[into_params(parameter_in = Query)]
pub struct ListDocuments {
    #[serde(default = "default_page")]
    #[validate(range(min = 1))]
    #[param(minimum = 1, default = 1)]
    pub page: i64,
    #[serde(default = "default_per_page")]
    #[validate(range(min = 1, max = 100))]
    #[param(minimum = 1, maximum = 100, default = 20)]
    pub per_page: i64,
    #[validate(length(max = 200))]
    pub q: Option<String>,
    pub format: Option<DocumentFormat>,
    pub period: Option<Period>,
    /// Only documents linked to this expediente.
    pub operation_id: Option<Uuid>,
}

#[derive(Debug, Deserialize, Serialize, ToSchema, sqlx::FromRow)]
pub struct DocumentMetadata {
    pub document_type: Option<String>,
    pub id: Uuid,
    pub contract_id: Uuid,
    pub contract_name: String,
    pub format: DocumentFormat,
    pub filename: String,
    pub created_at: DateTime<Utc>,
    pub has_artifact: bool,
    pub operation_id: Option<Uuid>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[sqlx(json(nullable))]
    pub(super) company: Option<CompanySnapshot>,
}

#[derive(sqlx::FromRow)]
pub(super) struct StoredArtifact {
    pub filename: String,
    pub format: DocumentFormat,
    pub attachment_format: Option<String>,
    pub artifact: Vec<u8>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct DocumentDetail {
    #[serde(flatten)]
    pub metadata: DocumentMetadata,
    pub markdown: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub email: Option<EmailDraft>,
}

#[derive(Debug, sqlx::FromRow)]
pub struct StoredDocument {
    #[sqlx(flatten)]
    pub metadata: DocumentMetadata,
    pub markdown: String,
    pub email: Option<Json<EmailDraft>>,
    pub imported_from_session: bool,
}

impl From<StoredDocument> for DocumentDetail {
    fn from(stored: StoredDocument) -> Self {
        Self {
            metadata: stored.metadata,
            markdown: stored.markdown,
            email: stored.email.map(|email| email.0),
        }
    }
}

#[derive(Debug, Serialize, ToSchema)]
pub struct DocumentPage {
    pub items: Vec<DocumentMetadata>,
    pub total: i64,
    pub page: i64,
    pub per_page: i64,
}

#[derive(Debug, Deserialize, Serialize, ToSchema)]
pub struct DocumentMonth {
    /// Calendar month in Santo Domingo.
    #[schema(example = "2026-11")]
    pub month: String,
    pub total: i64,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct DocumentFormats {
    pub pdf: i64,
    pub docx: i64,
    pub email: i64,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct DocumentStats {
    pub total: i64,
    pub current_month_total: i64,
    pub months: Vec<DocumentMonth>,
    pub formats: DocumentFormats,
}
