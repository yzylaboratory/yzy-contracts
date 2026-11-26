use axum::{Extension, Json, extract::State};
use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use sqlx::types::Json as DbJson;
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;
use validator::Validate;

use crate::{
    app_state::AppState,
    error::{ApiError, ErrorEnvelope},
    extract::ApiQuery,
    modules::auth::AuthUser,
};

use super::dto::OperationStatus;

const ESTIMATED_MINUTES_PER_DOCUMENT: i64 = 5;
const ESTIMATED_MINUTES_PER_CASE: i64 = 10;

/// When a case reached disbursement: the latest status change to disbursement or closed in
/// its history, or its last update when the history has none. Expects the alias `o`.
macro_rules! disbursed_at_sql {
    () => {
        "CASE
                    WHEN o.status IN ('desembolso', 'cerrado') THEN COALESCE(
                      (
                        SELECT h.occurred_at
                        FROM client_case_history h
                        WHERE h.operation_id = o.id
                          AND h.kind = 'operation_updated'
                          AND EXISTS (
                            SELECT 1 FROM jsonb_array_elements(h.changes) AS ch
                            WHERE ch->>'field' = 'status'
                              AND ch->>'after' IN ('desembolso', 'cerrado')
                          )
                        ORDER BY h.occurred_at DESC
                        LIMIT 1
                      ),
                      o.updated_at
                    )
                    ELSE NULL
                  END"
    };
}

/// Cases of the requested company with the dates and amounts the period metrics need.
/// Expects `$1` to be the company.
macro_rules! dated_cases_sql {
    () => {
        concat!(
            "dated_cases AS NOT MATERIALIZED (
               SELECT o.id, o.status, o.created_at,
                      (o.created_at AT TIME ZONE 'America/Santo_Domingo')::date AS created_on,
                      o.financing IS NULL AS without_plan,
                      (o.financing->'final_principal'->>'amount_minor')::bigint AS principal_minor,
                      (o.application->>'requested_amount_minor')::bigint AS requested_minor,
                      (",
            disbursed_at_sql!(),
            ") AS disbursed_at
               FROM client_operations o
               WHERE o.deleted_at IS NULL AND o.company_id = $1
             ), cases AS (
               SELECT d.*, (d.disbursed_at AT TIME ZONE 'America/Santo_Domingo')::date AS disbursed_on
               FROM dated_cases d
             )"
        )
    };
}

/// Installments of the requested company that were not replaced. Expects `$1` to be the company.
macro_rules! dues_sql {
    () => {
        "dues AS NOT MATERIALIZED (
           SELECT d.id, d.policy_id, d.slot, d.due_on, d.amount_minor, d.paid_on,
                  p.number AS policy_number, p.carrier_id, p.client_id
           FROM insurance_dues d
           JOIN insurance_policies p ON p.id = d.policy_id
           WHERE p.company_id = $1 AND d.replaced_at IS NULL
         )"
    };
}

#[derive(Debug, Deserialize, Validate, IntoParams)]
#[serde(deny_unknown_fields)]
#[into_params(parameter_in = Query)]
pub(super) struct DashboardQuery {
    pub company_id: Uuid,
    /// Reporting period; the current month when omitted.
    pub period: Option<DashboardPeriodKey>,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub(super) enum DashboardPeriodKey {
    #[default]
    Month,
    LastMonth,
    Quarter,
    Year,
}

impl DashboardPeriodKey {
    fn as_str(self) -> &'static str {
        match self {
            Self::Month => "month",
            Self::LastMonth => "last_month",
            Self::Quarter => "quarter",
            Self::Year => "year",
        }
    }
}

#[derive(Serialize, ToSchema)]
pub(super) struct WorkspaceDashboard {
    pub clients_total: i64,
    pub clients_this_month: i64,
    pub prospects_pending: i64,
    pub cases_total: i64,
    pub cases_this_month: i64,
    pub cases_without_plan: i64,
    pub unsigned_cases: i64,
    pub pending_disbursement_cases: i64,
    pub disbursed_cases: i64,
    pub disbursed_this_month: i64,
    pub documents_total: i64,
    pub documents_this_month: i64,
    pub time_saved_minutes: i64,
    pub user_time_saved_minutes: i64,
    pub user_disbursements_total: i64,
    pub user_documents_total: i64,
    pub period: DashboardPeriod,
    pub attention: DashboardAttention,
    pub contracts: DashboardContracts,
    pub insurance: DashboardInsurance,
    pub trend: Vec<DashboardTrendMonth>,
    pub stalled_cases: DashboardStalledCases,
    pub productivity: DashboardProductivity,
    pub status_counts: DashboardStatusCounts,
    pub user_stats: Vec<DashboardUserStat>,
    pub months: Vec<DashboardMonth>,
    pub formats: DashboardFormats,
    pub recent_cases: Vec<DashboardCase>,
}

/// Reporting window. `end` and `compare_end` are exclusive; the comparison covers the same
/// number of days one period earlier.
#[derive(Serialize, ToSchema)]
pub(super) struct DashboardPeriod {
    pub key: DashboardPeriodKey,
    pub start: NaiveDate,
    pub end: NaiveDate,
    pub compare_start: NaiveDate,
    pub compare_end: NaiveDate,
    pub today: NaiveDate,
}

/// Items that need action today, regardless of the selected period.
#[derive(Serialize, ToSchema)]
pub(super) struct DashboardAttention {
    pub overdue_dues: DashboardAmount,
    pub renewals_next_7_days: DashboardAmount,
    pub unsigned_over_5_days: i64,
}

#[derive(Serialize, ToSchema)]
pub(super) struct DashboardContracts {
    pub disbursed: DashboardDisbursed,
    pub in_process: DashboardInProcess,
    pub cases_created: DashboardCasesCreated,
    pub days_to_disbursement: DashboardDaysToDisbursement,
}

