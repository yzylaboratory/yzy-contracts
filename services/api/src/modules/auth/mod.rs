pub mod jwt;
pub mod middleware;

use axum::{Extension, Json, extract::State, http::StatusCode};
use serde::Serialize;
use utoipa::ToSchema;
use utoipa_axum::{router::OpenApiRouter, routes};
use uuid::Uuid;

use crate::{
    app_state::AppState,
    error::{ApiError, ErrorEnvelope},
    modules::access::{self, CompanyAccess, Notice},
    modules::billing::{
        dto::{BillingAlert, BillingAlertKind},
        repository::{self as billing_repo, REMINDER_DAY_OFFSET, SUSPEND_DAY_OFFSET},
    },
};

pub use middleware::AuthUser;

pub fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new()
        .routes(routes!(me))
        .merge(access::activity_events_router())
        .route_layer(axum::middleware::from_fn(access::no_store))
}

pub fn onboarding_router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new()
        .routes(routes!(complete_onboarding))
        .merge(access::tour_router())
}

#[derive(Debug, Serialize, ToSchema)]
pub struct MeResponse {
    pub id: Uuid,
    #[schema(example = "nombre@ejemplo.test")]
    pub email: Option<String>,
    pub role: AccessRole,
    pub access: AccessStatus,
    pub companies: Vec<CompanyAccess>,
    pub notice: Option<Notice>,
    /// Pending membership payment alert for billing managers (from day 7).
    pub billing_alert: Option<BillingAlert>,
    pub can_manage_billing: bool,
    /// Active companies assigned to this billing manager.
    pub billing_company_ids: Vec<Uuid>,
    /// Companies whose workspace is suspended (unpaid past day 15).
    pub overdue_company_ids: Vec<Uuid>,
    /// Suspended companies in a billing account the caller can manage.
    pub manageable_overdue_company_ids: Vec<Uuid>,
    /// Maximum accepted size, in bytes, for an original contract upload.
    pub upload_max_bytes: i64,
    /// Whether the portal should show onboarding.
    pub onboarding_pending: bool,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum AccessRole {
    Superadmin,
    Member,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum AccessStatus {
    Active,
    Pending,
}

/// Returns the caller's access. Enabled people and the superadministrator see every active company.
#[utoipa::path(
    get,
    path = "/api/v1/me",
    tag = "Users",
    security(("bearer_auth" = [])),
    responses(
        (status = 200, description = "The authenticated user", body = MeResponse),
        (status = 401, description = "Missing or invalid token", body = ErrorEnvelope,
            example = json!({"error": {"code": "UNAUTHENTICATED", "message": "Authentication is required"}})),
        (status = 403, description = "The account was deleted or the superadministrator login lacks its confirmed email", body = ErrorEnvelope,
            example = json!({"error": {"code": "ADMIN_REQUIRED", "message": "Administrator access is required"}})),
        (status = 503, description = "The signing keys could not be retrieved", body = ErrorEnvelope,
            example = json!({"error": {"code": "AUTH_UNAVAILABLE", "message": "Authentication is temporarily unavailable"}})),
    )
)]
pub async fn me(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
) -> Result<Json<MeResponse>, ApiError> {
    let companies: Vec<CompanyAccess> = if user.enabled {
        sqlx::query_as(
            "SELECT id, name FROM companies
             WHERE archived_at IS NULL ORDER BY is_default DESC, lower(name), id",
        )
        .fetch_all(&state.db)
        .await?
    } else {
        Vec::new()
    };
    if !companies.is_empty() {
        access::observe_portal_access(&state.db, user.id).await;
    }
    let (can_manage_billing, billing_company_ids) = if user.superadmin {
        (true, companies.iter().map(|company| company.id).collect())
    } else if user.enabled {
        sqlx::query_as(
            "SELECT EXISTS (
               SELECT 1 FROM billing_account_managers WHERE user_id = $1
             ),
             ARRAY(SELECT billing_companies_for($1))",
        )
        .bind(user.id)
        .fetch_one(&state.db)
        .await?
    } else {
        (false, Vec::new())
    };
    let suspended = if user.enabled && !user.superadmin {
        billing_repo::suspended_company_ids(&state.db).await?
    } else {
        Vec::new()
    };
    let company_set: std::collections::HashSet<_> =
        companies.iter().map(|company| company.id).collect();
    let overdue_company_ids: Vec<Uuid> = suspended
        .iter()
        .copied()
        .filter(|id| company_set.contains(id))
        .collect();
    let manageable_overdue_company_ids: Vec<Uuid> = if can_manage_billing {
        overdue_company_ids
            .iter()
            .copied()
            .filter(|id| billing_company_ids.contains(id))
            .collect()
    } else {
        Vec::new()
    };
    let billing_alert = if can_manage_billing && !user.superadmin {
        billing_alert_for(&state.db, user.id).await?
    } else {
        None
    };
    Ok(Json(MeResponse {
        id: user.id,
        email: user.email,
        role: if user.superadmin {
            AccessRole::Superadmin
        } else {
            AccessRole::Member
        },
        access: if user.enabled {
            AccessStatus::Active
        } else {
            AccessStatus::Pending
        },
        companies,
        notice: None,
        billing_alert,
        can_manage_billing,
        billing_company_ids,
        overdue_company_ids,
        manageable_overdue_company_ids,
        upload_max_bytes: state.config.upload_max_bytes,
        onboarding_pending: false,
    }))
}

async fn billing_alert_for(
    db: &sqlx::PgPool,
    user_id: Uuid,
) -> Result<Option<BillingAlert>, ApiError> {
    let Some(row) = billing_repo::pending_alert_for_manager(db, user_id).await? else {
        return Ok(None);
    };
    let reminder_on = row
        .period
        .checked_add_days(chrono::Days::new(REMINDER_DAY_OFFSET as u64))
        .unwrap_or(row.period);
    let suspend_on = row
        .period
        .checked_add_days(chrono::Days::new(SUSPEND_DAY_OFFSET as u64))
        .unwrap_or(row.period);
    let kind = if row.today >= suspend_on {
        BillingAlertKind::Suspended
    } else if row.today > row.due_on {
        BillingAlertKind::Overdue
    } else if row.today == row.due_on {
        BillingAlertKind::DueToday
    } else if row.today >= reminder_on {
        BillingAlertKind::PaymentReminder
    } else {
        return Ok(None);
    };
    Ok(Some(BillingAlert {
        kind,
        invoice_id: row.invoice_id,
        account_name: row.account_name,
        due_on: row.due_on,
        total_minor: row.total_minor,
    }))
}

/// Records onboarding completion for the authenticated user. Safe to repeat.
#[utoipa::path(
    post,
    path = "/api/v1/me/onboarding-completion",
    tag = "Users",
    security(("bearer_auth" = [])),
    responses(
        (status = 204, description = "Onboarding completed or already recorded"),
        (status = 401, description = "Missing or invalid token", body = ErrorEnvelope),
        (status = 403, description = "The account was deleted or the superadministrator login lacks its confirmed email", body = ErrorEnvelope),
        (status = 503, description = "The signing keys could not be retrieved", body = ErrorEnvelope),
    )
)]
async fn complete_onboarding(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
) -> Result<StatusCode, ApiError> {
    access::complete_onboarding(&state.db, user.id).await?;
    Ok(StatusCode::NO_CONTENT)
}
