use axum::{Extension, Json, extract::State, http::StatusCode};
use chrono::{Months, NaiveDate};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, PgConnection};
use utoipa::{IntoParams, ToSchema};
use utoipa_axum::{router::OpenApiRouter, routes};
use uuid::Uuid;
use validator::Validate;

use crate::{
    app_state::AppState,
    error::{ApiError, ErrorEnvelope},
    extract::{ApiJson, ApiPath, ApiQuery},
    infrastructure::schema::DatabaseSchema,
    modules::auth::AuthUser,
};

const MAX_MINOR: i64 = 99_999_999_999;
const TODAY_SQL: &str = "SELECT (now() AT TIME ZONE 'America/Santo_Domingo')::date";

pub fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new()
        .routes(routes!(overview))
        .routes(routes!(create_carrier))
        .routes(routes!(create_policy))
        .routes(routes!(policy_detail, edit_policy))
        .routes(routes!(pay_due))
}

#[derive(Serialize, ToSchema, FromRow)]
struct Carrier {
    id: Uuid,
    name: String,
}

#[derive(Deserialize, ToSchema, Validate)]
struct CarrierWrite {
    name: String,
}

#[derive(Serialize, ToSchema, FromRow)]
struct Policy {
    id: Uuid,
    carrier_id: Uuid,
    client_id: Uuid,
    client_name: String,
    number: String,
    revision: i32,
    first_due_on: NaiveDate,
    installment_count: i32,
    installment_minor: i64,
    renewal_on: NaiveDate,
    renewal_minor: i64,
}

#[derive(Deserialize, ToSchema, Validate)]
struct PolicyWrite {
    carrier_id: Uuid,
    client_id: Uuid,
    number: String,
    first_due_on: NaiveDate,
    #[schema(minimum = 1, maximum = 120)]
    installment_count: i32,
    #[schema(minimum = 1, maximum = 99999999999_i64)]
    installment_minor: i64,
    renewal_on: NaiveDate,
    #[schema(minimum = 1, maximum = 99999999999_i64)]
    renewal_minor: i64,
}

#[derive(Deserialize, ToSchema, Validate)]
struct PolicyEdit {
    revision: i32,
    #[serde(flatten)]
    policy: PolicyWrite,
}

#[derive(Serialize, ToSchema, FromRow)]
struct Due {
    id: Uuid,
    policy_id: Uuid,
    /// Zero identifies the renewal. Positive values identify the installments.
    slot: i32,
    due_on: NaiveDate,
    amount_minor: i64,
    paid_on: Option<NaiveDate>,
    replaced: bool,
}

#[derive(Deserialize, ToSchema, Validate)]
struct PaymentWrite {
    paid_on: NaiveDate,
}

#[derive(Deserialize, IntoParams, Validate)]
#[into_params(parameter_in = Query)]
struct Window {
    #[param(minimum = 1, maximum = 365, default = 7)]
    days: Option<i32>,
    #[param(default = true)]
    include_overdue: Option<bool>,
}

#[derive(Serialize, ToSchema)]
struct Overview {
    today: NaiveDate,
    carriers: Vec<Carrier>,
    policies: Vec<Policy>,
    dues: Vec<Due>,
}

#[derive(Serialize, ToSchema)]
struct PolicyDetail {
    today: NaiveDate,
    carrier_name: String,
    policy: Policy,
    dues: Vec<Due>,
}

const POLICY_SQL: &str = "SELECT p.id, p.carrier_id, p.client_id, c.name AS client_name,
    p.number, p.revision, p.first_due_on, p.installment_count, p.installment_minor,
    p.renewal_on, p.renewal_minor FROM insurance_policies p JOIN clients c ON c.id = p.client_id";
const DUE_COLUMNS: &str = "d.id, d.policy_id, d.slot, d.due_on, d.amount_minor, d.paid_on, (d.replaced_at IS NOT NULL) AS replaced";

async fn authorize(state: &AppState, user: &AuthUser, company: Uuid) -> Result<(), ApiError> {
    if state.config.database_schema != DatabaseSchema::Development {
        return Err(ApiError::RouteNotFound);
    }
    let allowed: bool = sqlx::query_scalar("SELECT has_company_membership($1, $2)")
        .bind(user.id)
        .bind(company)
        .fetch_one(&state.db)
        .await?;
    allowed.then_some(()).ok_or(ApiError::CompanyNotFound)
}