#[derive(Serialize, ToSchema)]
pub(super) struct DashboardDisbursed {
    pub count: i64,
    pub amount_minor: i64,
    pub without_plan: i64,
    pub previous_count: i64,
    pub previous_amount_minor: i64,
}

/// Snapshot of today; it does not depend on the period.
#[derive(Serialize, ToSchema)]
pub(super) struct DashboardInProcess {
    pub count: i64,
    pub amount_minor: i64,
    pub without_amount: i64,
    pub solicitud: i64,
    pub en_proceso: i64,
    pub firma: i64,
}

#[derive(Serialize, ToSchema)]
pub(super) struct DashboardCasesCreated {
    pub count: i64,
    pub previous_count: i64,
}

#[derive(Serialize, ToSchema)]
pub(super) struct DashboardDaysToDisbursement {
    #[schema(required = true)]
    pub average: Option<f64>,
    #[schema(required = true)]
    pub previous_average: Option<f64>,
    pub sample: i64,
}

#[derive(Serialize, ToSchema)]
pub(super) struct DashboardInsurance {
    pub collected: DashboardInsuranceCollected,
    pub pending: DashboardInsurancePending,
    pub policies_total: i64,
    pub policies_new: i64,
    pub policies_new_previous: i64,
    pub insured_clients: i64,
    /// Always four buckets: 1-30, 31-60, 61-90 and 90+ days overdue.
    pub aging: Vec<DashboardAgingBucket>,
    pub by_carrier: Vec<DashboardCarrierBalance>,
    pub attention_dues: Vec<DashboardAttentionDue>,
}

#[derive(Serialize, ToSchema)]
pub(super) struct DashboardInsuranceCollected {
    pub count: i64,
    pub amount_minor: i64,
    pub previous_amount_minor: i64,
    pub due_in_period: i64,
    pub paid_of_due_in_period: i64,
}

/// Unpaid installments due before the end of the period, including the overdue ones.
#[derive(Serialize, ToSchema)]
pub(super) struct DashboardInsurancePending {
    pub count: i64,
    pub amount_minor: i64,
    pub overdue_amount_minor: i64,
}

#[derive(Serialize, sqlx::FromRow, ToSchema)]
pub(super) struct DashboardAgingBucket {
    pub bucket: String,
    pub count: i64,
    pub amount_minor: i64,
}

#[derive(Serialize, sqlx::FromRow, ToSchema)]
pub(super) struct DashboardCarrierBalance {
    pub carrier_id: Uuid,
    pub carrier_name: String,
    pub count: i64,
    pub amount_minor: i64,
}

#[derive(Serialize, sqlx::FromRow, ToSchema)]
pub(super) struct DashboardAttentionDue {
    pub due_id: Uuid,
    pub policy_id: Uuid,
    pub policy_number: String,
    pub client_name: String,
    pub carrier_name: String,
    pub slot: i32,
    pub due_on: NaiveDate,
    pub amount_minor: i64,
}

#[derive(Serialize, sqlx::FromRow, ToSchema)]
pub(super) struct DashboardTrendMonth {
    pub month: String,
    pub cases_created: i64,
    pub disbursed_amount_minor: i64,
    pub collected_amount_minor: i64,
}

#[derive(Serialize, ToSchema)]
pub(super) struct DashboardStalledCases {
    pub count: i64,
    pub items: Vec<DashboardStalledCase>,
}

#[derive(Serialize, sqlx::FromRow, ToSchema)]
pub(super) struct DashboardStalledCase {
    pub id: Uuid,
    pub client_id: Uuid,
    pub client_name: String,
    #[schema(required = true)]
    pub reference: Option<String>,
    pub status: OperationStatus,
    pub last_activity_at: DateTime<Utc>,
    pub days_without_activity: i64,
}

#[derive(Serialize, ToSchema)]
pub(super) struct DashboardProductivity {
    pub time_saved_minutes: i64,
    pub documents: DashboardPeriodDocuments,
}

#[derive(Serialize, ToSchema)]
pub(super) struct DashboardPeriodDocuments {
    pub total: i64,
    pub pdf: i64,
    pub docx: i64,
    pub email: i64,
}

#[derive(Serialize, ToSchema)]
pub(super) struct DashboardAmount {
    pub count: i64,
    pub amount_minor: i64,
}

#[derive(Serialize, ToSchema)]
pub(super) struct DashboardStatusCounts {
    pub solicitud: i64,
    pub en_proceso: i64,
    pub firma: i64,
    pub desembolso: i64,
    pub cerrado: i64,
}

#[derive(Deserialize, Serialize, ToSchema)]
pub(super) struct DashboardUserStat {
    pub user_id: Uuid,
    pub user_name: String,
    pub is_current_user: bool,
    pub disbursements_total: i64,
    pub unsigned_cases: i64,
    pub pending_disbursement_cases: i64,
    pub cases_total: i64,
    pub documents_total: i64,
    pub time_saved_minutes: i64,
}

#[derive(Deserialize, Serialize, ToSchema)]
pub(super) struct DashboardMonth {
    pub month: String,
    pub total: i64,
}

#[derive(Serialize, ToSchema)]
pub(super) struct DashboardFormats {
    pub pdf: i64,
    pub docx: i64,
    pub email: i64,
}

#[derive(Deserialize, Serialize, ToSchema)]
pub(super) struct DashboardCase {
    pub id: Uuid,
    pub client_id: Uuid,
    pub client_name: String,
    #[schema(required = true)]
    pub reference: Option<String>,
    pub status: OperationStatus,
    pub created_at: DateTime<Utc>,
    pub has_payment_plan: bool,
    #[serde(default)]
    pub actor_name: Option<String>,
}

