mod dto;
pub mod maintenance;
mod repository;

use axum::{
    Extension, Json,
    body::Bytes,
    extract::{DefaultBodyLimit, Multipart, Request, State, multipart::MultipartRejection},
    http::{HeaderValue, StatusCode, header},
    middleware::{self, Next},
    response::{IntoResponse, Response},
};
use chrono::{DateTime, Datelike, Duration, Utc};
use utoipa_axum::{
    router::{OpenApiRouter, UtoipaMethodRouterExt},
    routes,
};
use uuid::Uuid;
use validator::Validate;

use crate::{
    app_state::AppState,
    error::{ApiError, ErrorEnvelope},
    extract::{ApiJson, ApiPath, ApiQuery},
    infrastructure::storage::content_disposition,
    modules::{
        auth::AuthUser,
        billing, clients,
        companies::COMPANY_JSON_LIMIT,
        contracts,
        files::validation::{FileKind, artifact_max_bytes},
    },
};

use dto::{
    ArtifactMetadata, ArtifactMultipart, DocumentDetail, DocumentFormat, DocumentMetadata,
    DocumentPage, DocumentStats, ListDocuments, SaveDocument, StoredArtifact, StoredDocument,
};

pub fn router(template_max_bytes: usize, upload_max_bytes: i64) -> OpenApiRouter<AppState> {
    // A byte can occupy up to six bytes in JSON. Allow that encoding overhead
    // and the bounded email/metadata while retaining decoded field limits.
    let request_limit = template_max_bytes
        .saturating_mul(6)
        .saturating_add(96 * 1024);
    OpenApiRouter::new()
        .routes(routes!(list_documents))
        .routes(routes!(get_document, save_document).layer(DefaultBodyLimit::max(request_limit)))
        .routes(
            routes!(get_artifact, save_artifact).layer(DefaultBodyLimit::max(
                request_limit
                    .saturating_add(COMPANY_JSON_LIMIT)
                    .saturating_add(artifact_max_bytes(upload_max_bytes)),
            )),
        )
        .routes(routes!(render_saved_pdf))
        .routes(routes!(document_stats))
        .route_layer(middleware::from_fn(no_store))
}

async fn no_store(request: Request, next: Next) -> Response {
    let mut response = next.run(request).await;
    response.headers_mut().insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("private, no-store"),
    );
    response
}

#[utoipa::path(
    put,
    path = "/api/v1/generated-documents/{id}",
    tag = "Generated documents",
    security(("bearer_auth" = [])),
    params(("id" = Uuid, Path, description = "Client-generated document UUID")),
    request_body = SaveDocument,
    responses(
        (status = 200, description = "Previously saved identical document", body = DocumentMetadata),
        (status = 201, description = "Saved document", body = DocumentMetadata),
        (status = 401, description = "Missing or invalid token", body = ErrorEnvelope),
        (status = 404, description = "The source contract does not exist or belongs to another account", body = ErrorEnvelope),
        (status = 409, description = "This account already used the ID with a different document", body = ErrorEnvelope),
        (status = 413, description = "The request or content exceeds the size limit", body = ErrorEnvelope),
        (status = 422, description = "Invalid document or legacy metadata", body = ErrorEnvelope),
    )
)]
async fn save_document(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
    ApiPath(id): ApiPath<Uuid>,
    ApiJson(body): ApiJson<SaveDocument>,
) -> Result<impl IntoResponse, ApiError> {
    let legacy = validate(&body, state.config.template_max_bytes, true)?;
    persist(&state, user.id, id, &body, legacy, None).await
}

