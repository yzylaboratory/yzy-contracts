pub mod repository;

use axum::{Extension, Json, extract::State, http::StatusCode};
use chrono::{DateTime, Utc};
use serde::Serialize;
use serde_json::Value;
use utoipa::ToSchema;
use utoipa_axum::{router::OpenApiRouter, routes};
use uuid::Uuid;

use crate::{
    app_state::AppState,
    error::{ApiError, ErrorEnvelope},
    extract::ApiPath,
    modules::auth::AuthUser,
};

pub fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new()
        .routes(routes!(start_conversion))
        .routes(routes!(get_conversion))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ConversionStatus {
    Pending,
    Processing,
    Completed,
    Failed,
}

impl TryFrom<String> for ConversionStatus {
    type Error = String;

    fn try_from(value: String) -> Result<Self, Self::Error> {
        match value.as_str() {
            "pending" => Ok(Self::Pending),
            "processing" => Ok(Self::Processing),
            "completed" => Ok(Self::Completed),
            "failed" => Ok(Self::Failed),
            _ => Err(format!("unknown conversion status: {value}")),
        }
    }
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow, ToSchema)]
pub struct ConversionResponse {
    pub id: Uuid,
    pub contract_id: Uuid,
    #[sqlx(try_from = "String")]
    pub status: ConversionStatus,
    #[schema(example = 1)]
    pub attempts: i32,
    #[schema(example = 3)]
    pub max_attempts: i32,
    /// Present on failure, and while a retry is scheduled.
    #[schema(example = "EMPTY_EXTRACTION")]
    pub error_code: Option<String>,
    pub error_message: Option<String>,
    /// Extraction limitations the user should review, such as pages that needed OCR.
    #[schema(value_type = Vec<Object>, example = json!([{"code": "OCR_APPLIED", "message": "Part of the text was read with OCR. Review it against the original."}]))]
    pub warnings: Value,
    pub page_count: Option<i32>,
    /// Present once the conversion completes.
    pub template_id: Option<Uuid>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub completed_at: Option<DateTime<Utc>>,
}

/// Queues a conversion to Markdown and returns immediately. If one is already
/// queued or running, that one is returned instead of starting a duplicate.
#[utoipa::path(
    post,
    path = "/api/v1/contracts/{id}/convert",
    tag = "Conversions",
    security(("bearer_auth" = [])),
    params(("id" = Uuid, Path, description = "Contract ID")),
    responses(
        (status = 202, description = "The conversion is queued or already active", body = ConversionResponse),
        (status = 401, description = "Missing or invalid token", body = ErrorEnvelope,
            example = json!({"error": {"code": "UNAUTHENTICATED", "message": "Authentication is required"}})),
        (status = 404, description = "The contract does not exist or belongs to another user", body = ErrorEnvelope,
            example = json!({"error": {"code": "CONTRACT_NOT_FOUND", "message": "Contract not found"}})),
        (status = 409, description = "A template exists; converting again would overwrite its edits", body = ErrorEnvelope,
            example = json!({"error": {"code": "CONTRACT_ALREADY_CONVERTED", "message": "This contract already has a template"}})),
    )
)]
pub async fn start_conversion(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
    ApiPath(contract_id): ApiPath<Uuid>,
) -> Result<(StatusCode, Json<ConversionResponse>), ApiError> {
    let job = repository::enqueue(
        &state.db,
        user.id,
        contract_id,
        state.config.conversion_max_attempts,
    )
    .await?;
    Ok((StatusCode::ACCEPTED, Json(job)))
}

/// Returns the state of one of the caller's conversions.
#[utoipa::path(
    get,
    path = "/api/v1/conversions/{id}",
    tag = "Conversions",
    security(("bearer_auth" = [])),
    params(("id" = Uuid, Path, description = "Conversion ID")),
    responses(
        (status = 200, description = "The conversion", body = ConversionResponse),
        (status = 401, description = "Missing or invalid token", body = ErrorEnvelope,
            example = json!({"error": {"code": "UNAUTHENTICATED", "message": "Authentication is required"}})),
        (status = 404, description = "The conversion does not exist or belongs to another user", body = ErrorEnvelope,
            example = json!({"error": {"code": "CONVERSION_NOT_FOUND", "message": "Conversion not found"}})),
    )
)]
pub async fn get_conversion(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
    ApiPath(id): ApiPath<Uuid>,
) -> Result<Json<ConversionResponse>, ApiError> {
    repository::find_for_reader(&state.db, user.id, id)
        .await?
        .map(Json)
        .ok_or(ApiError::ConversionNotFound)
}
