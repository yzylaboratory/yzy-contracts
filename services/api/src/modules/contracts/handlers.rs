use std::collections::HashSet;

use axum::{
    Extension, Json,
    extract::State,
    http::{StatusCode, header},
    response::IntoResponse,
};
use chrono::{DateTime, Utc};
use uuid::Uuid;

use super::{
    dto::{
        ContractListResponse, ContractResponse, CreateContractRequest, DownloadUrlResponse,
        ListContractsQuery, UpdateContractRequest,
    },
    repository::{self, ContractScope, NewContract},
};
use crate::{
    app_state::AppState,
    error::{ApiError, ErrorEnvelope},
    extract::{ApiJson, ApiPath, ApiQuery},
    modules::{
        auth::AuthUser,
        files::validation::{FileKind, SIGNATURE_LENGTH, artifact_max_bytes},
    },
};

#[derive(sqlx::FromRow)]
struct UploadRow {
    object_key: String,
    original_file_name: String,
    mime_type: String,
    declared_size_bytes: i64,
    register_before: DateTime<Utc>,
    consumed_at: Option<DateTime<Utc>>,
}

/// Lists the caller's contracts with pagination, search, filters and sorting.
#[utoipa::path(
    get,
    path = "/api/v1/contracts",
    tag = "Contracts",
    security(("bearer_auth" = [])),
    params(ListContractsQuery),
    responses(
        (status = 200, description = "A page of contracts", body = ContractListResponse),
        (status = 401, description = "Missing or invalid token", body = ErrorEnvelope,
            example = json!({"error": {"code": "UNAUTHENTICATED", "message": "Authentication is required"}})),
        (status = 422, description = "Invalid query parameters", body = ErrorEnvelope,
            example = json!({"error": {"code": "VALIDATION_ERROR", "message": "Invalid value for: per_page"}})),
    )
)]
pub async fn list_contracts(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
    ApiQuery(query): ApiQuery<ListContractsQuery>,
) -> Result<Json<ContractListResponse>, ApiError> {
    let (items, total) = repository::list_for_reader(&state.db, user.id, &query).await?;
    Ok(Json(ContractListResponse {
        items,
        page: query.page,
        per_page: query.per_page,
        total,
    }))
}

