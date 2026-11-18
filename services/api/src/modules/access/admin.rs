use axum::{Json, extract::State, middleware};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::types::Json as DbJson;
use utoipa::{IntoParams, ToSchema};
use utoipa_axum::{router::OpenApiRouter, routes};
use uuid::Uuid;
use validator::Validate;

use crate::{
    app_state::AppState,
    error::{ApiError, ErrorEnvelope},
    extract::{ApiJson, ApiPath, ApiQuery},
    modules::companies,
};

use super::{Notice, activity, dashboard, no_store, notice_for};

pub(super) fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new()
        .routes(routes!(dashboard::summary))
        .routes(routes!(requests))
        .routes(routes!(users))
        .routes(routes!(set_user_access))
        .routes(routes!(set_user_billing))
        .routes(routes!(activity::list))
        .merge(activity::timeline_router())
        .routes(routes!(companies::admin_companies))
        .route_layer(middleware::from_fn(no_store))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub(super) enum UserStatus {
    Pending,
    Invited,
    Active,
    Suspended,
}

impl UserStatus {
    fn as_str(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Invited => "invited",
            Self::Active => "active",
            Self::Suspended => "suspended",
        }
    }
}

#[derive(Deserialize, Validate, IntoParams)]
#[serde(deny_unknown_fields)]
#[into_params(parameter_in = Query)]
struct UserQuery {
    #[validate(length(max = 200))]
    query: Option<String>,
    status: Option<UserStatus>,
    #[validate(range(min = 1))]
    #[param(minimum = 1, default = 1)]
    page: Option<i64>,
    #[validate(range(min = 1, max = 250))]
    #[param(minimum = 1, maximum = 250, default = 250)]
    per_page: Option<i64>,
}

#[derive(Serialize, ToSchema)]
struct UserList {
    items: Vec<UserItem>,
}

#[derive(Serialize, ToSchema)]
struct UserPage {
    items: Vec<UserItem>,
    page: i64,
    per_page: i64,
    total: i64,
}

#[derive(Serialize, ToSchema)]
struct UserItem {
    id: Option<Uuid>,
    name: Option<String>,
    email: String,
    status: UserStatus,
    company_ids: Vec<Uuid>,
    created_at: DateTime<Utc>,
    /// Whether this person manages at least one billing account.
    manages_billing: bool,
    notice: Option<Notice>,
}

#[derive(Deserialize, sqlx::FromRow)]
struct UserRow {
    id: Option<Uuid>,
    name: Option<String>,
    email: String,
    status: String,
    company_ids: Vec<Uuid>,
    created_at: DateTime<Utc>,
    manages_billing: bool,
    attempts: Option<i32>,
    sent: bool,
}

impl UserRow {
    fn wire(self) -> Result<UserItem, ApiError> {
        let status = match self.status.as_str() {
            "pending" => UserStatus::Pending,
            "invited" => UserStatus::Invited,
            "active" => UserStatus::Active,
            "suspended" => UserStatus::Suspended,
            _ => return Err(ApiError::Internal(anyhow::anyhow!("invalid access status"))),
        };
        Ok(UserItem {
            id: self.id,
            name: self.name,
            email: self.email,
            status,
            company_ids: self.company_ids,
            created_at: self.created_at,
            manages_billing: self.manages_billing,
            notice: self
                .attempts
                .map(|attempts| notice_for(attempts, self.sent)),
        })
    }
}

pub(super) const USER_SOURCE: &str = "
    WITH people AS (
      SELECT i.user_id AS id, i.name, i.email,
        CASE WHEN p.account_status = 'deleted' OR i.suspended THEN 'suspended'
             WHEN i.enabled_at IS NOT NULL THEN 'active' ELSE 'pending' END AS status,
        a.ids AS company_ids, i.created_at,
        EXISTS (
          SELECT 1 FROM billing_account_managers bam
          WHERE bam.user_id = i.user_id
        ) AS manages_billing,
        m.attempts, (m.sent_at IS NOT NULL) AS sent
      FROM access_identities i
      JOIN profiles p ON p.user_id = i.user_id
      CROSS JOIN LATERAL (
        SELECT ARRAY(SELECT c.id FROM company_memberships mm
          JOIN companies c ON c.id = mm.company_id
          WHERE mm.user_id = i.user_id AND c.archived_at IS NULL ORDER BY c.id) AS ids
      ) a
      LEFT JOIN access_mail m ON m.kind = 'request' AND m.reference = i.user_id::text
      UNION ALL
      SELECT NULL, v.name, v.email, 'invited', v.company_ids, v.created_at, false,
        m.attempts, (m.sent_at IS NOT NULL)
      FROM access_invitations v
      LEFT JOIN access_mail m ON m.kind = 'invitation' AND m.reference = v.email
      WHERE v.accepted_by IS NULL
    )";

