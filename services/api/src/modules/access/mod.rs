mod activity;
mod admin;
mod dashboard;

use axum::{Extension, extract::Request, middleware::Next, response::Response};
use serde::Serialize;
use sqlx::PgPool;
use utoipa::ToSchema;
use utoipa_axum::router::OpenApiRouter;
use uuid::Uuid;

const LEGACY_MAIL_MAX_ATTEMPTS: i32 = 6;

use crate::{app_state::AppState, error::ApiError, modules::auth::AuthUser};

pub(crate) use activity::{
    activity_events_router, observe_action, observe_portal_access, tour_router,
};

pub fn admin_router() -> OpenApiRouter<AppState> {
    admin::router()
}

#[derive(Debug, Serialize, ToSchema, sqlx::FromRow)]
pub struct CompanyAccess {
    pub id: Uuid,
    pub name: String,
}

#[derive(Debug, Clone, Copy, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum Notice {
    Queued,
    Sent,
    Unavailable,
}

pub async fn confirmed_email(db: &PgPool, user: Uuid) -> Result<Option<String>, ApiError> {
    Ok(
        sqlx::query_scalar::<_, Option<String>>(
            "SELECT yzy_contracts.confirmed_identity_email($1)",
        )
        .bind(user)
        .fetch_one(db)
        .await?,
    )
}

pub async fn require_admin(
    Extension(user): Extension<AuthUser>,
    request: Request,
    next: Next,
) -> Result<Response, ApiError> {
    if !user.superadmin {
        return Err(ApiError::AdminRequired);
    }
    Ok(next.run(request).await)
}

pub async fn no_store(request: Request, next: Next) -> Response {
    let mut response = next.run(request).await;
    response.headers_mut().insert(
        axum::http::header::CACHE_CONTROL,
        axum::http::HeaderValue::from_static("private, no-store"),
    );
    response
}

pub async fn complete_onboarding(db: &PgPool, actor: Uuid) -> Result<(), ApiError> {
    // Recheck eligibility in the write's snapshot in case access changed after the guard.
    let eligible: bool = sqlx::query_scalar(
        "WITH eligible AS (
            SELECT p.user_id FROM yzy_contracts.profiles p
            WHERE p.user_id = $1 AND p.account_status = 'active'
              AND yzy_contracts.has_enabled_access($1)
         ), completion AS (
            INSERT INTO yzy_contracts.onboarding_completions (user_id)
            SELECT user_id FROM eligible ON CONFLICT (user_id) DO NOTHING
         )
         SELECT EXISTS (SELECT 1 FROM eligible)",
    )
    .bind(actor)
    .fetch_one(db)
    .await?;
    if !eligible {
        return Err(ApiError::AccessPending);
    }
    Ok(())
}

fn notice_for(attempts: i32, sent: bool) -> Notice {
    if sent {
        Notice::Sent
    } else if attempts >= LEGACY_MAIL_MAX_ATTEMPTS {
        Notice::Unavailable
    } else {
        Notice::Queued
    }
}
