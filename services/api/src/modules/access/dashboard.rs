use axum::{Extension, Json, extract::State};
use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use sqlx::types::Json as DbJson;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::{
    app_state::AppState,
    error::{ApiError, ErrorEnvelope},
    extract::ApiQuery,
    modules::{admin_pagination::PageQuery, auth::AuthUser, billing},
};

#[derive(Serialize, ToSchema, sqlx::FromRow)]
struct DashboardUsage {
    period: NaiveDate,
    active_companies: i64,
    enabled_users: i64,
    users_seen_this_month: i64,
    access_requests: i64,
    documents_this_month: i64,
}

#[derive(Default, Serialize, ToSchema)]
struct DashboardCollections {
    transfers_to_review: usize,
    transfers_to_review_minor: i64,
    overdue_invoices: usize,
    overdue_minor: i64,
    confirmed_this_month_minor: i64,
    recent_reports: Vec<DashboardTransfer>,
    recent_reports_total: usize,
    recent_reports_page: i64,
    recent_reports_per_page: i64,
}

#[derive(Serialize, ToSchema)]
struct DashboardTransfer {
    invoice_id: Uuid,
    account_name: String,
    total_minor: i64,
    reported_at: DateTime<Utc>,
}

#[derive(Serialize, ToSchema)]
pub(super) struct DashboardSummary {
    usage: DashboardUsage,
    collections: DashboardCollections,
    activity: DashboardActivity,
}

#[derive(Serialize, ToSchema)]
struct DashboardActivity {
    daily_users: Vec<DailyUsers>,
    top_screens: Vec<ScreenVisits>,
}

#[derive(Deserialize, Serialize, ToSchema)]
struct DailyUsers {
    day: NaiveDate,
    users: i64,
}

#[derive(Deserialize, Serialize, ToSchema)]
struct ScreenVisits {
    screen: String,
    visits: i64,
}

async fn activity(db: &sqlx::PgPool, admin_id: Uuid) -> sqlx::Result<DashboardActivity> {
    let (DbJson(daily_users), DbJson(top_screens)) = sqlx::query_as::<_, (DbJson<Vec<DailyUsers>>, DbJson<Vec<ScreenVisits>>)>(
        "WITH boundary AS (
            SELECT (statement_timestamp() AT TIME ZONE 'America/Santo_Domingo')::date AS today
         ), visits AS (
            SELECT user_id, screen, (occurred_at AT TIME ZONE 'America/Santo_Domingo')::date AS day
            FROM portal_activity_events, boundary
            WHERE event = 'portal_visit' AND user_id <> $1
              AND occurred_at >= ((today - 6)::timestamp AT TIME ZONE 'America/Santo_Domingo')
              AND occurred_at <= statement_timestamp()
         ), daily AS (
            SELECT today - offset_day AS day, count(DISTINCT user_id) AS users
            FROM boundary CROSS JOIN generate_series(0, 6) AS offsets(offset_day)
            LEFT JOIN visits ON visits.day = today - offset_day
            GROUP BY today - offset_day
         ), top AS (
            SELECT screen, count(*) AS visits FROM visits
            GROUP BY screen ORDER BY visits DESC, screen LIMIT 5
         )
         SELECT (SELECT jsonb_agg(daily ORDER BY day) FROM daily),
                (SELECT COALESCE(jsonb_agg(top ORDER BY visits DESC, screen), '[]'::jsonb) FROM top)",
    )
    .bind(admin_id)
    .fetch_one(db)
    .await?;
    Ok(DashboardActivity {
        daily_users,
        top_screens,
    })
}

#[utoipa::path(
    get, path = "/api/v1/admin/dashboard", tag = "Administration", security(("bearer_auth" = [])),
    params(PageQuery),
    responses(
        (status = 200, description = "Platform usage, billing and seven-day portal visit summary", body = DashboardSummary),
        (status = 401, body = ErrorEnvelope),
        (status = 403, body = ErrorEnvelope)
    )
)]
pub(super) async fn summary(
    State(state): State<AppState>,
    Extension(admin): Extension<AuthUser>,
    ApiQuery(page): ApiQuery<PageQuery>,
) -> Result<Json<DashboardSummary>, ApiError> {
    let mut tx = state.db.begin().await?;
    // Use the same invoice issuance and renewal visibility rules as Facturación.
    billing::repository::lock_assignments(&mut tx).await?;
    billing::repository::issue_invoices(&mut *tx, None, None).await?;
    let (period, month_start) = sqlx::query_as::<_, (NaiveDate, DateTime<Utc>)>(
        "SELECT month_start::date, month_start AT TIME ZONE 'America/Santo_Domingo'
         FROM (SELECT date_trunc('month', now() AT TIME ZONE 'America/Santo_Domingo') AS month_start) boundary",
    )
    .fetch_one(&mut *tx)
    .await?;
    let usage = sqlx::query_as::<_, DashboardUsage>(
        "SELECT $1::date AS period,
           (SELECT count(*) FROM companies WHERE archived_at IS NULL) AS active_companies,
           count(*) FILTER (WHERE i.enabled_at IS NOT NULL) AS enabled_users,
           count(*) FILTER (WHERE i.enabled_at IS NOT NULL AND o.last_portal_access_at >= $2) AS users_seen_this_month,
           count(*) FILTER (WHERE i.enabled_at IS NULL) AS access_requests,
           (SELECT count(*) FROM generated_documents
            WHERE created_at >= $2 AND NOT imported_from_session) AS documents_this_month
         FROM access_identities i
         JOIN profiles p ON p.user_id = i.user_id
         LEFT JOIN portal_access_observations o ON o.user_id = i.user_id
         WHERE i.user_id <> $3 AND NOT i.suspended AND p.account_status = 'active'",
    )
    .bind(period)
    .bind(month_start)
    .bind(admin.id)
    .fetch_one(&mut *tx)
    .await?;
    let invoices = billing::repository::invoices(&mut *tx, None, None).await?;
    tx.commit().await?;

    use billing::dto::InvoiceState;
    let mut collections = DashboardCollections::default();
    for invoice in invoices {
        match invoice.state {
            InvoiceState::InReview => {
                collections.transfers_to_review += 1;
                collections.transfers_to_review_minor += invoice.total_minor;
                if let Some(reported_at) = invoice.transfer_reported_at {
                    collections.recent_reports.push(DashboardTransfer {
                        invoice_id: invoice.id,
                        account_name: invoice.account_name,
                        total_minor: invoice.total_minor,
                        reported_at,
                    });
                }
            }
            InvoiceState::Pending if invoice.is_overdue => {
                collections.overdue_invoices += 1;
                collections.overdue_minor += invoice.total_minor;
            }
            InvoiceState::Paid if invoice.paid_at.is_some_and(|paid| paid >= month_start) => {
                collections.confirmed_this_month_minor += invoice.total_minor;
            }
            _ => {}
        }
    }
    collections
        .recent_reports
        .sort_by_key(|report| (std::cmp::Reverse(report.reported_at), report.invoice_id));
    // This list is a preview. The full review queue lives in Billing.
    collections.recent_reports.truncate(5);
    collections.recent_reports_total = collections.recent_reports.len();
    collections.recent_reports_page = page.number();
    collections.recent_reports_per_page = page.limit().unwrap_or(5);
    collections.recent_reports = collections
        .recent_reports
        .into_iter()
        .skip(page.offset().try_into().unwrap_or(usize::MAX))
        .take(collections.recent_reports_per_page as usize)
        .collect();
    let activity = activity(&state.db, admin.id).await?;
    Ok(Json(DashboardSummary {
        usage,
        collections,
        activity,
    }))
}