fn label(value: &str, max: usize) -> Result<&str, ApiError> {
    let value = value.trim();
    if value.is_empty() || value.chars().count() > max || value.chars().any(char::is_control) {
        return Err(ApiError::Validation("Revisa el texto ingresado.".into()));
    }
    Ok(value)
}

fn valid_date(date: NaiveDate) -> bool {
    (NaiveDate::from_ymd_opt(1, 1, 1).unwrap()..=NaiveDate::from_ymd_opt(9999, 12, 31).unwrap())
        .contains(&date)
}

fn schedule(body: &PolicyWrite) -> Result<Vec<(i32, NaiveDate, i64)>, ApiError> {
    if !(1..=120).contains(&body.installment_count)
        || !(1..=MAX_MINOR).contains(&body.installment_minor)
        || !(1..=MAX_MINOR).contains(&body.renewal_minor)
    {
        return Err(ApiError::Validation(
            "Revisa los montos y la cantidad de cuotas.".into(),
        ));
    }
    let dates = (1..=body.installment_count).map(|slot| {
        body.first_due_on
            .checked_add_months(Months::new((slot - 1) as u32))
            .filter(|date| valid_date(*date))
            .map(|date| (slot, date, body.installment_minor))
    });
    std::iter::once(valid_date(body.renewal_on).then_some((0, body.renewal_on, body.renewal_minor)))
        .chain(dates)
        .collect::<Option<Vec<_>>>()
        .ok_or_else(|| ApiError::Validation("Revisa las fechas del calendario.".into()))
}

fn write_error(error: sqlx::Error) -> ApiError {
    if let Some(db) = error.as_database_error() {
        return match db.constraint() {
            Some("insurance_carriers_name_idx") => {
                ApiError::InsuranceConflict("Ya existe una aseguradora con ese nombre.")
            }
            Some("insurance_policies_number_idx") => ApiError::InsuranceConflict(
                "Ya existe una póliza con ese número para la aseguradora.",
            ),
            Some("insurance_policies_client_id_fkey") => ApiError::ClientNotFound,
            Some("insurance_policies_company_id_carrier_id_fkey") => {
                ApiError::Validation("Selecciona una aseguradora de esta empresa.".into())
            }
            _ => error.into(),
        };
    }
    error.into()
}

#[utoipa::path(get, path = "/api/v1/companies/{company_id}/insurance", tag = "Insurance",
    security(("bearer_auth" = [])), params(("company_id" = Uuid, Path), Window),
    responses((status = 200, body = Overview), (status = 401, body = ErrorEnvelope),
    (status = 403, body = ErrorEnvelope), (status = 404, body = ErrorEnvelope), (status = 422, body = ErrorEnvelope)))]
async fn overview(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
    ApiPath(company): ApiPath<Uuid>,
    ApiQuery(window): ApiQuery<Window>,
) -> Result<Json<Overview>, ApiError> {
    authorize(&state, &user, company).await?;
    let days = window.days.unwrap_or(7);
    if !(1..=365).contains(&days) {
        return Err(ApiError::Validation(
            "La ventana debe ser de 1 a 365 días.".into(),
        ));
    }
    let mut tx = state.db.begin().await?;
    sqlx::query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
        .execute(&mut *tx)
        .await?;
    let today: NaiveDate = sqlx::query_scalar(TODAY_SQL).fetch_one(&mut *tx).await?;
    let carriers = sqlx::query_as(
        "SELECT id, name FROM insurance_carriers WHERE company_id = $1 ORDER BY lower(name), id",
    )
    .bind(company)
    .fetch_all(&mut *tx)
    .await?;
    let policies = sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "{POLICY_SQL} WHERE p.company_id = $1 ORDER BY lower(p.number), p.id"
    )))
    .bind(company)
    .fetch_all(&mut *tx)
    .await?;
    let dues = sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "SELECT {DUE_COLUMNS} FROM insurance_dues d
        JOIN insurance_policies p ON p.id = d.policy_id
        WHERE p.company_id = $1 AND d.paid_on IS NULL AND d.replaced_at IS NULL
          AND d.due_on <= $2::date + $3 AND ($4 OR d.due_on >= $2)
        ORDER BY d.due_on, d.id"
    )))
    .bind(company)
    .bind(today)
    .bind(days)
    .bind(window.include_overdue.unwrap_or(true))
    .fetch_all(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Json(Overview {
        today,
        carriers,
        policies,
        dues,
    }))
}