/// Registers a finished upload after inspecting the stored object.
/// New Word files must contain variables such as {{cliente_nombre}} in editable
/// text. Their exact source is preserved and they are immediately ready to
/// generate, with one field per variable and no Markdown conversion.
#[utoipa::path(
    post,
    path = "/api/v1/contracts",
    tag = "Contracts",
    security(("bearer_auth" = [])),
    request_body(content = CreateContractRequest, example = json!({
        "upload_id": "7f1d3a52-6c1e-4d0b-9a57-2f6b1c8e4a10",
        "name": "Contrato de arrendamiento",
        "description": "Plantilla base para vivienda"
    })),
    responses(
        (status = 201, description = "The contract was registered", body = ContractResponse),
        (status = 401, description = "Missing or invalid token", body = ErrorEnvelope,
            example = json!({"error": {"code": "UNAUTHENTICATED", "message": "Authentication is required"}})),
        (status = 404, description = "The upload does not exist or belongs to another user", body = ErrorEnvelope,
            example = json!({"error": {"code": "UPLOAD_NOT_FOUND", "message": "Upload not found"}})),
        (status = 409, description = "The file is not in storage yet, or the upload was already used", body = ErrorEnvelope,
            example = json!({"error": {"code": "UPLOAD_NOT_COMPLETED", "message": "The file has not finished uploading"}})),
        (status = 410, description = "The upload expired", body = ErrorEnvelope,
            example = json!({"error": {"code": "UPLOAD_EXPIRED", "message": "This upload has expired; request a new upload URL"}})),
        (status = 422, description = "Invalid sharing scope, upload mismatch, or a Word file is damaged, has no variables, or has invalid variables (VALIDATION_ERROR, UPLOAD_MISMATCH, INVALID_DOCX_TEMPLATE, DOCX_VARIABLES_REQUIRED, INVALID_DOCX_VARIABLES)", body = ErrorEnvelope,
            example = json!({"error": {"code": "UPLOAD_MISMATCH", "message": "The uploaded file does not match what was declared"}})),
    )
)]
pub async fn create_contract(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
    ApiJson(body): ApiJson<CreateContractRequest>,
) -> Result<impl IntoResponse, ApiError> {
    let name = required_text(&body.name, "name")?;
    let scope = contract_scope(body.company_id, body.shared_company_ids.as_deref())?;
    let upload: UploadRow = sqlx::query_as(
        "SELECT object_key, original_file_name, mime_type, declared_size_bytes,
                register_before, consumed_at
         FROM yzy_contracts.file_uploads
         WHERE id = $1 AND owner_id = $2",
    )
    .bind(body.upload_id)
    .bind(user.id)
    .fetch_optional(&state.db)
    .await?
    .ok_or(ApiError::UploadNotFound)?;

    if upload.consumed_at.is_some() {
        return Err(ApiError::UploadAlreadyUsed);
    }
    if upload.register_before <= Utc::now() {
        return Err(ApiError::UploadExpired);
    }

    // No transaction is open across these storage calls. The conditional UPDATE
    // in insert_consuming_upload settles any race afterwards.
    let object = state
        .storage
        .head(&upload.object_key)
        .await?
        .ok_or(ApiError::UploadNotCompleted)?;
    let kind = FileKind::from_mime(&upload.mime_type)
        .ok_or_else(|| ApiError::Internal(anyhow::anyhow!("stored upload has an unknown type")))?;
    let same_type = object
        .content_type
        .as_deref()
        .and_then(|value| value.split(';').next())
        .is_some_and(|value| value.trim().eq_ignore_ascii_case(kind.mime_type()));
    if object.size_bytes != upload.declared_size_bytes || !same_type {
        return Err(ApiError::UploadMismatch);
    }
    let prefix = state
        .storage
        .read_prefix(&upload.object_key, SIGNATURE_LENGTH)
        .await?;
    if !kind.matches_signature(&prefix) {
        return Err(ApiError::UploadMismatch);
    }

    let native_variables = if kind == FileKind::Docx {
        if object.size_bytes > artifact_max_bytes(state.config.upload_max_bytes) as i64 {
            return Err(ApiError::FileTooLarge);
        }
        let bytes = tokio::time::timeout(
            std::time::Duration::from_secs(20),
            state.storage.read_matching(&upload.object_key, &object),
        )
        .await
        .map_err(|_| ApiError::Timeout)??
        .ok_or(ApiError::UploadMismatch)?;
        Some(
            tokio::task::spawn_blocking(move || super::native_word::read_variables(&bytes))
                .await
                .map_err(|error| ApiError::Internal(error.into()))??,
        )
    } else {
        None
    };

    let id = repository::insert_consuming_upload(
        &state.db,
        NewContract {
            author: &user,
            upload_id: body.upload_id,
            scope: scope.unwrap_or_default(),
            name,
            description: body.description.as_deref(),
            original_file_name: &upload.original_file_name,
            mime_type: kind.mime_type(),
            size_bytes: object.size_bytes,
            object_key: &upload.object_key,
            object_etag: &object.etag,
            native_variables: native_variables.as_deref(),
        },
    )
    .await?
    .ok_or(ApiError::UploadAlreadyUsed)?;

    let contract = repository::find_for_reader(&state.db, user.id, id)
        .await?
        .ok_or(ApiError::ContractNotFound)?;
    Ok((
        StatusCode::CREATED,
        [(header::LOCATION, format!("/api/v1/contracts/{id}"))],
        Json(contract),
    ))
}

/// Returns one of the caller's contracts.
#[utoipa::path(
    get,
    path = "/api/v1/contracts/{id}",
    tag = "Contracts",
    security(("bearer_auth" = [])),
    params(("id" = Uuid, Path, description = "Contract ID")),
    responses(
        (status = 200, description = "The contract", body = ContractResponse),
        (status = 401, description = "Missing or invalid token", body = ErrorEnvelope,
            example = json!({"error": {"code": "UNAUTHENTICATED", "message": "Authentication is required"}})),
        (status = 404, description = "The contract does not exist or belongs to another user", body = ErrorEnvelope,
            example = json!({"error": {"code": "CONTRACT_NOT_FOUND", "message": "Contract not found"}})),
    )
)]
pub async fn get_contract(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
    ApiPath(id): ApiPath<Uuid>,
) -> Result<Json<ContractResponse>, ApiError> {
    repository::find_for_reader(&state.db, user.id, id)
        .await?
        .map(Json)
        .ok_or(ApiError::ContractNotFound)
}