const USER_ROWS: &str = "
    SELECT id, name, email, status, company_ids, created_at, manages_billing, attempts, sent
    FROM people
";

#[derive(sqlx::FromRow)]
struct UserPageRow {
    total: i64,
    items: DbJson<Vec<UserRow>>,
}

async fn list_users(state: &AppState, query: UserQuery) -> Result<UserPage, ApiError> {
    let page = query.page.unwrap_or(1);
    let per_page = query.per_page.unwrap_or(250);
    let offset = (page - 1).saturating_mul(per_page);
    let sql = format!(
        "{USER_SOURCE}, matching AS (
        {USER_ROWS}
        WHERE ($1::text IS NULL OR strpos(lower(email), lower($1)) > 0
               OR strpos(lower(COALESCE(name, '')), lower($1)) > 0)
          AND ($2::text IS NULL OR status = $2)
          AND ($3::uuid IS NULL OR id IS DISTINCT FROM $3)
        ), paged AS (
            SELECT * FROM matching ORDER BY created_at DESC, email, id LIMIT $4 OFFSET $5
        )
        SELECT (SELECT count(*) FROM matching) AS total,
            COALESCE(jsonb_agg(to_jsonb(paged) ORDER BY created_at DESC, email, id), '[]'::jsonb) AS items
        FROM paged"
    );
    let rows: UserPageRow = sqlx::query_as(sqlx::AssertSqlSafe(sql))
        .bind(
            query
                .query
                .as_deref()
                .map(str::trim)
                .filter(|q| !q.is_empty()),
        )
        .bind(query.status.map(UserStatus::as_str))
        .bind(state.config.superadmin_id)
        .bind(per_page)
        .bind(offset)
        .fetch_one(&state.db)
        .await?;
    Ok(UserPage {
        items: rows
            .items
            .0
            .into_iter()
            .map(UserRow::wire)
            .collect::<Result<_, _>>()?,
        page,
        per_page,
        total: rows.total,
    })
}

#[utoipa::path(
    get, path = "/api/v1/admin/requests", tag = "Administration", security(("bearer_auth" = [])),
    responses((status = 200, body = UserList), (status = 403, body = ErrorEnvelope))
)]
async fn requests(State(state): State<AppState>) -> Result<Json<UserList>, ApiError> {
    let result = list_users(
        &state,
        UserQuery {
            query: None,
            status: Some(UserStatus::Pending),
            page: None,
            per_page: None,
        },
    )
    .await?;
    Ok(Json(UserList {
        items: result.items,
    }))
}

#[utoipa::path(
    get, path = "/api/v1/admin/users", tag = "Administration", security(("bearer_auth" = [])),
    params(UserQuery), responses(
        (status = 200, body = UserPage),
        (status = 403, body = ErrorEnvelope),
        (status = 422, description = "Invalid pagination or search query", body = ErrorEnvelope)
    )
)]
async fn users(
    State(state): State<AppState>,
    ApiQuery(query): ApiQuery<UserQuery>,
) -> Result<Json<UserPage>, ApiError> {
    Ok(Json(list_users(&state, query).await?))
}

#[derive(Deserialize, Validate, ToSchema)]
#[serde(deny_unknown_fields)]
struct UserAccess {
    /// `true` lets the person work in every active company; `false` removes access.
    enabled: bool,
}

