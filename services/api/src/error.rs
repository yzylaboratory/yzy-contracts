use axum::{
    Json,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::Serialize;
use utoipa::ToSchema;

/// Every error the API can return. Internal causes are logged, never serialized.
#[derive(Debug, thiserror::Error)]
pub enum ApiError {
    #[error("Authentication is required")]
    Unauthenticated,
    #[error("This Contracts account has been deleted")]
    AccountDeleted,
    #[error("Your company access is pending")]
    AccessPending,
    #[error("Administrator access is required")]
    AdminRequired,
    #[error("User not found")]
    AccessUserNotFound,
    #[error("Contract not found")]
    ContractNotFound,
    #[error("Solo el responsable de facturación puede acceder a esta cuenta.")]
    BillingRequired,
    #[error("No se encontró el recurso de facturación.")]
    BillingNotFound,
    #[error("Configura la cuenta bancaria de transferencias antes de activar la facturación.")]
    BillingBankRequired,
    #[error("La cuenta bancaria cambió desde que la consultaste. Actualiza e inténtalo de nuevo.")]
    BillingBankConflict,
    #[error("{0}")]
    BillingConflict(&'static str),
    #[error(
        "La generación de documentos está pausada porque esta empresa tiene una factura vencida."
    )]
    PaymentRequired,
    #[error("No se encontró el cliente.")]
    ClientNotFound,
    #[error("Ya existe un cliente con esa identificación.")]
    ClientIdentityConflict,
    #[error("El cliente tiene expedientes y no se puede eliminar.")]
    ClientInUse,
    #[error("No se encontró el expediente.")]
    ClientOperationNotFound,
    #[error("{0}")]
    CaseReferenceConflict(&'static str),
    #[error("Company not found")]
    CompanyNotFound,
    #[error("Restore this company before editing it or making it the default")]
    CompanyArchived,
    #[error("Archive this company before deleting it")]
    CompanyNotArchived,
    #[error("{0}")]
    CompanyInUse(String),
    #[error("Template not found")]
    TemplateNotFound,
    #[error("Conversion not found")]
    ConversionNotFound,
    #[error("Generated document not found")]
    GeneratedDocumentNotFound,
    #[error("This generated document ID is already in use")]
    GeneratedDocumentConflict,
    #[error("The document could not be rendered in PDF")]
    DocumentRenderFailed,
    #[error("The document renderer is temporarily unavailable")]
    DocumentRendererUnavailable,
    #[error("Document reading is temporarily unavailable")]
    DocumentReaderUnavailable,
    #[error("No se pudo leer el documento. Prueba con una foto más nítida y completa.")]
    DocumentUnreadable,
    #[error("Solo se aceptan imágenes JPEG, PNG o WebP y archivos PDF")]
    UnsupportedDocumentImage,
    #[error("Upload not found")]
    UploadNotFound,
    #[error("Resource not found")]
    RouteNotFound,
    #[error("This upload was already registered as a contract")]
    UploadAlreadyUsed,
    #[error("This upload has expired; request a new upload URL")]
    UploadExpired,
    #[error("The file has not finished uploading")]
    UploadNotCompleted,
    #[error("The uploaded file does not match what was declared")]
    UploadMismatch,
    #[error("The Word document must contain at least one variable such as {{{{cliente_nombre}}}}")]
    DocxVariablesRequired,
    #[error("Use variables such as {{{{cliente_nombre}}}} in editable Word text")]
    InvalidDocxVariables,
    #[error("The Word file is damaged or its structure is unsupported")]
    InvalidDocxTemplate,
    #[error("Only PDF and DOCX files are supported")]
    UnsupportedFileType,
    #[error("The file exceeds the maximum allowed size")]
    FileTooLarge,
    #[error("This contract already has a template")]
    ContractAlreadyConverted,
    #[error("The request body is too large")]
    PayloadTooLarge,
    #[error("The account has recorded too many tour events")]
    TourRateLimited,
    #[error("The account has recorded too many activity events")]
    ActivityRateLimited,
    #[error("{0}")]
    Validation(String),
    #[error("The request took too long to complete")]
    Timeout,
    #[error("Authentication is temporarily unavailable")]
    AuthUnavailable,
    #[error("The service is temporarily unavailable")]
    Unavailable,
    #[error("An unexpected error occurred")]
    Internal(#[source] anyhow::Error),
}

impl ApiError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::Unauthenticated => "UNAUTHENTICATED",
            Self::AccountDeleted => "ACCOUNT_DELETED",
            Self::AccessPending => "ACCESS_PENDING",
            Self::AdminRequired => "ADMIN_REQUIRED",
            Self::AccessUserNotFound => "ACCESS_USER_NOT_FOUND",
            Self::ContractNotFound => "CONTRACT_NOT_FOUND",
            Self::ClientNotFound => "CLIENT_NOT_FOUND",
            Self::ClientIdentityConflict => "CLIENT_IDENTITY_CONFLICT",
            Self::ClientInUse => "CLIENT_IN_USE",
            Self::ClientOperationNotFound => "CLIENT_OPERATION_NOT_FOUND",
            Self::CaseReferenceConflict(_) => "CASE_REFERENCE_CONFLICT",
            Self::CompanyNotFound => "COMPANY_NOT_FOUND",
            Self::BillingRequired => "BILLING_REQUIRED",
            Self::BillingNotFound => "BILLING_NOT_FOUND",
            Self::BillingBankRequired => "BILLING_BANK_REQUIRED",
            Self::BillingBankConflict => "BILLING_BANK_CONFLICT",
            Self::BillingConflict(_) => "BILLING_CONFLICT",
            Self::PaymentRequired => "PAYMENT_REQUIRED",
            Self::CompanyArchived => "COMPANY_ARCHIVED",
            Self::CompanyNotArchived => "COMPANY_NOT_ARCHIVED",
            Self::CompanyInUse(_) => "COMPANY_IN_USE",
            Self::TemplateNotFound => "TEMPLATE_NOT_FOUND",
            Self::ConversionNotFound => "CONVERSION_NOT_FOUND",
            Self::GeneratedDocumentNotFound => "GENERATED_DOCUMENT_NOT_FOUND",
            Self::GeneratedDocumentConflict => "GENERATED_DOCUMENT_CONFLICT",
            Self::DocumentRenderFailed => "DOCUMENT_RENDER_FAILED",
            Self::DocumentRendererUnavailable => "DOCUMENT_RENDERER_UNAVAILABLE",
            Self::DocumentReaderUnavailable => "DOCUMENT_READER_UNAVAILABLE",
            Self::DocumentUnreadable => "DOCUMENT_UNREADABLE",
            Self::UnsupportedDocumentImage => "UNSUPPORTED_FILE_TYPE",
            Self::UploadNotFound => "UPLOAD_NOT_FOUND",
            Self::RouteNotFound => "NOT_FOUND",
            Self::UploadAlreadyUsed => "UPLOAD_ALREADY_USED",
            Self::UploadExpired => "UPLOAD_EXPIRED",
            Self::UploadNotCompleted => "UPLOAD_NOT_COMPLETED",
            Self::UploadMismatch => "UPLOAD_MISMATCH",
            Self::DocxVariablesRequired => "DOCX_VARIABLES_REQUIRED",
            Self::InvalidDocxVariables => "INVALID_DOCX_VARIABLES",
            Self::InvalidDocxTemplate => "INVALID_DOCX_TEMPLATE",
            Self::UnsupportedFileType => "UNSUPPORTED_FILE_TYPE",
            Self::FileTooLarge => "FILE_TOO_LARGE",
            Self::ContractAlreadyConverted => "CONTRACT_ALREADY_CONVERTED",
            Self::PayloadTooLarge => "PAYLOAD_TOO_LARGE",
            Self::TourRateLimited => "TOUR_RATE_LIMITED",
            Self::ActivityRateLimited => "ACTIVITY_RATE_LIMITED",
            Self::Validation(_) => "VALIDATION_ERROR",
            Self::Timeout => "REQUEST_TIMEOUT",
            Self::AuthUnavailable => "AUTH_UNAVAILABLE",
            Self::Unavailable => "SERVICE_UNAVAILABLE",
            Self::Internal(_) => "INTERNAL_ERROR",
        }
    }

    pub fn status(&self) -> StatusCode {
        match self {
            Self::Unauthenticated => StatusCode::UNAUTHORIZED,
            Self::AccountDeleted
            | Self::AccessPending
            | Self::AdminRequired
            | Self::BillingRequired => StatusCode::FORBIDDEN,
            Self::PaymentRequired => StatusCode::PAYMENT_REQUIRED,
            Self::ContractNotFound
            | Self::BillingNotFound
            | Self::CompanyNotFound
            | Self::ClientNotFound
            | Self::ClientOperationNotFound
            | Self::AccessUserNotFound
            | Self::TemplateNotFound
            | Self::ConversionNotFound
            | Self::GeneratedDocumentNotFound
            | Self::UploadNotFound
            | Self::RouteNotFound => StatusCode::NOT_FOUND,
            Self::UploadAlreadyUsed
            | Self::BillingBankRequired
            | Self::BillingBankConflict
            | Self::BillingConflict(_)
            | Self::UploadNotCompleted
            | Self::ContractAlreadyConverted
            | Self::CompanyArchived
            | Self::CompanyNotArchived
            | Self::CompanyInUse(_)
            | Self::ClientIdentityConflict
            | Self::ClientInUse
            | Self::CaseReferenceConflict(_)
            | Self::GeneratedDocumentConflict => StatusCode::CONFLICT,
            Self::UploadExpired => StatusCode::GONE,
            Self::FileTooLarge | Self::PayloadTooLarge => StatusCode::PAYLOAD_TOO_LARGE,
            Self::TourRateLimited | Self::ActivityRateLimited => StatusCode::TOO_MANY_REQUESTS,
            Self::UnsupportedFileType | Self::UnsupportedDocumentImage => {
                StatusCode::UNSUPPORTED_MEDIA_TYPE
            }
            Self::UploadMismatch
            | Self::DocxVariablesRequired
            | Self::InvalidDocxVariables
            | Self::InvalidDocxTemplate
            | Self::DocumentRenderFailed
            | Self::DocumentUnreadable
            | Self::Validation(_) => StatusCode::UNPROCESSABLE_ENTITY,
            Self::Timeout => StatusCode::GATEWAY_TIMEOUT,
            Self::AuthUnavailable
            | Self::DocumentRendererUnavailable
            | Self::DocumentReaderUnavailable
            | Self::Unavailable => StatusCode::SERVICE_UNAVAILABLE,
            Self::Internal(_) => StatusCode::INTERNAL_SERVER_ERROR,
        }
    }
}

impl From<sqlx::Error> for ApiError {
    fn from(error: sqlx::Error) -> Self {
        Self::Internal(anyhow::Error::new(error).context("database error"))
    }
}

impl From<anyhow::Error> for ApiError {
    fn from(error: anyhow::Error) -> Self {
        Self::Internal(error)
    }
}

/// Wire format shared by all errors.
#[derive(Debug, Serialize, ToSchema)]
pub struct ErrorEnvelope {
    pub error: ErrorBody,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ErrorBody {
    #[schema(example = "CONTRACT_NOT_FOUND")]
    pub code: String,
    #[schema(example = "Contract not found")]
    pub message: String,
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        if let Self::Internal(cause) = &self {
            tracing::error!(error = format!("{cause:#}"), "request failed");
        }
        let envelope = ErrorEnvelope {
            error: ErrorBody {
                code: self.code().to_owned(),
                message: self.to_string(),
            },
        };
        (self.status(), Json(envelope)).into_response()
    }
}