#[derive(sqlx::FromRow)]
struct SummaryRow {
    clients_total: i64,
    clients_this_month: i64,
    prospects_pending: i64,
    cases_total: i64,
    cases_this_month: i64,
    cases_without_plan: i64,
    unsigned_cases: i64,
    pending_disbursement_cases: i64,
    disbursed_cases: i64,
    disbursed_this_month: i64,
    status_solicitud: i64,
    status_en_proceso: i64,
    status_firma: i64,
    status_desembolso: i64,
    status_cerrado: i64,
    documents_total: i64,
    documents_this_month: i64,
    time_saved_minutes: i64,
    user_time_saved_minutes: i64,
    user_disbursements_total: i64,
    user_documents_total: i64,
    pdf: i64,
    docx: i64,
    email: i64,
    user_stats: DbJson<Vec<DashboardUserStat>>,
    months: DbJson<Vec<DashboardMonth>>,
    recent_cases: DbJson<Vec<DashboardCase>>,
}

#[utoipa::path(
    get,
    path = "/api/v1/dashboard",
    operation_id = "workspace_dashboard",
    tag = "Clients",
    security(("bearer_auth" = [])),
    params(DashboardQuery),
    responses(
        (status = 200, description = "Workspace KPIs for one company: clients, cases, disbursements, user productivity and generated documents", body = WorkspaceDashboard),
        (status = 401, body = ErrorEnvelope),
        (status = 403, body = ErrorEnvelope),
        (status = 404, description = "Company not found or not accessible", body = ErrorEnvelope),
        (status = 422, body = ErrorEnvelope)
    )
)]
pub(super) async fn summary(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
    ApiQuery(query): ApiQuery<DashboardQuery>,
) -> Result<Json<WorkspaceDashboard>, ApiError> {
    let key = query.period.unwrap_or_default();
    let mut tx = state.db.begin().await?;
    sqlx::query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
        .execute(&mut *tx)
        .await?;
    let allowed: bool = sqlx::query_scalar("SELECT has_company_membership($1, $2)")
        .bind(user.id)
        .bind(query.company_id)
        .fetch_one(&mut *tx)
        .await?;
    if !allowed {
        return Err(ApiError::CompanyNotFound);
    }
    let period = load_period(&mut tx, key).await?;

    let row: SummaryRow = sqlx::query_as(concat!(
        "WITH clock AS (
           SELECT date_trunc('month', now() AT TIME ZONE 'America/Santo_Domingo') AS month
         ), company_cases AS NOT MATERIALIZED (
           SELECT o.id, o.client_id, c.name AS client_name, o.reference, o.status, o.created_at, o.updated_at,
                  (o.financing IS NOT NULL) AS has_payment_plan,
                  COALESCE(
                    (
                      SELECT h.actor_id
                      FROM client_case_history h
                      WHERE h.operation_id = o.id
                        AND h.actor_id IS NOT NULL
                        AND h.kind = 'operation_created'
                      ORDER BY h.occurred_at ASC
                      LIMIT 1
                    ),
                    (
                      SELECT h.actor_id
                      FROM client_case_history h
                      WHERE h.operation_id = o.id
                        AND h.actor_id IS NOT NULL
                      ORDER BY h.occurred_at ASC
                      LIMIT 1
                    ),
                    (
                      SELECT d.owner_id
                      FROM generated_documents d
                      WHERE d.operation_company_id = $1
                        AND d.operation_id = o.id
                      ORDER BY d.created_at ASC
                      LIMIT 1
                    )
                  ) AS owner_user_id,
                  CASE
                    WHEN o.status IN ('desembolso', 'cerrado') THEN COALESCE(
                      (
                        SELECT h.actor_id
                        FROM client_case_history h
                        WHERE h.operation_id = o.id
                          AND h.actor_id IS NOT NULL
                          AND h.kind = 'operation_updated'
                          AND EXISTS (
                            SELECT 1 FROM jsonb_array_elements(h.changes) AS ch
                            WHERE ch->>'field' = 'status'
                              AND ch->>'after' IN ('desembolso', 'cerrado')
                          )
                        ORDER BY h.occurred_at DESC
                        LIMIT 1
                      ),
                      (
                        SELECT h.actor_id
                        FROM client_case_history h
                        WHERE h.operation_id = o.id
                          AND h.actor_id IS NOT NULL
                        ORDER BY h.occurred_at DESC
                        LIMIT 1
                      ),
                      (
                        SELECT d.owner_id
                        FROM generated_documents d
                        WHERE d.operation_company_id = $1
                          AND d.operation_id = o.id
                        ORDER BY d.created_at DESC
                        LIMIT 1
                      )
                    )
                    ELSE NULL
                  END AS disbursed_by,
                  ",
        disbursed_at_sql!(),
        " AS disbursed_at
           FROM client_operations o
           JOIN clients c ON c.id = o.client_id
           WHERE o.deleted_at IS NULL AND o.company_id = $1
         ), company_docs AS NOT MATERIALIZED (
           SELECT owner_id, format, created_at
           FROM generated_documents
           WHERE operation_company_id = $1
              OR company->>'id' = $1::text
         ), company_users AS (
           SELECT user_id FROM company_memberships WHERE company_id = $1
           UNION
           SELECT owner_user_id AS user_id FROM company_cases WHERE owner_user_id IS NOT NULL
           UNION
           SELECT disbursed_by AS user_id FROM company_cases WHERE disbursed_by IS NOT NULL
           UNION
           SELECT owner_id AS user_id FROM company_docs WHERE owner_id IS NOT NULL
           UNION
           SELECT $2::uuid AS user_id
         ), user_metrics AS (
           SELECT
             u.user_id,
             COALESCE(
               (SELECT NULLIF(btrim(ai.name), '') FROM access_identities ai WHERE ai.user_id = u.user_id),
               (SELECT NULLIF(btrim(h.actor_name), '') FROM client_case_history h WHERE h.actor_id = u.user_id AND h.actor_name IS NOT NULL ORDER BY h.occurred_at DESC LIMIT 1),
               confirmed_identity_email(u.user_id),
               'Usuario'
             ) AS user_name,
             (u.user_id = $2) AS is_current_user,
             (SELECT count(*) FROM company_cases cc WHERE cc.disbursed_by = u.user_id) AS disbursements_total,
             (SELECT count(*) FROM company_cases cc WHERE cc.owner_user_id = u.user_id AND cc.status IN ('solicitud', 'en_proceso')) AS unsigned_cases,
             (SELECT count(*) FROM company_cases cc WHERE cc.owner_user_id = u.user_id AND cc.status IN ('solicitud', 'en_proceso', 'firma')) AS pending_disbursement_cases,
             (SELECT count(*) FROM company_cases cc WHERE cc.owner_user_id = u.user_id) AS cases_total,
             (SELECT count(*) FROM company_docs cd WHERE cd.owner_id = u.user_id) AS documents_total
           FROM company_users u
         ), user_stats_enriched AS (
           SELECT
             user_id,
             user_name,
             is_current_user,
             disbursements_total,
             unsigned_cases,
             pending_disbursement_cases,
             cases_total,
             documents_total,
             (documents_total * $4 + cases_total * $5) AS time_saved_minutes
           FROM user_metrics
           WHERE ($3::uuid IS NULL OR user_metrics.user_id IS DISTINCT FROM $3)
             AND lower(user_metrics.user_name) <> 'admin@yzylabs.com'
             AND (
               is_current_user
               OR disbursements_total > 0
               OR cases_total > 0
               OR documents_total > 0
               OR EXISTS (
                 SELECT 1 FROM company_memberships m
                 WHERE m.company_id = $1 AND m.user_id = user_metrics.user_id
               )
             )
         ), totals AS (
           SELECT
             (SELECT count(*) FROM clients) AS clients_total,
             (SELECT count(*) FROM clients, clock
              WHERE clients.created_at >= (clock.month AT TIME ZONE 'America/Santo_Domingo')
                AND clients.created_at < ((clock.month + interval '1 month') AT TIME ZONE 'America/Santo_Domingo')
             ) AS clients_this_month,
             (SELECT count(*) FROM prospects WHERE company_id = $1) AS prospects_pending,
             (SELECT count(*) FROM company_cases) AS cases_total,
             (SELECT count(*) FROM company_cases, clock
              WHERE created_at >= (clock.month AT TIME ZONE 'America/Santo_Domingo')
                AND created_at < ((clock.month + interval '1 month') AT TIME ZONE 'America/Santo_Domingo')
             ) AS cases_this_month,
             (SELECT count(*) FROM company_cases WHERE NOT has_payment_plan) AS cases_without_plan,
             (SELECT count(*) FROM company_cases WHERE status IN ('solicitud', 'en_proceso')) AS unsigned_cases,
             (SELECT count(*) FROM company_cases WHERE status IN ('solicitud', 'en_proceso', 'firma')) AS pending_disbursement_cases,
             (SELECT count(*) FROM company_cases WHERE status IN ('desembolso', 'cerrado')) AS disbursed_cases,
             (SELECT count(*) FROM company_cases, clock
              WHERE status IN ('desembolso', 'cerrado')
                AND disbursed_at >= (clock.month AT TIME ZONE 'America/Santo_Domingo')
                AND disbursed_at < ((clock.month + interval '1 month') AT TIME ZONE 'America/Santo_Domingo')
             ) AS disbursed_this_month,
             (SELECT count(*) FROM company_cases WHERE status = 'solicitud') AS status_solicitud,
             (SELECT count(*) FROM company_cases WHERE status = 'en_proceso') AS status_en_proceso,
             (SELECT count(*) FROM company_cases WHERE status = 'firma') AS status_firma,
             (SELECT count(*) FROM company_cases WHERE status = 'desembolso') AS status_desembolso,
             (SELECT count(*) FROM company_cases WHERE status = 'cerrado') AS status_cerrado,
             (SELECT count(*) FROM company_docs) AS documents_total,
             (SELECT count(*) FROM company_docs, clock
              WHERE created_at >= (clock.month AT TIME ZONE 'America/Santo_Domingo')
                AND created_at < ((clock.month + interval '1 month') AT TIME ZONE 'America/Santo_Domingo')
             ) AS documents_this_month,
             ((SELECT count(*) FROM company_docs) * $4 + (SELECT count(*) FROM company_cases) * $5) AS time_saved_minutes,
             COALESCE((SELECT (documents_total * $4 + cases_total * $5) FROM user_metrics WHERE is_current_user LIMIT 1), 0) AS user_time_saved_minutes,
             COALESCE((SELECT disbursements_total FROM user_metrics WHERE is_current_user LIMIT 1), 0) AS user_disbursements_total,
             COALESCE((SELECT documents_total FROM user_metrics WHERE is_current_user LIMIT 1), 0) AS user_documents_total,
             (SELECT count(*) FROM company_docs WHERE format = 'pdf') AS pdf,
             (SELECT count(*) FROM company_docs WHERE format = 'docx') AS docx,
             (SELECT count(*) FROM company_docs WHERE format = 'email') AS email
         ), monthly AS (
           SELECT date_trunc('month', created_at AT TIME ZONE 'America/Santo_Domingo') AS month,
                  count(*) AS total
           FROM company_docs, clock
           WHERE created_at >= ((clock.month - interval '5 months') AT TIME ZONE 'America/Santo_Domingo')
             AND created_at < ((clock.month + interval '1 month') AT TIME ZONE 'America/Santo_Domingo')
           GROUP BY 1
         ), buckets AS (
           SELECT generate_series(month - interval '5 months', month, interval '1 month') AS month
           FROM clock
         )
         SELECT totals.*,
                (SELECT COALESCE(jsonb_agg(to_jsonb(u) ORDER BY u.disbursements_total DESC, u.time_saved_minutes DESC, u.cases_total DESC, u.is_current_user DESC, u.user_name ASC), '[]'::jsonb)
                 FROM user_stats_enriched u) AS user_stats,
                (SELECT jsonb_agg(jsonb_build_object(
                          'month', to_char(buckets.month, 'YYYY-MM'),
                          'total', COALESCE(monthly.total, 0)
                        ) ORDER BY buckets.month)
                 FROM buckets LEFT JOIN monthly USING (month)) AS months,
                (SELECT COALESCE(jsonb_agg(to_jsonb(page) ORDER BY created_at DESC, id DESC), '[]'::jsonb)
                 FROM (
                   SELECT cc.id, cc.client_id, cc.client_name, cc.reference, cc.status, cc.created_at, cc.has_payment_plan,
                          (SELECT u.user_name FROM user_metrics u WHERE u.user_id = COALESCE(cc.disbursed_by, cc.owner_user_id) LIMIT 1) AS actor_name
                   FROM company_cases cc
                   ORDER BY cc.created_at DESC, cc.id DESC
                   LIMIT 5
                 ) page) AS recent_cases
         FROM totals"
    ))
    .bind(query.company_id)
    .bind(user.id)
    .bind(state.config.superadmin_id)
    .bind(ESTIMATED_MINUTES_PER_DOCUMENT)
    .bind(ESTIMATED_MINUTES_PER_CASE)
    .fetch_one(&mut *tx)
    .await?;
    let case_metrics = load_case_metrics(&mut tx, query.company_id, &period).await?;
    let due_metrics = load_due_metrics(&mut tx, query.company_id, &period).await?;
    let aging = load_aging(&mut tx, query.company_id, period.today).await?;
    let by_carrier = load_carrier_balances(&mut tx, query.company_id, period.end).await?;
    let attention_dues = load_attention_dues(&mut tx, query.company_id, period.end).await?;
    let trend = load_trend(&mut tx, query.company_id, period.today).await?;
    let stalled_cases = load_stalled_cases(&mut tx, query.company_id).await?;
    tx.commit().await?;

    Ok(Json(WorkspaceDashboard {
        clients_total: row.clients_total,
        clients_this_month: row.clients_this_month,
        prospects_pending: row.prospects_pending,
        cases_total: row.cases_total,
        cases_this_month: row.cases_this_month,
        cases_without_plan: row.cases_without_plan,
        unsigned_cases: row.unsigned_cases,
        pending_disbursement_cases: row.pending_disbursement_cases,
        disbursed_cases: row.disbursed_cases,
        disbursed_this_month: row.disbursed_this_month,
        documents_total: row.documents_total,
        documents_this_month: row.documents_this_month,
        time_saved_minutes: row.time_saved_minutes,
        user_time_saved_minutes: row.user_time_saved_minutes,
        user_disbursements_total: row.user_disbursements_total,
        user_documents_total: row.user_documents_total,
        attention: DashboardAttention {
            overdue_dues: DashboardAmount {
                count: due_metrics.overdue_count,
                amount_minor: due_metrics.overdue_minor,
            },
            renewals_next_7_days: DashboardAmount {
                count: due_metrics.renewal_count,
                amount_minor: due_metrics.renewal_minor,
            },
            unsigned_over_5_days: case_metrics.unsigned_over_5_days,
        },
        contracts: DashboardContracts {
            disbursed: DashboardDisbursed {
                count: case_metrics.disbursed_count,
                amount_minor: case_metrics.disbursed_minor,
                without_plan: case_metrics.disbursed_without_plan,
                previous_count: case_metrics.previous_disbursed_count,
                previous_amount_minor: case_metrics.previous_disbursed_minor,
            },
            in_process: DashboardInProcess {
                count: case_metrics.solicitud + case_metrics.en_proceso + case_metrics.firma,
                amount_minor: case_metrics.in_process_minor,
                without_amount: case_metrics.in_process_without_amount,
                solicitud: case_metrics.solicitud,
                en_proceso: case_metrics.en_proceso,
                firma: case_metrics.firma,
            },
            cases_created: DashboardCasesCreated {
                count: case_metrics.created_count,
                previous_count: case_metrics.previous_created_count,
            },
            days_to_disbursement: DashboardDaysToDisbursement {
                average: case_metrics.average_days,
                previous_average: case_metrics.previous_average_days,
                sample: case_metrics.disbursed_count,
            },
        },
        insurance: DashboardInsurance {
            collected: DashboardInsuranceCollected {
                count: due_metrics.collected_count,
                amount_minor: due_metrics.collected_minor,
                previous_amount_minor: due_metrics.previous_collected_minor,
                due_in_period: due_metrics.due_in_period,
                paid_of_due_in_period: due_metrics.paid_of_due_in_period,
            },
            pending: DashboardInsurancePending {
                count: due_metrics.pending_count,
                amount_minor: due_metrics.pending_minor,
                overdue_amount_minor: due_metrics.pending_overdue_minor,
            },
            policies_total: due_metrics.policies_total,
            policies_new: due_metrics.policies_new,
            policies_new_previous: due_metrics.policies_new_previous,
            insured_clients: due_metrics.insured_clients,
            aging,
            by_carrier,
            attention_dues,
        },
        trend,
        stalled_cases,
        productivity: DashboardProductivity {
            time_saved_minutes: case_metrics.documents_total * ESTIMATED_MINUTES_PER_DOCUMENT
                + case_metrics.created_count * ESTIMATED_MINUTES_PER_CASE,
            documents: DashboardPeriodDocuments {
                total: case_metrics.documents_total,
                pdf: case_metrics.pdf,
                docx: case_metrics.docx,
                email: case_metrics.email,
            },
        },
        period: DashboardPeriod::from(&period),
        status_counts: DashboardStatusCounts {
            solicitud: row.status_solicitud,
            en_proceso: row.status_en_proceso,
            firma: row.status_firma,
            desembolso: row.status_desembolso,
            cerrado: row.status_cerrado,
        },
        user_stats: row.user_stats.0,
        months: row.months.0,
        formats: DashboardFormats {
            pdf: row.pdf,
            docx: row.docx,
            email: row.email,
        },
        recent_cases: row.recent_cases.0,
    }))
}

