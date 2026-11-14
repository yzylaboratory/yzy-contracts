pub mod validation;

use std::{collections::BTreeMap, time::Duration};

use axum::{Extension, Json, extract::State, http::StatusCode};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use utoipa_axum::{router::OpenApiRouter, routes};
use uuid::Uuid;
use validator::Validate;

use crate::{
    app_state::AppState,
    error::{ApiError, ErrorEnvelope},
    extract::ApiJson,
    modules::auth::AuthUser,
};

/// Time to register the contract after the upload URL itself has expired, so an
/// upload that started just before expiry can still be registered.
const REGISTER_GRACE: Duration = Duration::from_secs(15 * 60);

pub fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new().routes(routes!(create_upload_url))
}

#[derive(Debug, Deserialize, Validate, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct CreateUploadUrlRequest {
    #[validate(length(min = 1, max = 255))]
    #[schema(example = "contrato-arrendamiento.pdf")]
    pub file_name: String,
    #[schema(example = "application/pdf")]
    pub mime_type: String,
    #[schema(example = 245760)]
    pub size_bytes: i64,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct CreateUploadUrlResponse {
    /// Pass this to `POST /api/v1/contracts` once the upload finishes.
    pub upload_id: Uuid,
    pub upload_url: String,
    #[schema(example = "PUT")]
    pub method: String,
    /// Send these headers verbatim on the upload. They are part of the signature.
    pub headers: BTreeMap<String, String>,
    pub expires_at: DateTime<Utc>,
    /// Latest moment to register the contract.
    pub register_before: DateTime<Utc>,
}

/// Issues a temporary URL for uploading a file directly to private storage. The
/// file does not pass through this API.
#[utoipa::path(
    post,
    path = "/api/v1/files/upload-url",
    tag = "Files",
    security(("bearer_auth" = [])),
    request_body(content = CreateUploadUrlRequest, example = json!({
        "file_name": "contrato-arrendamiento.pdf",
        "mime_type": "application/pdf",
        "size_bytes": 245760
    })),
    responses(
        (status = 201, description = "The upload URL was issued", body = CreateUploadUrlResponse),
        (status = 401, description = "Missing or invalid token", body = ErrorEnvelope,
            example = json!({"error": {"code": "UNAUTHENTICATED", "message": "Authentication is required"}})),
        (status = 413, description = "The declared size exceeds the limit", body = ErrorEnvelope,
            example = json!({"error": {"code": "FILE_TOO_LARGE", "message": "The file exceeds the maximum allowed size"}})),
        (status = 415, description = "Only PDF and DOCX are accepted", body = ErrorEnvelope,
            example = json!({"error": {"code": "UNSUPPORTED_FILE_TYPE", "message": "Only PDF and DOCX files are supported"}})),
        (status = 422, description = "The request is invalid", body = ErrorEnvelope,
            example = json!({"error": {"code": "VALIDATION_ERROR", "message": "Invalid value for: file_name"}})),
    )
)]
pub async fn create_upload_url(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
    ApiJson(body): ApiJson<CreateUploadUrlRequest>,
) -> Result<(StatusCode, Json<CreateUploadUrlResponse>), ApiError> {
    let file = validation::validate_upload(
        &body.file_name,
        &body.mime_type,
        body.size_bytes,
        state.config.upload_max_bytes,
    )?;

    let upload_id = Uuid::new_v4();
    // The key contains identifiers only, never the user's file name.
    let object_key = format!(
        "users/{}/uploads/{upload_id}.{}",
        user.id,
        file.kind.extension()
    );
    let ttl = state.config.presign_upload_ttl;
    let expires_at = Utc::now() + ttl;
    let register_before = expires_at + REGISTER_GRACE;

    let presigned = state
        .storage
        .presign_put(&object_key, file.kind.mime_type(), body.size_bytes, ttl)
        .await?;

    sqlx::query(
        "INSERT INTO yzy_contracts.file_uploads
           (id, owner_id, object_key, original_file_name, mime_type, declared_size_bytes, register_before)
         VALUES ($1, $2, $3, $4, $5, $6, $7)",
    )
    .bind(upload_id)
    .bind(user.id)
    .bind(&object_key)
    .bind(&file.file_name)
    .bind(file.kind.mime_type())
    .bind(body.size_bytes)
    .bind(register_before)
    .execute(&state.db)
    .await?;

    Ok((
        StatusCode::CREATED,
        Json(CreateUploadUrlResponse {
            upload_id,
            upload_url: presigned.url,
            method: "PUT".to_owned(),
            headers: presigned.headers.into_iter().collect(),
            expires_at,
            register_before,
        }),
    ))
}