async fn persist(
    state: &AppState,
    owner: Uuid,
    id: Uuid,
    body: &SaveDocument,
    legacy: Option<(&str, DateTime<Utc>)>,
    artifact: Option<(FileKind, &[u8])>,
) -> Result<(StatusCode, Json<DocumentMetadata>), ApiError> {
    if let Some(company) = &body.company {
        company.validate()?;
    }
    let existing = repository::find_for_owner(&state.db, owner, id).await?;
    let existing = if existing.is_some() {
        existing
    } else {
        // Authorize new records before persistence. A saved record can be
        // replayed even if its source is now archived or overdue.
        let company = body.company.as_ref().map(|company| company.id);
        if legacy.is_some() {
            billing::require_legacy_import_access(&state.db, owner, body.contract_id, company)
                .await?;
        } else {
            billing::require_generation_access(
                &state.db,
                owner,
                body.contract_id,
                company,
                body.operation_id,
            )
            .await?;
        }
        if let Some(metadata) =
            repository::insert(&state.db, owner, id, body, legacy, artifact).await?
        {
            return Ok((StatusCode::CREATED, Json(metadata)));
        }
        // A concurrent INSERT can win after the first statement starts.
        repository::find_for_owner(&state.db, owner, id).await?
    };
    let Some(existing) = existing else {
        if repository::id_is_used(&state.db, id).await? {
            return Err(ApiError::GeneratedDocumentConflict);
        }
        if let Some(company) = &body.company {
            let allowed: bool = sqlx::query_scalar("SELECT has_company_membership($1, $2)")
                .bind(owner)
                .bind(company.id)
                .fetch_one(&state.db)
                .await?;
            if !allowed {
                return Err(ApiError::CompanyNotFound);
            }
        }
        if let Some(kind) = &body.document_type
            && (body.operation_id.is_none()
                || !kind.starts_with(|ch: char| ch.is_ascii_lowercase())
                || !kind
                    .bytes()
                    .all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit() || ch == b'_'))
        {
            return Err(ApiError::Validation(
                "Invalid expediente document type".into(),
            ));
        }
        if let Some(operation) = body.operation_id {
            clients::require_generation_scope(
                &state.db,
                owner,
                body.company.as_ref().map(|company| company.id),
                operation,
                body.contract_id,
            )
            .await?;
        }
        if artifact.is_some()
            && let Some(source) =
                contracts::repository::find_for_reader(&state.db, owner, body.contract_id).await?
        {
            if source.catalog_key.is_some() && body.company.is_none() {
                return Err(invalid("company"));
            }
            if let Some(companies) = source.shared_company_ids
                && body
                    .company
                    .as_ref()
                    .is_none_or(|company| !companies.contains(&company.id))
            {
                return Err(invalid("company"));
            }
            return Err(invalid("format"));
        }
        return Err(ApiError::ContractNotFound);
    };
    if existing.metadata.has_artifact != artifact.is_some()
        || !same_document(&existing, body, legacy)
    {
        return Err(ApiError::GeneratedDocumentConflict);
    }
    if let Some((_, bytes)) = artifact
        && !repository::artifact_matches(&state.db, owner, id, bytes).await?
    {
        return Err(ApiError::GeneratedDocumentConflict);
    }
    Ok((StatusCode::OK, Json(existing.metadata)))
}

#[utoipa::path(
    put,
    path = "/api/v1/generated-documents/{id}/artifact",
    tag = "Generated documents",
    security(("bearer_auth" = [])),
    params(("id" = Uuid, Path, description = "Client-generated document UUID")),
    request_body(content = ArtifactMultipart, content_type = "multipart/form-data"),
    responses(
        (status = 200, description = "Previously saved identical document and binary", body = DocumentMetadata),
        (status = 201, description = "Saved document and binary", body = DocumentMetadata),
        (status = 401, description = "Missing or invalid token", body = ErrorEnvelope),
        (status = 404, description = "The source contract, operation or selected company is outside the active scope", body = ErrorEnvelope),
        (status = 409, description = "This account already used the ID with a different document", body = ErrorEnvelope),
        (status = 413, description = "Artifact exceeds 20 MiB or the configured upload limit", body = ErrorEnvelope),
        (status = 422, description = "Invalid metadata, binary or source format", body = ErrorEnvelope),
    )
)]
async fn save_artifact(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
    ApiPath(id): ApiPath<Uuid>,
    multipart: Result<Multipart, MultipartRejection>,
) -> Result<impl IntoResponse, ApiError> {
    let mut multipart = multipart.map_err(|_| invalid("multipart"))?;
    let mut metadata = None;
    let mut artifact = None;
    let max_bytes = artifact_max_bytes(state.config.upload_max_bytes);
    let metadata_limit = state
        .config
        .template_max_bytes
        .saturating_mul(6)
        .saturating_add(96 * 1024)
        .saturating_add(COMPANY_JSON_LIMIT);
    while let Some(field) = multipart.next_field().await.map_err(multipart_error)? {
        match field.name() {
            Some("metadata") if metadata.is_none() => {
                let bytes = read_part(field, metadata_limit).await?;
                let fields = serde_json::from_slice::<ArtifactMetadata>(&bytes)
                    .map_err(|_| invalid("metadata"))?;
                fields.validate().map_err(|_| invalid("metadata"))?;
                metadata = Some(SaveDocument::from(fields));
            }
            Some("artifact") if artifact.is_none() => {
                let kind = field
                    .content_type()
                    .and_then(FileKind::from_mime)
                    .ok_or_else(|| invalid("artifact.content_type"))?;
                let bytes = read_part(field, max_bytes).await?;
                if !kind.matches_signature(&bytes) {
                    return Err(invalid("artifact"));
                }
                artifact = Some((kind, bytes));
            }
            _ => return Err(invalid("multipart")),
        }
    }
    let body = metadata.ok_or_else(|| invalid("metadata"))?;
    let (kind, bytes) = artifact.ok_or_else(|| invalid("artifact"))?;
    if output_kind(&body) != Some(kind) {
        return Err(invalid("artifact.content_type"));
    }
    validate(&body, state.config.template_max_bytes, false)?;
    persist(&state, user.id, id, &body, None, Some((kind, &bytes))).await
}

