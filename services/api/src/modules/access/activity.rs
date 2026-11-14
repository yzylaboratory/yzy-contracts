mod events;
mod repository;

use std::time::Duration;

use axum::{
    Extension, Json,
    extract::{DefaultBodyLimit, State, rejection::JsonRejection},
    http::StatusCode,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use utoipa::{IntoParams, ToSchema};
use utoipa_axum::{
    router::{OpenApiRouter, UtoipaMethodRouterExt},
    routes,
};
use uuid::Uuid;
use validator::Validate;

use crate::{
    app_state::AppState,
    error::{ApiError, ErrorEnvelope},
    extract::ApiQuery,
    modules::auth::AuthUser,
};

use super::admin::UserStatus;
use events::ActivityEvent;
pub(crate) use events::{activity_events_router, observe_action, timeline_router};

pub(crate) fn tour_router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new().routes(routes!(record_tour_event).layer(DefaultBodyLimit::max(1024)))
}

#[derive(Clone, Copy, Deserialize, ToSchema, sqlx::Type)]
#[serde(rename_all = "snake_case")]
#[sqlx(type_name = "text", rename_all = "snake_case")]
enum TourEventKind {
    Opened,
    StepViewed,
    Completed,
    Skipped,
}

#[derive(Clone, Copy, Deserialize, Serialize, ToSchema, sqlx::Type)]
#[serde(rename_all = "kebab-case")]
#[sqlx(type_name = "text", rename_all = "kebab-case")]
enum TourStep {
    Clients,
    Company,
    Client,
    ClientForm,
    Operation,
    OperationForm,
    Prepare,
    Type,
    Template,
    Continue,
    DocumentFields,
    Preview,
    Export,
    History,
    Done,
}

#[derive(Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
struct TourEventInput {
    run_id: Uuid,
    event: TourEventKind,
    step: TourStep,
}

/// Records an authenticated tour event at the server's time of observation.
///
/// Each account and run has at most one opening and one terminal outcome.
/// Repeated events and later terminal outcomes are acknowledged without changes.
/// A run ID must be non-nil and a completion must use the done step.
#[utoipa::path(
    post, path = "/api/v1/me/tour-events", tag = "Users", security(("bearer_auth" = [])),
    request_body = TourEventInput,
    responses(
        (status = 204, description = "The event was recorded or already acknowledged"),
        (status = 401, description = "Missing or invalid token", body = ErrorEnvelope),
        (status = 403, description = "The account lacks active business access", body = ErrorEnvelope),
        (status = 413, description = "The request body exceeds 1024 bytes", body = ErrorEnvelope),
        (status = 422, description = "Invalid tour event", body = ErrorEnvelope),
        (status = 429, description = "The account recorded 120 distinct events in the past hour", body = ErrorEnvelope),
        (status = 503, description = "The signing keys could not be retrieved", body = ErrorEnvelope),
    )
)]
async fn record_tour_event(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
    payload: Result<Json<TourEventInput>, JsonRejection>,
) -> Result<StatusCode, ApiError> {
    let Json(event) = payload.map_err(|rejection| {
        if rejection.status() == StatusCode::PAYLOAD_TOO_LARGE {
            ApiError::PayloadTooLarge
        } else {
            ApiError::Validation("Invalid tour event".into())
        }
    })?;
    if event.run_id.is_nil()
        || (matches!(event.event, TourEventKind::Completed)
            && !matches!(event.step, TourStep::Done))
    {
        return Err(ApiError::Validation("Invalid tour event".into()));
    }
    repository::record_tour_event(&state.db, user.id, event).await?;
    Ok(StatusCode::NO_CONTENT)
}

pub(crate) async fn observe_portal_access(db: &PgPool, user_id: Uuid) {
    let result = tokio::time::timeout(
        Duration::from_millis(250),
        repository::observe_portal_access(db, user_id),
    )
    .await;
    if !matches!(result, Ok(Ok(()))) {
        tracing::warn!("could not record authenticated portal access");
    }
}

fn default_page() -> i64 {
    1
}

fn default_per_page() -> i64 {
    25
}

#[derive(Deserialize, Validate, IntoParams)]
#[serde(deny_unknown_fields)]
#[into_params(parameter_in = Query)]
pub(super) struct ActivityQuery {
    #[validate(length(max = 200))]
    #[param(max_length = 200)]
    query: Option<String>,
    #[serde(default = "default_page")]
    #[validate(range(min = 1))]
    #[param(minimum = 1, default = 1)]
    page: i64,
    #[serde(default = "default_per_page")]
    #[validate(range(min = 1, max = 100))]
    #[param(minimum = 1, maximum = 100, default = 25)]
    per_page: i64,
}

#[derive(Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
enum TourOutcome {
    Completed,
    Skipped,
}

#[derive(Deserialize, Serialize, ToSchema)]
struct ActivityTour {
    opened_at: DateTime<Utc>,
    /// Last distinct step observed, or the first terminal event's closing step.
    last_step: TourStep,
    /// Server observation time for that event. Revisiting a known step does not update it.
    last_step_at: DateTime<Utc>,
    outcome: Option<TourOutcome>,
    outcome_at: Option<DateTime<Utc>>,
}

#[derive(Deserialize, Serialize, ToSchema)]
struct ActivityItem {
    id: Option<Uuid>,
    name: Option<String>,
    email: String,
    status: UserStatus,
    invited_at: Option<DateTime<Utc>>,
    invitation_sent_at: Option<DateTime<Utc>>,
    invitation_accepted: bool,
    /// First observed authenticated GET /me with an active company.
    first_portal_access_at: Option<DateTime<Utc>>,
    /// Most recent persisted observation, updated at most once per five minutes.
    last_portal_access_at: Option<DateTime<Utc>>,
    /// Most recently opened observed run. Terminal events fix its final step.
    last_tour: Option<ActivityTour>,
    /// Existing onboarding completion state, including historical backfills.
    onboarding_completed_at: Option<DateTime<Utc>>,
    /// Saved documents owned by this account, excluding imports.
    documents_generated: i64,
    last_document_generated_at: Option<DateTime<Utc>>,
    /// Latest timeline entry, or the latest invitation milestone before an account is linked.
    #[schema(required = true)]
    last_activity: Option<ActivityEvent>,
}

#[derive(Serialize, ToSchema)]
pub(super) struct ActivityPage {
    items: Vec<ActivityItem>,
    page: i64,
    per_page: i64,
    total: i64,
}

/// Lists private portal activity for the accounts and invitations visible in Users.
#[utoipa::path(
    get, path = "/api/v1/admin/activity", tag = "Administration", security(("bearer_auth" = [])),
    params(ActivityQuery),
    responses(
        (status = 200, description = "The requested activity page", body = ActivityPage),
        (status = 401, description = "Missing or invalid token", body = ErrorEnvelope),
        (status = 403, description = "Superadministrator access is required", body = ErrorEnvelope),
        (status = 422, description = "Invalid pagination or search query", body = ErrorEnvelope),
        (status = 503, description = "The signing keys could not be retrieved", body = ErrorEnvelope),
    )
)]
pub(super) async fn list(
    State(state): State<AppState>,
    ApiQuery(query): ApiQuery<ActivityQuery>,
) -> Result<Json<ActivityPage>, ApiError> {
    let page = repository::list(&state.db, state.config.superadmin_id, query).await?;
    Ok(Json(page))
}