type Tx<'a> = sqlx::Transaction<'a, sqlx::Postgres>;

#[derive(sqlx::FromRow)]
struct PeriodRow {
    start: NaiveDate,
    #[sqlx(rename = "period_end")]
    end: NaiveDate,
    effective_end: NaiveDate,
    compare_start: NaiveDate,
    compare_end: NaiveDate,
    today: NaiveDate,
}

/// Date bounds of the period, all in the company time zone. Ranges are `[start, end)`; the
/// current range stops at tomorrow so that a running period is compared like for like.
struct PeriodBounds {
    key: DashboardPeriodKey,
    start: NaiveDate,
    end: NaiveDate,
    effective_end: NaiveDate,
    compare_start: NaiveDate,
    compare_end: NaiveDate,
    today: NaiveDate,
}

async fn load_period(tx: &mut Tx<'_>, key: DashboardPeriodKey) -> Result<PeriodBounds, ApiError> {
    let row: PeriodRow = sqlx::query_as(
        "WITH base AS (
           SELECT (now() AT TIME ZONE 'America/Santo_Domingo')::date AS today
         ), span AS (
           SELECT today,
                  CASE $1::text
                    WHEN 'month' THEN date_trunc('month', today::timestamp)
                    WHEN 'last_month' THEN date_trunc('month', today::timestamp) - interval '1 month'
                    WHEN 'quarter' THEN date_trunc('quarter', today::timestamp)
                    ELSE date_trunc('year', today::timestamp)
                  END::date AS start,
                  CASE $1::text
                    WHEN 'quarter' THEN interval '3 months'
                    WHEN 'year' THEN interval '1 year'
                    ELSE interval '1 month'
                  END AS length
           FROM base
         ), bounds AS (
           SELECT today, start, (start + length)::date AS period_end,
                  (start - length)::date AS compare_start
           FROM span
         ), effective AS (
           SELECT *, least(period_end, today + 1) AS effective_end FROM bounds
         )
         SELECT today, start, period_end, effective_end, compare_start,
                CASE WHEN $1::text = 'last_month' THEN start
                     ELSE least(compare_start + (effective_end - start), start)
                END AS compare_end
         FROM effective",
    )
    .bind(key.as_str())
    .fetch_one(&mut **tx)
    .await?;
    Ok(PeriodBounds {
        key,
        start: row.start,
        end: row.end,
        effective_end: row.effective_end,
        compare_start: row.compare_start,
        compare_end: row.compare_end,
        today: row.today,
    })
}

