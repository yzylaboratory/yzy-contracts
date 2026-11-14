use std::time::Duration;

use axum::{
    Extension, Json,
    extract::{DefaultBodyLimit, MatchedPath, Request, State, rejection::JsonRejection},
    http::{Method, StatusCode},
    middleware::Next,
    response::Response,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use tokio::sync::Semaphore;
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
    extract::{ApiPath, ApiQuery},
    modules::auth::AuthUser,
};

use super::{TourStep, default_page, default_per_page, repository};

const WRITE_TIMEOUT: Duration = Duration::from_millis(250);
const ACTION_WRITE_TIMEOUT: Duration = Duration::from_secs(1);
static ACTION_WRITES: Semaphore = Semaphore::const_new(16);

pub(crate) fn activity_events_router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new().routes(routes!(record_activity_event).layer(DefaultBodyLimit::max(1024)))
}

pub(crate) fn timeline_router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new().routes(routes!(list_activity_events))
}

#[derive(Clone, Copy, Deserialize, Serialize, ToSchema, sqlx::Type)]
#[serde(rename_all = "snake_case")]
#[sqlx(type_name = "text", rename_all = "snake_case")]
pub(super) enum ActivityScreen {
    Dashboard,
    Clients,
    ClientRecord,
    Contracts,
    ContractCreate,
    ContractEdit,
    DocumentGenerate,
    GeneratedDocuments,
    Settings,
    Administration,
    Billing,
    Preaccess,
    Login,
    NotFound,
}

#[derive(Clone, Copy, Deserialize, Serialize, ToSchema, sqlx::Type)]
#[serde(rename_all = "snake_case")]
#[sqlx(type_name = "text", rename_all = "snake_case")]
pub(super) enum ActivityEventKind {
    PortalVisit,
    PortalRedirect,
    NotFound,
    DocumentPreviewed,
    ClientCreated,
    ClientUpdated,
    OperationCreated,
    OperationUpdated,
    GenerationAccess,
    DocumentRender,
    DocumentExport,
    PortalAccess,
    TourOpened,
    TourStepViewed,
    TourCompleted,
    TourSkipped,
    DocumentGenerated,
    InvitationRegistered,
    InvitationSent,
}

#[derive(Clone, Copy, Deserialize, Serialize, ToSchema, sqlx::Type)]
#[serde(rename_all = "snake_case")]
#[sqlx(type_name = "text", rename_all = "snake_case")]
pub(super) enum ActivityResult {
    Observed,
    Success,
    Blocked,
    Failed,
}

#[derive(Clone, Copy, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
enum ClientActivityEventKind {
    PortalVisit,
    PortalRedirect,
    NotFound,
    DocumentPreviewed,
}

#[derive(Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
struct ActivityEventInput {
    event_id: Uuid,
    event: ClientActivityEventKind,
    screen: ActivityScreen,
}

pub(super) struct NewActivityEvent {
    pub(super) client_event_id: Option<Uuid>,
    pub(super) event: ActivityEventKind,
    pub(super) screen: ActivityScreen,
    pub(super) result: ActivityResult,
}

/// Records a fixed portal observation for the authenticated account, including pending accounts.
/// For a redirect, screen names the original requested screen. Reusing an event ID acknowledges the first write.
#[utoipa::path(
    post, path = "/api/v1/me/activity-events", tag = "Users", security(("bearer_auth" = [])),
    request_body = ActivityEventInput,
    responses(
        (status = 204, description = "The event was recorded or already acknowledged"),
        (status = 401, description = "Missing or invalid token", body = ErrorEnvelope),
        (status = 403, description = "The account was deleted", body = ErrorEnvelope),
        (status = 413, description = "The request body exceeds 1024 bytes", body = ErrorEnvelope),
        (status = 422, description = "Invalid activity event or screen", body = ErrorEnvelope),
        (status = 429, description = "The account recorded 240 distinct portal observations in the past hour", body = ErrorEnvelope),
        (status = 503, description = "Authentication or recording is temporarily unavailable", body = ErrorEnvelope),
    )
)]
async fn record_activity_event(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
    payload: Result<Json<ActivityEventInput>, JsonRejection>,
) -> Result<StatusCode, ApiError> {
    let Json(input) = payload.map_err(|rejection| {
        if rejection.status() == StatusCode::PAYLOAD_TOO_LARGE {
            ApiError::PayloadTooLarge
        } else {
            ApiError::Validation("Invalid activity event".into())
        }
    })?;
    let event = match (input.event, input.screen) {
        (ClientActivityEventKind::PortalVisit, _) => ActivityEventKind::PortalVisit,
        (ClientActivityEventKind::PortalRedirect, _) => ActivityEventKind::PortalRedirect,
        (ClientActivityEventKind::NotFound, ActivityScreen::NotFound) => {
            ActivityEventKind::NotFound
        }
        (ClientActivityEventKind::DocumentPreviewed, ActivityScreen::DocumentGenerate) => {
            ActivityEventKind::DocumentPreviewed
        }
        _ => return Err(ApiError::Validation("Invalid activity event".into())),
    };
    if input.event_id.is_nil() {
        return Err(ApiError::Validation("Invalid activity event".into()));
    }
    let activity = NewActivityEvent {
        client_event_id: Some(input.event_id),
        event,
        screen: input.screen,
        result: ActivityResult::Observed,
    };
    let recorded = tokio::time::timeout(
        WRITE_TIMEOUT,
        repository::record_event(&state.db, user.id, activity),
    )
    .await
    .map_err(|_| ApiError::Unavailable)??;
    if !recorded {
        return Err(ApiError::ActivityRateLimited);
    }
    Ok(StatusCode::NO_CONTENT)
}

