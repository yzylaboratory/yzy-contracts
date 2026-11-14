use axum::{Json, extract::State};
use serde::Serialize;
use utoipa::ToSchema;
use utoipa_axum::{router::OpenApiRouter, routes};

use crate::{
    app_state::AppState,
    error::{ApiError, ErrorEnvelope},
};

pub fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new().routes(routes!(health))
}

#[derive(Debug, Serialize, ToSchema)]
pub struct HealthResponse {
    #[schema(example = "ok")]
    pub status: String,
}

/// Reports whether the API can reach its database.
#[utoipa::path(
    get,
    path = "/api/v1/health",
    tag = "System",
    responses(
        (status = 200, description = "The service is healthy", body = HealthResponse,
            example = json!({"status": "ok"})),
        (status = 503, description = "The database is unreachable", body = ErrorEnvelope,
            example = json!({"error": {"code": "SERVICE_UNAVAILABLE", "message": "The service is temporarily unavailable"}})),
    )
)]
pub async fn health(State(state): State<AppState>) -> Result<Json<HealthResponse>, ApiError> {
    sqlx::query("SELECT 1")
        .execute(&state.db)
        .await
        .map_err(|error| {
            tracing::error!(%error, "health check could not reach the database");
            ApiError::Unavailable
        })?;
    Ok(Json(HealthResponse {
        status: "ok".to_owned(),
    }))
}