impl From<&PeriodBounds> for DashboardPeriod {
    fn from(bounds: &PeriodBounds) -> Self {
        Self {
            key: bounds.key,
            start: bounds.start,
            end: bounds.end,
            compare_start: bounds.compare_start,
            compare_end: bounds.compare_end,
            today: bounds.today,
        }
    }
}

#[derive(sqlx::FromRow)]
struct CaseMetrics {
    disbursed_count: i64,
    disbursed_minor: i64,
    disbursed_without_plan: i64,
    previous_disbursed_count: i64,
    previous_disbursed_minor: i64,
    solicitud: i64,
    en_proceso: i64,
    firma: i64,
    in_process_minor: i64,
    in_process_without_amount: i64,
    created_count: i64,
    previous_created_count: i64,
    average_days: Option<f64>,
    previous_average_days: Option<f64>,
    unsigned_over_5_days: i64,
    documents_total: i64,
    pdf: i64,
    docx: i64,
    email: i64,
}

async fn load_case_metrics(
    tx: &mut Tx<'_>,
    company: Uuid,
    period: &PeriodBounds,
) -> Result<CaseMetrics, ApiError> {
    // $2 start, $3 effective end, $4 compare start, $5 compare end.
    let metrics = sqlx::query_as(concat!(
        "WITH ",
        dated_cases_sql!(),
        ", company_docs AS NOT MATERIALIZED (
           SELECT format,
                  (created_at AT TIME ZONE 'America/Santo_Domingo')::date AS created_on
           FROM generated_documents
           WHERE operation_company_id = $1
              OR company->>'id' = $1::text
         ), current_docs AS (
           SELECT format FROM company_docs WHERE created_on >= $2::date AND created_on < $3::date
         )
         SELECT
           (SELECT count(*) FROM cases WHERE disbursed_on >= $2::date AND disbursed_on < $3::date) AS disbursed_count,
           (SELECT COALESCE(sum(principal_minor), 0)::bigint FROM cases
            WHERE disbursed_on >= $2::date AND disbursed_on < $3::date) AS disbursed_minor,
           (SELECT count(*) FROM cases
            WHERE disbursed_on >= $2::date AND disbursed_on < $3::date AND without_plan) AS disbursed_without_plan,
           (SELECT count(*) FROM cases WHERE disbursed_on >= $4::date AND disbursed_on < $5::date) AS previous_disbursed_count,
           (SELECT COALESCE(sum(principal_minor), 0)::bigint FROM cases
            WHERE disbursed_on >= $4::date AND disbursed_on < $5::date) AS previous_disbursed_minor,
           (SELECT count(*) FROM cases WHERE status = 'solicitud') AS solicitud,
           (SELECT count(*) FROM cases WHERE status = 'en_proceso') AS en_proceso,
           (SELECT count(*) FROM cases WHERE status = 'firma') AS firma,
           (SELECT COALESCE(sum(requested_minor), 0)::bigint FROM cases
            WHERE status IN ('solicitud', 'en_proceso', 'firma')) AS in_process_minor,
           (SELECT count(*) FROM cases
            WHERE status IN ('solicitud', 'en_proceso', 'firma') AND requested_minor IS NULL) AS in_process_without_amount,
           (SELECT count(*) FROM cases WHERE created_on >= $2::date AND created_on < $3::date) AS created_count,
           (SELECT count(*) FROM cases WHERE created_on >= $4::date AND created_on < $5::date) AS previous_created_count,
           (SELECT round(avg(extract(epoch FROM disbursed_at - created_at) / 86400.0)::numeric, 1)::float8
            FROM cases WHERE disbursed_on >= $2::date AND disbursed_on < $3::date) AS average_days,
           (SELECT round(avg(extract(epoch FROM disbursed_at - created_at) / 86400.0)::numeric, 1)::float8
            FROM cases WHERE disbursed_on >= $4::date AND disbursed_on < $5::date) AS previous_average_days,
           (SELECT count(*) FROM cases
            WHERE status IN ('solicitud', 'en_proceso') AND created_at < now() - interval '5 days') AS unsigned_over_5_days,
           (SELECT count(*) FROM current_docs) AS documents_total,
           (SELECT count(*) FROM current_docs WHERE format = 'pdf') AS pdf,
           (SELECT count(*) FROM current_docs WHERE format = 'docx') AS docx,
           (SELECT count(*) FROM current_docs WHERE format = 'email') AS email"
    ))
    .bind(company)
    .bind(period.start)
    .bind(period.effective_end)
    .bind(period.compare_start)
    .bind(period.compare_end)
    .fetch_one(&mut **tx)
    .await?;
    Ok(metrics)
}