pub(crate) async fn observe_action(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
    request: Request,
    next: Next,
) -> Response {
    let route = request
        .extensions()
        .get::<MatchedPath>()
        .map(MatchedPath::as_str);
    let action = route.and_then(|route| match (request.method(), route) {
        (&Method::POST, "/api/v1/clients") => Some((
            ActivityEventKind::ClientCreated,
            ActivityScreen::Clients,
            false,
        )),
        (&Method::PATCH, "/api/v1/clients/{client_id}") => Some((
            ActivityEventKind::ClientUpdated,
            ActivityScreen::ClientRecord,
            false,
        )),
        (&Method::POST, "/api/v1/clients/{client_id}/operations") => Some((
            ActivityEventKind::OperationCreated,
            ActivityScreen::ClientRecord,
            false,
        )),
        (
            &Method::PATCH,
            "/api/v1/companies/{company_id}/clients/{client_id}/operations/{operation_id}",
        ) => Some((
            ActivityEventKind::OperationUpdated,
            ActivityScreen::ClientRecord,
            false,
        )),
        (&Method::GET, "/api/v1/contracts/{id}/generation-access") => Some((
            ActivityEventKind::GenerationAccess,
            ActivityScreen::DocumentGenerate,
            true,
        )),
        (&Method::POST, "/api/v1/contracts/{id}/render-pdf") => Some((
            ActivityEventKind::DocumentRender,
            ActivityScreen::DocumentGenerate,
            true,
        )),
        (
            &Method::PUT,
            "/api/v1/generated-documents/{id}" | "/api/v1/generated-documents/{id}/artifact",
        ) => Some((
            ActivityEventKind::DocumentExport,
            ActivityScreen::DocumentGenerate,
            true,
        )),
        _ => None,
    });
    let response = next.run(request).await;
    if let Some((event, screen, failures_only)) = action {
        let result = match response.status() {
            StatusCode::UNAUTHORIZED | StatusCode::PAYMENT_REQUIRED | StatusCode::FORBIDDEN => {
                ActivityResult::Blocked
            }
            status if status.is_client_error() || status.is_server_error() => {
                ActivityResult::Failed
            }
            status if status.is_success() && !failures_only => ActivityResult::Success,
            _ => return response,
        };
        let activity = NewActivityEvent {
            client_event_id: None,
            event,
            screen,
            result,
        };
        // Isolate telemetry from the response deadline and cap concurrent writes.
        if let Ok(permit) = ACTION_WRITES.try_acquire() {
            tokio::spawn(async move {
                let _permit = permit;
                let result = tokio::time::timeout(
                    ACTION_WRITE_TIMEOUT,
                    repository::record_event(&state.db, user.id, activity),
                )
                .await;
                if !matches!(result, Ok(Ok(_))) {
                    tracing::warn!("could not record portal action");
                }
            });
        }
    }
    response
}

#[derive(Deserialize, Serialize, ToSchema)]
pub(super) struct ActivityEvent {
    event: ActivityEventKind,
    #[schema(required = true)]
    screen: Option<ActivityScreen>,
    result: ActivityResult,
    occurred_at: DateTime<Utc>,
    #[schema(required = true)]
    step: Option<TourStep>,
}

#[derive(Deserialize, Validate, IntoParams)]
#[serde(deny_unknown_fields)]
#[into_params(parameter_in = Query)]
pub(super) struct ActivityEventsQuery {
    #[serde(default = "default_page")]
    #[validate(range(min = 1))]
    #[param(minimum = 1, default = 1)]
    pub(super) page: i64,
    #[serde(default = "default_per_page")]
    #[validate(range(min = 1, max = 100))]
    #[param(minimum = 1, maximum = 100, default = 25)]
    pub(super) per_page: i64,
}

#[derive(Serialize, ToSchema)]
pub(super) struct ActivityEventsPage {
    pub(super) items: Vec<ActivityEvent>,
    pub(super) page: i64,
    pub(super) per_page: i64,
    pub(super) total: i64,
}

/// Lists the selected account's private activity, most recent first.
#[utoipa::path(
    get, path = "/api/v1/admin/activity/{user_id}/events", tag = "Administration",
    security(("bearer_auth" = [])),
    params(("user_id" = Uuid, Path), ActivityEventsQuery),
    responses(
        (status = 200, description = "The requested activity timeline page", body = ActivityEventsPage),
        (status = 401, description = "Missing or invalid token", body = ErrorEnvelope),
        (status = 403, description = "Superadministrator access is required", body = ErrorEnvelope),
        (status = 404, description = "The user was not found", body = ErrorEnvelope),
        (status = 422, description = "Invalid user identifier or pagination", body = ErrorEnvelope),
        (status = 503, description = "The signing keys could not be retrieved", body = ErrorEnvelope),
    )
)]
async fn list_activity_events(
    State(state): State<AppState>,
    ApiPath(user_id): ApiPath<Uuid>,
    ApiQuery(query): ApiQuery<ActivityEventsQuery>,
) -> Result<Json<ActivityEventsPage>, ApiError> {
    let page = repository::list_events(&state.db, user_id, query)
        .await?
        .ok_or(ApiError::AccessUserNotFound)?;
    Ok(Json(page))
}