#[utoipa::path(post, path = "/api/v1/companies/{company_id}/insurance/carriers", tag = "Insurance",
    security(("bearer_auth" = [])), params(("company_id" = Uuid, Path)), request_body = CarrierWrite,
    responses((status = 201, body = Carrier), (status = 401, body = ErrorEnvelope),
    (status = 403, body = ErrorEnvelope), (status = 404, body = ErrorEnvelope),
    (status = 409, body = ErrorEnvelope), (status = 422, body = ErrorEnvelope)))]
async fn create_carrier(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
    ApiPath(company): ApiPath<Uuid>,
    ApiJson(body): ApiJson<CarrierWrite>,
) -> Result<(StatusCode, Json<Carrier>), ApiError> {
    authorize(&state, &user, company).await?;
    let carrier = sqlx::query_as(
        "INSERT INTO insurance_carriers (company_id, name) VALUES ($1, $2) RETURNING id, name",
    )
    .bind(company)
    .bind(label(&body.name, 160)?)
    .fetch_one(&state.db)
    .await
    .map_err(write_error)?;
    Ok((StatusCode::CREATED, Json(carrier)))
}

async fn detail(db: &mut PgConnection, company: Uuid, id: Uuid) -> Result<PolicyDetail, ApiError> {
    let policy: Policy = sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "{POLICY_SQL} WHERE p.company_id = $1 AND p.id = $2"
    )))
    .bind(company)
    .bind(id)
    .fetch_optional(&mut *db)
    .await?
    .ok_or(ApiError::RouteNotFound)?;
    let carrier_name =
        sqlx::query_scalar("SELECT name FROM insurance_carriers WHERE company_id = $1 AND id = $2")
            .bind(company)
            .bind(policy.carrier_id)
            .fetch_one(&mut *db)
            .await?;
    let dues = sqlx::query_as(sqlx::AssertSqlSafe(format!("SELECT {DUE_COLUMNS} FROM insurance_dues d WHERE d.policy_id = $1 ORDER BY d.slot, d.due_on, d.id")))
        .bind(id).fetch_all(&mut *db).await?;
    let today = sqlx::query_scalar(TODAY_SQL).fetch_one(&mut *db).await?;
    Ok(PolicyDetail {
        policy,
        carrier_name,
        dues,
        today,
    })
}

#[utoipa::path(get, path = "/api/v1/companies/{company_id}/insurance/policies/{policy_id}", tag = "Insurance",
    security(("bearer_auth" = [])), params(("company_id" = Uuid, Path), ("policy_id" = Uuid, Path)),
    responses((status = 200, body = PolicyDetail), (status = 401, body = ErrorEnvelope),
    (status = 403, body = ErrorEnvelope), (status = 404, body = ErrorEnvelope), (status = 422, body = ErrorEnvelope)))]
async fn policy_detail(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
    ApiPath((company, id)): ApiPath<(Uuid, Uuid)>,
) -> Result<Json<PolicyDetail>, ApiError> {
    authorize(&state, &user, company).await?;
    let mut tx = state.db.begin().await?;
    sqlx::query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
        .execute(&mut *tx)
        .await?;
    let policy = detail(&mut tx, company, id).await?;
    tx.commit().await?;
    Ok(Json(policy))
}

#[utoipa::path(post, path = "/api/v1/companies/{company_id}/insurance/policies", tag = "Insurance",
    security(("bearer_auth" = [])), params(("company_id" = Uuid, Path)), request_body = PolicyWrite,
    responses((status = 201, body = PolicyDetail), (status = 401, body = ErrorEnvelope),
    (status = 403, body = ErrorEnvelope), (status = 404, body = ErrorEnvelope),
    (status = 409, body = ErrorEnvelope), (status = 422, body = ErrorEnvelope)))]