#[derive(sqlx::FromRow)]
struct DueMetrics {
    overdue_count: i64,
    overdue_minor: i64,
    renewal_count: i64,
    renewal_minor: i64,
    collected_count: i64,
    collected_minor: i64,
    previous_collected_minor: i64,
    due_in_period: i64,
    paid_of_due_in_period: i64,
    pending_count: i64,
    pending_minor: i64,
    pending_overdue_minor: i64,
    policies_total: i64,
    policies_new: i64,
    policies_new_previous: i64,
    insured_clients: i64,
}

async fn load_due_metrics(
    tx: &mut Tx<'_>,
    company: Uuid,
    period: &PeriodBounds,
) -> Result<DueMetrics, ApiError> {
    // $2 start, $3 end, $4 effective end, $5 compare start, $6 compare end, $7 today.
    let metrics = sqlx::query_as(concat!(
        "WITH ",
        dues_sql!(),
        ", policies AS (
           SELECT client_id,
                  (created_at AT TIME ZONE 'America/Santo_Domingo')::date AS created_on
           FROM insurance_policies
           WHERE company_id = $1
         )
         SELECT
           (SELECT count(*) FROM dues WHERE paid_on IS NULL AND due_on < $7::date) AS overdue_count,
           (SELECT COALESCE(sum(amount_minor), 0)::bigint FROM dues
            WHERE paid_on IS NULL AND due_on < $7::date) AS overdue_minor,
           (SELECT count(*) FROM dues
            WHERE paid_on IS NULL AND slot = 0 AND due_on >= $7::date AND due_on <= $7::date + 7) AS renewal_count,
           (SELECT COALESCE(sum(amount_minor), 0)::bigint FROM dues
            WHERE paid_on IS NULL AND slot = 0 AND due_on >= $7::date AND due_on <= $7::date + 7) AS renewal_minor,
           (SELECT count(*) FROM dues WHERE paid_on >= $2::date AND paid_on < $4::date) AS collected_count,
           (SELECT COALESCE(sum(amount_minor), 0)::bigint FROM dues
            WHERE paid_on >= $2::date AND paid_on < $4::date) AS collected_minor,
           (SELECT COALESCE(sum(amount_minor), 0)::bigint FROM dues
            WHERE paid_on >= $5::date AND paid_on < $6::date) AS previous_collected_minor,
           (SELECT count(*) FROM dues WHERE due_on >= $2::date AND due_on < $4::date) AS due_in_period,
           (SELECT count(*) FROM dues
            WHERE due_on >= $2::date AND due_on < $4::date AND paid_on IS NOT NULL) AS paid_of_due_in_period,
           (SELECT count(*) FROM dues WHERE paid_on IS NULL AND due_on < $3::date) AS pending_count,
           (SELECT COALESCE(sum(amount_minor), 0)::bigint FROM dues
            WHERE paid_on IS NULL AND due_on < $3::date) AS pending_minor,
           (SELECT COALESCE(sum(amount_minor), 0)::bigint FROM dues
            WHERE paid_on IS NULL AND due_on < $3::date AND due_on < $7::date) AS pending_overdue_minor,
           (SELECT count(*) FROM policies) AS policies_total,
           (SELECT count(*) FROM policies WHERE created_on >= $2::date AND created_on < $4::date) AS policies_new,
           (SELECT count(*) FROM policies WHERE created_on >= $5::date AND created_on < $6::date) AS policies_new_previous,
           (SELECT count(DISTINCT client_id) FROM policies) AS insured_clients"
    ))
    .bind(company)
    .bind(period.start)
    .bind(period.end)
    .bind(period.effective_end)
    .bind(period.compare_start)
    .bind(period.compare_end)
    .bind(period.today)
    .fetch_one(&mut **tx)
    .await?;
    Ok(metrics)
}