fn output_kind(body: &SaveDocument) -> Option<FileKind> {
    body.format.file_kind().or_else(|| {
        body.email
            .as_ref()
            .map(|email| email.attachment_format.file_kind())
    })
}

fn multipart_error(error: axum::extract::multipart::MultipartError) -> ApiError {
    if error.status() == StatusCode::PAYLOAD_TOO_LARGE {
        ApiError::PayloadTooLarge
    } else {
        invalid("multipart")
    }
}

async fn read_part(
    mut field: axum::extract::multipart::Field<'_>,
    max_bytes: usize,
) -> Result<Vec<u8>, ApiError> {
    let mut bytes = Vec::new();
    while let Some(chunk) = field.chunk().await.map_err(multipart_error)? {
        if chunk.len() > max_bytes - bytes.len() {
            return Err(ApiError::PayloadTooLarge);
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

fn saved_artifact_kind(stored: &StoredArtifact) -> Result<FileKind, ApiError> {
    stored
        .format
        .file_kind()
        .or(match stored.attachment_format.as_deref() {
            Some("pdf") => Some(FileKind::Pdf),
            Some("docx") => Some(FileKind::Docx),
            _ => None,
        })
        .ok_or_else(|| ApiError::Internal(anyhow::anyhow!("Saved artifact is missing its format")))
}

#[utoipa::path(
    get,
    path = "/api/v1/generated-documents/{id}/artifact",
    tag = "Generated documents",
    security(("bearer_auth" = [])),
    params(("id" = Uuid, Path, description = "Generated document UUID")),
    responses(
        (status = 200, description = "Saved file or email attachment", content(("application/pdf"), ("application/vnd.openxmlformats-officedocument.wordprocessingml.document"))),
        (status = 401, description = "Missing or invalid token", body = ErrorEnvelope),
        (status = 404, description = "No accessible binary exists for this document", body = ErrorEnvelope),
    )
)]
async fn get_artifact(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
    ApiPath(id): ApiPath<Uuid>,
) -> Result<Response, ApiError> {
    let stored = repository::find_artifact(&state.db, user.id, id)
        .await?
        .ok_or(ApiError::GeneratedDocumentNotFound)?;
    let kind = saved_artifact_kind(&stored)?;
    let filename = if stored.format == DocumentFormat::Email {
        format!(
            "{}.{}",
            stored
                .filename
                .strip_suffix(".eml")
                .unwrap_or(&stored.filename),
            kind.extension()
        )
    } else {
        stored.filename
    };
    Ok((
        [
            (header::CONTENT_TYPE, kind.mime_type()),
            (header::CONTENT_DISPOSITION, &content_disposition(&filename)),
            (header::X_CONTENT_TYPE_OPTIONS, "nosniff"),
        ],
        Bytes::from(stored.artifact),
    )
        .into_response())
}

#[utoipa::path(
    post,
    path = "/api/v1/generated-documents/{id}/render-pdf",
    tag = "Generated documents",
    security(("bearer_auth" = [])),
    params(("id" = Uuid, Path, description = "Generated document UUID")),
    responses(
        (status = 200, description = "Rendered PDF of the saved Word file", content_type = "application/pdf"),
        (status = 401, description = "Missing or invalid token", body = ErrorEnvelope),
        (status = 404, description = "No accessible binary exists for this document", body = ErrorEnvelope),
        (status = 413, description = "Word input or PDF output exceeds the file size limit", body = ErrorEnvelope),
        (status = 415, description = "Only Word documents can be rendered", body = ErrorEnvelope),
        (status = 422, description = "Word document could not be rendered", body = ErrorEnvelope),
        (status = 503, description = "Renderer is unavailable", body = ErrorEnvelope),
        (status = 504, description = "Rendering timed out", body = ErrorEnvelope),
    )
)]
async fn render_saved_pdf(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
    ApiPath(id): ApiPath<Uuid>,
) -> Result<Response, ApiError> {
    let stored = repository::find_artifact(&state.db, user.id, id)
        .await?
        .ok_or(ApiError::GeneratedDocumentNotFound)?;
    if saved_artifact_kind(&stored)? == FileKind::Docx {
        contracts::render::pdf_response(&state, stored.artifact.into()).await
    } else {
        Err(ApiError::UnsupportedFileType)
    }
}

