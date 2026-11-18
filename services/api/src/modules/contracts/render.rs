use axum::{
    Extension,
    body::Bytes,
    extract::{State, rejection::BytesRejection},
    http::{HeaderMap, StatusCode, header},
    response::{IntoResponse, Response},
};
use uuid::Uuid;

use crate::{
    app_state::AppState,
    error::{ApiError, ErrorEnvelope},
    extract::{ApiPath, ApiQuery},
    modules::{
        auth::AuthUser,
        billing::{self, GenerationScope},
        files::validation::{FileKind, artifact_max_bytes},
    },
};

use super::repository;

#[utoipa::path(
    post,
    path = "/api/v1/contracts/{id}/render-pdf",
    tag = "Contracts",
    security(("bearer_auth" = [])),
    params(("id" = Uuid, Path, description = "Contract ID"), GenerationScope),
    request_body(content = String, content_type = "application/vnd.openxmlformats-officedocument.wordprocessingml.document", description = "Binary Word document with the template fields filled in"),
    responses(
        (status = 200, description = "PDF rendered from the Word document", content_type = "application/pdf"),
        (status = 401, description = "Missing or invalid token", body = ErrorEnvelope),
        (status = 404, description = "The contract or operation is outside the active company scope", body = ErrorEnvelope),
        (status = 413, description = "Word input or PDF output exceeds the file size limit", body = ErrorEnvelope),
        (status = 415, description = "Only Word documents can be rendered", body = ErrorEnvelope),
        (status = 422, description = "Word document could not be rendered", body = ErrorEnvelope),
        (status = 503, description = "Renderer is unavailable", body = ErrorEnvelope),
        (status = 504, description = "Rendering timed out", body = ErrorEnvelope),
    )
)]
pub(super) async fn render_pdf(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
    ApiPath(id): ApiPath<Uuid>,
    ApiQuery(scope): ApiQuery<GenerationScope>,
    headers: HeaderMap,
    body: Result<Bytes, BytesRejection>,
) -> Result<Response, ApiError> {
    let source = repository::stored_object_for_reader(&state.db, user.id, id)
        .await?
        .ok_or(ApiError::ContractNotFound)?;
    if FileKind::from_mime(&source.mime_type) != Some(FileKind::Docx)
        || headers
            .get(header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            != Some(FileKind::Docx.mime_type())
    {
        return Err(ApiError::UnsupportedFileType);
    }
    let docx = body.map_err(|error| {
        if error.status() == StatusCode::PAYLOAD_TOO_LARGE {
            ApiError::PayloadTooLarge
        } else {
            ApiError::DocumentRenderFailed
        }
    })?;
    billing::require_generation_access(
        &state.db,
        user.id,
        id,
        scope.company_id,
        scope.operation_id,
    )
    .await?;
    pdf_response(&state, docx).await
}

pub(crate) async fn pdf_response(state: &AppState, docx: Bytes) -> Result<Response, ApiError> {
    let pdf = render_pdf_bytes(state, docx).await?;
    Ok((
        [
            (header::CONTENT_TYPE, FileKind::Pdf.mime_type()),
            (header::CACHE_CONTROL, "private, no-store"),
            (header::X_CONTENT_TYPE_OPTIONS, "nosniff"),
        ],
        Bytes::from(pdf),
    )
        .into_response())
}

pub(crate) async fn render_pdf_bytes(state: &AppState, docx: Bytes) -> Result<Vec<u8>, ApiError> {
    let max_bytes = artifact_max_bytes(state.config.upload_max_bytes);
    if docx.len() > max_bytes {
        return Err(ApiError::PayloadTooLarge);
    }
    if !FileKind::Docx.matches_signature(&docx) {
        return Err(ApiError::DocumentRenderFailed);
    }
    let renderer = state
        .document_renderer
        .as_ref()
        .ok_or(ApiError::DocumentRendererUnavailable)?;
    renderer.render_pdf(docx, max_bytes).await
}