/// Enables or disables a person's access to YZY Contracts.
#[utoipa::path(
    put, path = "/api/v1/admin/users/{id}/access", tag = "Administration", security(("bearer_auth" = [])),
    params(("id" = Uuid, Path, description = "User ID")), request_body = UserAccess,
    responses(
        (status = 200, body = UserItem),
        (status = 403, body = ErrorEnvelope),
        (status = 404, description = "The person has not signed in to YZY Contracts", body = ErrorEnvelope),
        (status = 422, description = "The superadministrator's own access cannot change", body = ErrorEnvelope),
    )
)]
async fn set_user_access(
    State(state): State<AppState>,
    ApiPath(id): ApiPath<Uuid>,
    ApiJson(body): ApiJson<UserAccess>,
) -> Result<Json<UserItem>, ApiError> {
    if state.config.superadmin_id == Some(id) {
        return Err(ApiError::Validation(
            "El acceso del superadministrador no se puede cambiar.".to_owned(),
        ));
    }
    let updated = sqlx::query(
        "UPDATE access_identities
         SET suspended = NOT $2,
             enabled_at = CASE WHEN $2 THEN COALESCE(enabled_at, now()) ELSE enabled_at END
         WHERE user_id = $1",
    )
    .bind(id)
    .bind(body.enabled)
    .execute(&state.db)
    .await?;
    if updated.rows_affected() == 0 {
        return Err(ApiError::AccessUserNotFound);
    }
    let sql = format!("{USER_SOURCE}{USER_ROWS} WHERE id = $1");
    let row: UserRow = sqlx::query_as(sqlx::AssertSqlSafe(sql))
        .bind(id)
        .fetch_one(&state.db)
        .await?;
    Ok(Json(row.wire()?))
}

#[derive(Deserialize, Validate, ToSchema)]
#[serde(deny_unknown_fields)]
struct UserBilling {
    /// `true` assigns the person as billing manager of every account; `false` removes that role.
    manages_billing: bool,
}

/// Assigns or removes a person as billing manager of every billing account.
#[utoipa::path(
    put, path = "/api/v1/admin/users/{id}/billing", tag = "Administration", security(("bearer_auth" = [])),
    params(("id" = Uuid, Path, description = "User ID")), request_body = UserBilling,
    responses(
        (status = 200, body = UserItem),
        (status = 403, body = ErrorEnvelope),
        (status = 404, description = "The person has not signed in to YZY Contracts", body = ErrorEnvelope),
        (status = 422, description = "Only enabled users can manage billing, and each account needs a manager", body = ErrorEnvelope),
    )
)]
async fn set_user_billing(
    State(state): State<AppState>,
    ApiPath(id): ApiPath<Uuid>,
    ApiJson(body): ApiJson<UserBilling>,
) -> Result<Json<UserItem>, ApiError> {
    if state.config.superadmin_id == Some(id) {
        return Err(ApiError::Validation(
            "El superadministrador ya administra la facturación.".to_owned(),
        ));
    }
    let mut tx = state.db.begin().await?;
    let exists: bool =
        sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM access_identities WHERE user_id = $1)")
            .bind(id)
            .fetch_one(&mut *tx)
            .await?;
    if !exists {
        return Err(ApiError::AccessUserNotFound);
    }
    if body.manages_billing {
        let enabled: bool = sqlx::query_scalar("SELECT has_enabled_access($1)")
            .bind(id)
            .fetch_one(&mut *tx)
            .await?;
        if !enabled {
            return Err(ApiError::Validation(
                "Habilita el acceso de la persona antes de asignarla como responsable de facturación."
                    .to_owned(),
            ));
        }
        sqlx::query(
            "INSERT INTO billing_account_managers (account_id, user_id)
             SELECT a.id, $1 FROM billing_accounts a
             ON CONFLICT DO NOTHING",
        )
        .bind(id)
        .execute(&mut *tx)
        .await?;
    } else {
        let Some(fallback) = state.config.superadmin_id else {
            return Err(ApiError::Validation(
                "No hay superadministrador configurado para conservar las cuentas sin responsable."
                    .to_owned(),
            ));
        };
        sqlx::query(
            "UPDATE billing_accounts
             SET manager_user_id = $2
             WHERE manager_user_id = $1",
        )
        .bind(id)
        .bind(fallback)
        .execute(&mut *tx)
        .await?;
        sqlx::query(
            "INSERT INTO billing_account_managers (account_id, user_id)
             SELECT a.id, a.manager_user_id FROM billing_accounts a
             WHERE a.manager_user_id = $1
             ON CONFLICT DO NOTHING",
        )
        .bind(fallback)
        .execute(&mut *tx)
        .await?;
        sqlx::query("DELETE FROM billing_account_managers WHERE user_id = $1")
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    let sql = format!("{USER_SOURCE}{USER_ROWS} WHERE id = $1");
    let row: UserRow = sqlx::query_as(sqlx::AssertSqlSafe(sql))
        .bind(id)
        .fetch_one(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(Json(row.wire()?))
}