async fn create_policy(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
    ApiPath(company): ApiPath<Uuid>,
    ApiJson(body): ApiJson<PolicyWrite>,
) -> Result<(StatusCode, Json<PolicyDetail>), ApiError> {
    authorize(&state, &user, company).await?;
    let number = label(&body.number, 120)?;
    let planned = schedule(&body)?;
    let mut tx = state.db.begin().await?;
    let id = sqlx::query_scalar("INSERT INTO insurance_policies
        (company_id, carrier_id, client_id, number, first_due_on, installment_count, installment_minor, renewal_on, renewal_minor)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id")
        .bind(company).bind(body.carrier_id).bind(body.client_id).bind(number)
        .bind(body.first_due_on).bind(body.installment_count).bind(body.installment_minor)
        .bind(body.renewal_on).bind(body.renewal_minor).fetch_one(&mut *tx).await.map_err(write_error)?;
    sync_schedule(&mut tx, id, &planned).await?;
    let saved = detail(&mut tx, company, id).await?;
    tx.commit().await?;
    Ok((StatusCode::CREATED, Json(saved)))
}

#[utoipa::path(put, path = "/api/v1/companies/{company_id}/insurance/policies/{policy_id}", tag = "Insurance",
    security(("bearer_auth" = [])), params(("company_id" = Uuid, Path), ("policy_id" = Uuid, Path)),
    request_body = PolicyEdit, responses((status = 200, body = PolicyDetail), (status = 401, body = ErrorEnvelope),
    (status = 403, body = ErrorEnvelope), (status = 404, body = ErrorEnvelope),
    (status = 409, body = ErrorEnvelope), (status = 422, body = ErrorEnvelope)))]
