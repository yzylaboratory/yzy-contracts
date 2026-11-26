use axum::{Extension, Json, extract::State};
use chrono::{DateTime, Utc};
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

#[derive(Debug, Deserialize, Validate, IntoParams)]
#[serde(deny_unknown_fields)]
#[into_params(parameter_in = Query)]
pub(super) struct DashboardQuery {
    pub company_id: Uuid,
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
    pub insurance: DashboardInsurance,
    pub status_counts: DashboardStatusCounts,
    pub user_stats: Vec<DashboardUserStat>,
    pub months: Vec<DashboardMonth>,
    pub formats: DashboardFormats,
    pub recent_cases: Vec<DashboardCase>,
}

#[derive(Serialize, ToSchema)]
pub(super) struct DashboardInsurance {
    pub policies_total: i64,
    pub insured_clients: i64,
    pub collected_this_month: DashboardAmount,
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
    policies_total: i64,
    insured_clients: i64,
    insurance_collected_count: i64,
    insurance_collected_minor: i64,
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
    let allowed: bool = sqlx::query_scalar("SELECT has_company_membership($1, $2)")
        .bind(user.id)
        .bind(query.company_id)
        .fetch_one(&state.db)
        .await?;
    if !allowed {
        return Err(ApiError::CompanyNotFound);
    }

    let row: SummaryRow = sqlx::query_as(
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
                  CASE
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
                  END AS disbursed_at
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
             (SELECT count(*) FROM insurance_policies WHERE company_id = $1) AS policies_total,
             (SELECT count(DISTINCT client_id) FROM insurance_policies WHERE company_id = $1) AS insured_clients,
             (SELECT count(*) FROM insurance_dues d
              JOIN insurance_policies p ON p.id = d.policy_id, clock
              WHERE p.company_id = $1
                AND d.paid_on >= clock.month::date
                AND d.paid_on < (clock.month + interval '1 month')::date
             ) AS insurance_collected_count,
             (SELECT COALESCE(sum(d.amount_minor), 0)::bigint FROM insurance_dues d
              JOIN insurance_policies p ON p.id = d.policy_id, clock
              WHERE p.company_id = $1
                AND d.paid_on >= clock.month::date
                AND d.paid_on < (clock.month + interval '1 month')::date
             ) AS insurance_collected_minor,
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
         FROM totals",
    )
    .bind(query.company_id)
    .bind(user.id)
    .bind(state.config.superadmin_id)
    .bind(ESTIMATED_MINUTES_PER_DOCUMENT)
    .bind(ESTIMATED_MINUTES_PER_CASE)
    .fetch_one(&state.db)
    .await?;

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
        insurance: DashboardInsurance {
            policies_total: row.policies_total,
            insured_clients: row.insured_clients,
            collected_this_month: DashboardAmount {
                count: row.insurance_collected_count,
                amount_minor: row.insurance_collected_minor,
            },
        },
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