async fn load_aging(
    tx: &mut Tx<'_>,
    company: Uuid,
    today: NaiveDate,
) -> Result<Vec<DashboardAgingBucket>, ApiError> {
    let buckets = sqlx::query_as(concat!(
        "WITH ",
        dues_sql!(),
        ", overdue AS (
           SELECT CASE
                    WHEN $2::date - due_on <= 30 THEN 1
                    WHEN $2::date - due_on <= 60 THEN 2
                    WHEN $2::date - due_on <= 90 THEN 3
                    ELSE 4
                  END AS position,
                  amount_minor
           FROM dues
           WHERE paid_on IS NULL AND due_on < $2::date
         )
         SELECT b.bucket,
                count(o.position) AS count,
                COALESCE(sum(o.amount_minor), 0)::bigint AS amount_minor
         FROM (VALUES (1, '1-30'), (2, '31-60'), (3, '61-90'), (4, '90+')) AS b(position, bucket)
         LEFT JOIN overdue o ON o.position = b.position
         GROUP BY b.position, b.bucket
         ORDER BY b.position"
    ))
    .bind(company)
    .bind(today)
    .fetch_all(&mut **tx)
    .await?;
    Ok(buckets)
}

async fn load_carrier_balances(
    tx: &mut Tx<'_>,
    company: Uuid,
    period_end: NaiveDate,
) -> Result<Vec<DashboardCarrierBalance>, ApiError> {
    let carriers = sqlx::query_as(concat!(
        "WITH ",
        dues_sql!(),
        "
         SELECT c.id AS carrier_id, c.name AS carrier_name, count(*) AS count,
                sum(d.amount_minor)::bigint AS amount_minor
         FROM dues d
         JOIN insurance_carriers c ON c.id = d.carrier_id
         WHERE d.paid_on IS NULL AND d.due_on < $2::date
         GROUP BY c.id, c.name
         ORDER BY amount_minor DESC, lower(c.name), c.id"
    ))
    .bind(company)
    .bind(period_end)
    .fetch_all(&mut **tx)
    .await?;
    Ok(carriers)
}