fn same_document(
    existing: &StoredDocument,
    body: &SaveDocument,
    legacy: Option<(&str, DateTime<Utc>)>,
) -> bool {
    existing.metadata.contract_id == body.contract_id
        && existing.metadata.format == body.format
        && existing.metadata.filename == body.filename
        && existing.markdown == body.markdown
        && existing.email.as_ref().map(|email| &email.0) == body.email.as_ref()
        && existing.metadata.company == body.company
        && existing.metadata.operation_id == body.operation_id
        && existing.metadata.document_type == body.document_type
        && match legacy {
            Some((name, created_at)) => {
                existing.imported_from_session
                    && existing.metadata.contract_name == name
                    && existing.metadata.created_at == created_at
            }
            None => !existing.imported_from_session,
        }
}

fn invalid(field: &str) -> ApiError {
    ApiError::Validation(format!("Invalid value for: {field}"))
}

fn validate(
    body: &SaveDocument,
    max_bytes: usize,
    markdown_required: bool,
) -> Result<Option<(&str, DateTime<Utc>)>, ApiError> {
    if body.markdown.len() > max_bytes {
        return Err(ApiError::PayloadTooLarge);
    }
    if (markdown_required && body.markdown.trim().is_empty()) || body.markdown.contains('\0') {
        return Err(invalid("markdown"));
    }
    let Some((stem, suffix)) = body.filename.rsplit_once('.') else {
        return Err(invalid("filename"));
    };
    if stem.trim().is_empty()
        || suffix != body.format.extension()
        || body.filename.contains(['/', '\\'])
        || body.filename.chars().any(char::is_control)
    {
        return Err(invalid("filename"));
    }
    if (body.format == DocumentFormat::Email) != body.email.is_some() {
        return Err(invalid("email"));
    }
    if let Some(email) = &body.email {
        if email.subject.trim().is_empty() || email.subject.chars().any(char::is_control) {
            return Err(invalid("email.subject"));
        }
        if email.message.trim().is_empty() || email.message.contains('\0') {
            return Err(invalid("email.message"));
        }
    }
    body.legacy
        .as_ref()
        .map(|legacy| {
            let name = legacy.contract_name.trim();
            if name.is_empty() || name.contains('\0') {
                return Err(invalid("legacy.contract_name"));
            }
            if legacy.created_at.year() < 2000 || legacy.created_at > Utc::now() + Duration::days(1)
            {
                return Err(invalid("legacy.created_at"));
            }
            let created_at = DateTime::from_timestamp_micros(legacy.created_at.timestamp_micros())
                .ok_or_else(|| invalid("legacy.created_at"))?;
            Ok((name, created_at))
        })
        .transpose()
}

#[utoipa::path(
    get,
    path = "/api/v1/generated-documents",
    tag = "Generated documents",
    security(("bearer_auth" = [])),
    params(ListDocuments),
    responses(
        (status = 200, description = "A page of generated document metadata", body = DocumentPage),
        (status = 401, description = "Missing or invalid token", body = ErrorEnvelope),
        (status = 422, description = "Invalid query parameters", body = ErrorEnvelope),
    )
)]
async fn list_documents(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
    ApiQuery(query): ApiQuery<ListDocuments>,
) -> Result<Json<DocumentPage>, ApiError> {
    if query.q.as_deref().is_some_and(|q| q.contains('\0')) {
        return Err(invalid("q"));
    }
    Ok(Json(repository::list(&state.db, user.id, &query).await?))
}

#[utoipa::path(
    get,
    path = "/api/v1/generated-documents/{id}",
    tag = "Generated documents",
    security(("bearer_auth" = [])),
    params(("id" = Uuid, Path, description = "Generated document UUID")),
    responses(
        (status = 200, description = "A saved snapshot for re-export", body = DocumentDetail),
        (status = 401, description = "Missing or invalid token", body = ErrorEnvelope),
        (status = 404, description = "The document does not exist or is outside company records", body = ErrorEnvelope),
    )
)]
async fn get_document(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
    ApiPath(id): ApiPath<Uuid>,
) -> Result<Json<DocumentDetail>, ApiError> {
    let stored = repository::find(&state.db, user.id, id)
        .await?
        .ok_or(ApiError::GeneratedDocumentNotFound)?;
    Ok(Json(stored.into()))
}

#[utoipa::path(
    get,
    path = "/api/v1/generated-documents/stats",
    tag = "Generated documents",
    security(("bearer_auth" = [])),
    responses(
        (status = 200, description = "Account totals, formats and six calendar months in Santo Domingo", body = DocumentStats),
        (status = 401, description = "Missing or invalid token", body = ErrorEnvelope),
    )
)]
async fn document_stats(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
) -> Result<Json<DocumentStats>, ApiError> {
    Ok(Json(repository::stats(&state.db, user.id).await?))
}