/// Updates a contract's name, description or sharing scope. Omitted fields stay unchanged.
#[utoipa::path(
    patch,
    path = "/api/v1/contracts/{id}",
    tag = "Contracts",
    security(("bearer_auth" = [])),
    params(("id" = Uuid, Path, description = "Contract ID")),
    request_body(content = UpdateContractRequest, example = json!({
        "name": "Contrato de arrendamiento 2026",
        "description": null
    })),
    responses(
        (status = 200, description = "The updated contract", body = ContractResponse),
        (status = 401, description = "Missing or invalid token", body = ErrorEnvelope,
            example = json!({"error": {"code": "UNAUTHENTICATED", "message": "Authentication is required"}})),
        (status = 404, description = "The contract does not exist or belongs to another user", body = ErrorEnvelope,
            example = json!({"error": {"code": "CONTRACT_NOT_FOUND", "message": "Contract not found"}})),
        (status = 422, description = "The request is invalid", body = ErrorEnvelope,
            example = json!({"error": {"code": "VALIDATION_ERROR", "message": "Invalid value for: name"}})),
    )
)]
pub async fn update_contract(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
    ApiPath(id): ApiPath<Uuid>,
    ApiJson(body): ApiJson<UpdateContractRequest>,
) -> Result<Json<ContractResponse>, ApiError> {
    let scope = contract_scope(body.company_id, body.shared_company_ids.as_deref())?;
    if body.name.is_none() && body.description.is_none() && scope.is_none() {
        return Err(ApiError::Validation(
            "Provide at least one of: name, description, company_id, shared_company_ids".to_owned(),
        ));
    }
    let name = body
        .name
        .as_deref()
        .map(|name| required_text(name, "name"))
        .transpose()?;
    let description = body.description.as_ref().map(|value| value.as_deref());

    let updated =
        repository::update_for_owner(&state.db, &user, id, name, description, scope).await?;
    if !updated {
        return Err(ApiError::ContractNotFound);
    }
    repository::find_for_reader(&state.db, user.id, id)
        .await?
        .map(Json)
        .ok_or(ApiError::ContractNotFound)
}

fn contract_scope(
    company_id: Option<Option<Uuid>>,
    shared_company_ids: Option<&[Uuid]>,
) -> Result<Option<ContractScope<'_>>, ApiError> {
    if let Some(ids) = shared_company_ids {
        if company_id.is_some() {
            return Err(ApiError::Validation(
                "Provide either company_id or shared_company_ids".to_owned(),
            ));
        }
        if ids.iter().collect::<HashSet<_>>().len() != ids.len() {
            return Err(ApiError::Validation("Select distinct companies".to_owned()));
        }
        return Ok(Some(ContractScope {
            company_id: None,
            shared_company_ids: Some(ids),
        }));
    }
    Ok(company_id.map(|id| ContractScope {
        company_id: id,
        shared_company_ids: None,
    }))
}

/// Deletes a contract with its template and conversion history. The original
/// file is removed from storage by the worker shortly after.
#[utoipa::path(
    delete,
    path = "/api/v1/contracts/{id}",
    tag = "Contracts",
    security(("bearer_auth" = [])),
    params(("id" = Uuid, Path, description = "Contract ID")),
    responses(
        (status = 204, description = "The contract was deleted"),
        (status = 401, description = "Missing or invalid token", body = ErrorEnvelope,
            example = json!({"error": {"code": "UNAUTHENTICATED", "message": "Authentication is required"}})),
        (status = 404, description = "The contract does not exist or belongs to another user", body = ErrorEnvelope,
            example = json!({"error": {"code": "CONTRACT_NOT_FOUND", "message": "Contract not found"}})),
    )
)]
pub async fn delete_contract(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
    ApiPath(id): ApiPath<Uuid>,
) -> Result<StatusCode, ApiError> {
    if repository::soft_delete_for_owner(&state.db, user.id, id).await? {
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err(ApiError::ContractNotFound)
    }
}

/// Issues a temporary URL to download the original file. Added beyond the agreed
/// endpoint list because the requirement for authorized downloads needs a route.
#[utoipa::path(
    get,
    path = "/api/v1/contracts/{id}/download-url",
    tag = "Contracts",
    security(("bearer_auth" = [])),
    params(("id" = Uuid, Path, description = "Contract ID")),
    responses(
        (status = 200, description = "A temporary download URL", body = DownloadUrlResponse),
        (status = 401, description = "Missing or invalid token", body = ErrorEnvelope,
            example = json!({"error": {"code": "UNAUTHENTICATED", "message": "Authentication is required"}})),
        (status = 404, description = "The contract does not exist or belongs to another user", body = ErrorEnvelope,
            example = json!({"error": {"code": "CONTRACT_NOT_FOUND", "message": "Contract not found"}})),
    )
)]
pub async fn get_download_url(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
    ApiPath(id): ApiPath<Uuid>,
) -> Result<Json<DownloadUrlResponse>, ApiError> {
    let object = repository::stored_object_for_reader(&state.db, user.id, id)
        .await?
        .ok_or(ApiError::ContractNotFound)?;
    let ttl = state.config.presign_download_ttl;
    let url = state
        .storage
        .presign_get(&object.object_key, Some(&object.original_file_name), ttl)
        .await?;
    Ok(Json(DownloadUrlResponse {
        url,
        expires_at: Utc::now() + ttl,
    }))
}

fn required_text<'a>(value: &'a str, field: &str) -> Result<&'a str, ApiError> {
    let trimmed = value.trim();
    if trimmed.is_empty() || trimmed.contains('\0') {
        return Err(ApiError::Validation(format!("Invalid value for: {field}")));
    }
    Ok(trimmed)
}