async fn load_attention_dues(
    tx: &mut Tx<'_>,
    company: Uuid,
    period_end: NaiveDate,
) -> Result<Vec<DashboardAttentionDue>, ApiError> {
    let dues = sqlx::query_as(concat!(
        "WITH ",
        dues_sql!(),
        "
         SELECT d.id AS due_id, d.policy_id, d.policy_number, cl.name AS client_name,
                c.name AS carrier_name, d.slot, d.due_on, d.amount_minor
         FROM dues d
         JOIN insurance_carriers c ON c.id = d.carrier_id
         JOIN clients cl ON cl.id = d.client_id
         WHERE d.paid_on IS NULL AND d.due_on < $2::date
         ORDER BY d.due_on, d.id
         LIMIT 10"
    ))
    .bind(company)
    .bind(period_end)
    .fetch_all(&mut **tx)
    .await?;
    Ok(dues)
}

async fn load_trend(
    tx: &mut Tx<'_>,
    company: Uuid,
    today: NaiveDate,
) -> Result<Vec<DashboardTrendMonth>, ApiError> {
    let months = sqlx::query_as(concat!(
        "WITH ",
        dated_cases_sql!(),
        ", ",
        dues_sql!(),
        ", months AS (
           SELECT generate_series(
                    date_trunc('month', $2::date::timestamp) - interval '11 months',
                    date_trunc('month', $2::date::timestamp),
                    interval '1 month'
                  )::date AS month
         ), created AS (
           SELECT date_trunc('month', created_on::timestamp)::date AS month, count(*) AS total
           FROM cases GROUP BY 1
         ), disbursed AS (
           SELECT date_trunc('month', disbursed_on::timestamp)::date AS month,
                  sum(principal_minor)::bigint AS total
           FROM cases WHERE disbursed_on IS NOT NULL GROUP BY 1
         ), collected AS (
           SELECT date_trunc('month', paid_on::timestamp)::date AS month,
                  sum(amount_minor)::bigint AS total
           FROM dues WHERE paid_on IS NOT NULL GROUP BY 1
         )
         SELECT to_char(m.month, 'YYYY-MM') AS month,
                COALESCE(created.total, 0)::bigint AS cases_created,
                COALESCE(disbursed.total, 0)::bigint AS disbursed_amount_minor,
                COALESCE(collected.total, 0)::bigint AS collected_amount_minor
         FROM months m
         LEFT JOIN created ON created.month = m.month
         LEFT JOIN disbursed ON disbursed.month = m.month
         LEFT JOIN collected ON collected.month = m.month
         ORDER BY m.month"
    ))
    .bind(company)
    .bind(today)
    .fetch_all(&mut **tx)
    .await?;
    Ok(months)
}

const STALLED_CASES_SQL: &str = "WITH open_cases AS (
       SELECT o.id, o.client_id, c.name AS client_name, o.reference, o.status,
              greatest(
                o.updated_at,
                (SELECT max(h.occurred_at) FROM client_case_history h WHERE h.operation_id = o.id)
              ) AS last_activity_at
       FROM client_operations o
       JOIN clients c ON c.id = o.client_id
       WHERE o.deleted_at IS NULL
         AND o.company_id = $1
         AND o.status IN ('solicitud', 'en_proceso', 'firma')
     ), stalled AS (
       SELECT * FROM open_cases WHERE last_activity_at < now() - interval '7 days'
     )";

async fn load_stalled_cases(
    tx: &mut Tx<'_>,
    company: Uuid,
) -> Result<DashboardStalledCases, ApiError> {
    let count: i64 = sqlx::query_scalar(sqlx::AssertSqlSafe(format!(
        "{STALLED_CASES_SQL} SELECT count(*) FROM stalled"
    )))
    .bind(company)
    .fetch_one(&mut **tx)
    .await?;
    let items = sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "{STALLED_CASES_SQL}
         SELECT id, client_id, client_name, reference, status, last_activity_at,
                floor(extract(epoch FROM now() - last_activity_at) / 86400)::bigint AS days_without_activity
         FROM stalled
         ORDER BY last_activity_at ASC, id ASC
         LIMIT 8"
    )))
    .bind(company)
    .fetch_all(&mut **tx)
    .await?;
    Ok(DashboardStalledCases { count, items })
}