async fn edit_policy(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
    ApiPath((company, id)): ApiPath<(Uuid, Uuid)>,
    ApiJson(edit): ApiJson<PolicyEdit>,
) -> Result<Json<PolicyDetail>, ApiError> {
    authorize(&state, &user, company).await?;
    let body = edit.policy;
    let number = label(&body.number, 120)?;
    let planned = schedule(&body)?;
    let mut tx = state.db.begin().await?;
    let (revision, carrier, client) = lock_policy(&mut tx, company, id).await?;
    if revision != edit.revision {
        return Err(ApiError::InsuranceConflict(
            "La póliza cambió. Vuelve a abrirla antes de editar.",
        ));
    }
    let paid: Vec<(i32, NaiveDate, i64)> = sqlx::query_as(
        "SELECT slot, due_on, amount_minor FROM insurance_dues WHERE policy_id = $1 AND paid_on IS NOT NULL",
    ).bind(id).fetch_all(&mut *tx).await?;
    if !paid.is_empty() && (carrier != body.carrier_id || client != body.client_id) {
        return Err(ApiError::InsuranceConflict(
            "El cliente y la aseguradora quedan fijos después del primer pago.",
        ));
    }
    if paid
        .iter()
        .any(|(slot, _, _)| *slot > body.installment_count)
    {
        return Err(ApiError::InsuranceConflict(
            "La cantidad de cuotas debe incluir todas las cuotas pagadas.",
        ));
    }
    if paid.iter().any(|(slot, date, amount)| {
        *slot == 0 && (*date != body.renewal_on || *amount != body.renewal_minor)
    }) {
        return Err(ApiError::InsuranceConflict(
            "La renovación pagada conserva su fecha y su monto.",
        ));
    }
    sqlx::query("UPDATE insurance_policies SET carrier_id = $2, client_id = $3, number = $4,
        first_due_on = $5, installment_count = $6, installment_minor = $7, renewal_on = $8, renewal_minor = $9,
        revision = revision + 1 WHERE id = $1")
        .bind(id).bind(body.carrier_id).bind(body.client_id).bind(number).bind(body.first_due_on)
        .bind(body.installment_count).bind(body.installment_minor).bind(body.renewal_on).bind(body.renewal_minor)
        .execute(&mut *tx).await.map_err(write_error)?;
    sync_schedule(&mut tx, id, &planned).await?;
    let saved = detail(&mut tx, company, id).await?;
    tx.commit().await?;
    Ok(Json(saved))
}

async fn lock_policy(
    db: &mut PgConnection,
    company: Uuid,
    id: Uuid,
) -> Result<(i32, Uuid, Uuid), ApiError> {
    sqlx::query_as("SELECT revision, carrier_id, client_id FROM insurance_policies WHERE company_id = $1 AND id = $2 FOR UPDATE")
        .bind(company).bind(id).fetch_optional(db).await?.ok_or(ApiError::RouteNotFound)
}

/// Preserve paid installments by slot. Only altered or removed unpaid dates are superseded.
async fn sync_schedule(
    db: &mut PgConnection,
    id: Uuid,
    planned: &[(i32, NaiveDate, i64)],
) -> Result<(), ApiError> {
    let (slots, dates, amounts): (Vec<_>, Vec<_>, Vec<_>) = planned.iter().copied().collect();
    sqlx::query("UPDATE insurance_dues d SET replaced_at = now()
        WHERE d.policy_id = $1 AND d.paid_on IS NULL AND d.replaced_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM unnest($2::int[], $3::date[], $4::bigint[]) AS p(slot, due_on, amount_minor)
            WHERE (d.slot, d.due_on, d.amount_minor) = (p.slot, p.due_on, p.amount_minor))")
        .bind(id).bind(&slots).bind(&dates).bind(&amounts).execute(&mut *db).await?;
    sqlx::query("INSERT INTO insurance_dues (policy_id, slot, due_on, amount_minor)
        SELECT $1, slot, due_on, amount_minor FROM unnest($2::int[], $3::date[], $4::bigint[]) AS p(slot, due_on, amount_minor)
        ON CONFLICT (policy_id, slot) WHERE replaced_at IS NULL DO NOTHING")
        .bind(id).bind(&slots).bind(&dates).bind(&amounts).execute(db).await?;
    Ok(())
}

#[utoipa::path(put, path = "/api/v1/companies/{company_id}/insurance/policies/{policy_id}/dues/{due_id}/payment", tag = "Insurance",
    security(("bearer_auth" = [])), params(("company_id" = Uuid, Path), ("policy_id" = Uuid, Path), ("due_id" = Uuid, Path)),
    request_body = PaymentWrite, responses((status = 200, body = Due), (status = 401, body = ErrorEnvelope),
    (status = 403, body = ErrorEnvelope), (status = 404, body = ErrorEnvelope),
    (status = 409, body = ErrorEnvelope), (status = 422, body = ErrorEnvelope)))]
async fn pay_due(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
    ApiPath((company, policy, due)): ApiPath<(Uuid, Uuid, Uuid)>,
    ApiJson(body): ApiJson<PaymentWrite>,
) -> Result<Json<Due>, ApiError> {
    authorize(&state, &user, company).await?;
    let mut tx = state.db.begin().await?;
    lock_policy(&mut tx, company, policy).await?;
    let today = sqlx::query_scalar(TODAY_SQL).fetch_one(&mut *tx).await?;
    if !valid_date(body.paid_on) || body.paid_on > today {
        return Err(ApiError::Validation(
            "Ingresa una fecha de pago válida hasta hoy.".into(),
        ));
    }
    let existing: Due = sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "SELECT {DUE_COLUMNS} FROM insurance_dues d WHERE d.policy_id = $1 AND d.id = $2"
    )))
    .bind(policy)
    .bind(due)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or(ApiError::RouteNotFound)?;
    if existing.paid_on == Some(body.paid_on) {
        return Ok(Json(existing));
    }
    if existing.replaced || existing.paid_on.is_some() {
        return Err(ApiError::InsuranceConflict(
            "Este vencimiento ya se pagó o fue reemplazado. Actualiza la póliza.",
        ));
    }
    let updated = sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "UPDATE insurance_dues d SET paid_on = $3, paid_by = $4, recorded_at = now()
        WHERE d.policy_id = $1 AND d.id = $2 RETURNING {DUE_COLUMNS}"
    )))
    .bind(policy)
    .bind(due)
    .bind(body.paid_on)
    .bind(user.id)
    .fetch_one(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Json(updated))
}
