mod repository;

use std::collections::BTreeMap;

use axum::{
    Extension, Json,
    extract::{DefaultBodyLimit, Request, State},
    http::{HeaderValue, StatusCode, header},
    middleware::{self, Next},
    response::{IntoResponse, Response},
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
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
    extract::{ApiJson, ApiPath, ApiQuery},
    modules::{admin_pagination::PageQuery, auth::AuthUser},
};

const LEGAL_NAME: &str = "empresa_razon_social";
const LEGAL_NAME_ALIAS: &str = "empresa_nombre";
const MAX_VALUES: usize = 100;
const MAX_VALUE_CHARACTERS: usize = 1000;
const MAX_VALUES_BYTES: usize = 64 * 1024;
/// Space for JSON escaping, separators, names and the snapshot UUID.
pub(super) const COMPANY_JSON_LIMIT: usize = MAX_VALUES_BYTES * 6 + 16 * 1024;

type CompanyValues = BTreeMap<String, String>;

#[derive(Debug, Deserialize, Serialize, ToSchema, sqlx::FromRow)]
struct Company {
    id: Uuid,
    /// Internal name shown in the company selector.
    name: String,
    /// Saved Word variables plus the derived read-only alias empresa_nombre.
    #[sqlx(rename = "variable_values", json)]
    values: BTreeMap<String, String>,
    is_default: bool,
    /// Whether the signed-in user can modify this company profile.
    can_manage: bool,
    archived_at: Option<DateTime<Utc>>,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}

impl Company {
    fn with_alias(mut self) -> Self {
        if let Some(name) = self.values.get(LEGAL_NAME).cloned() {
            self.values.insert(LEGAL_NAME_ALIAS.to_owned(), name);
        }
        self
    }
}

#[derive(Debug, Deserialize, Validate, ToSchema)]
#[serde(deny_unknown_fields)]
struct SaveCompany {
    #[validate(length(min = 1, max = 200))]
    name: String,
    /// Word variables with the empresa_ prefix. Requires empresa_razon_social.
    /// empresa_nombre is derived by the API and is excluded from writes.
    values: BTreeMap<String, String>,
}

impl SaveCompany {
    fn checked_name(&self) -> Result<&str, ApiError> {
        let name = self.name.trim();
        if !valid_name(name) {
            return Err(ApiError::Validation("Invalid value for: name".to_owned()));
        }
        if self.values.contains_key(LEGAL_NAME_ALIAS)
            || self
                .values
                .get(LEGAL_NAME)
                .is_none_or(|value| value.trim().is_empty())
            || !valid_values(&self.values)
        {
            return Err(ApiError::Validation("Invalid value for: values".to_owned()));
        }
        Ok(name)
    }
}

/// Values actually used for a document, including any overrides in its form.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub(super) struct CompanySnapshot {
    pub id: Uuid,
    pub name: String,
    pub values: BTreeMap<String, String>,
}

impl CompanySnapshot {
    pub(super) fn validate(&self) -> Result<(), ApiError> {
        if !valid_name(&self.name) || !valid_values(&self.values) {
            return Err(ApiError::Validation(
                "Invalid value for: company".to_owned(),
            ));
        }
        Ok(())
    }
}

fn valid_name(value: &str) -> bool {
    !value.trim().is_empty() && value.chars().count() <= 200 && !value.chars().any(char::is_control)
}

fn valid_values(values: &CompanyValues) -> bool {
    values.len() <= MAX_VALUES
        && values.iter().all(|(key, value)| {
            key.len() <= 64
                && key.strip_prefix("empresa_").is_some_and(|suffix| {
                    !suffix.is_empty()
                        && suffix.bytes().all(|byte| {
                            byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_'
                        })
                })
                && value.chars().count() <= MAX_VALUE_CHARACTERS
                && !value.chars().any(|character| {
                    matches!(character as u32, 0..=8 | 11 | 12 | 14..=31 | 0xfffe | 0xffff)
                })
        })
        && values
            .iter()
            .map(|(key, value)| key.len() + value.len())
            .sum::<usize>()
            <= MAX_VALUES_BYTES
}

#[derive(Debug, Default, Deserialize, Validate, IntoParams)]
#[serde(deny_unknown_fields)]
#[into_params(parameter_in = Query)]
struct ListCompanies {
    /// Include archived company profiles.
    #[serde(default)]
    include_archived: bool,
}

#[derive(Serialize, ToSchema)]
pub(super) struct CompanyList {
    items: Vec<Company>,
}

#[derive(Deserialize, Validate, IntoParams)]
#[into_params(parameter_in = Query)]
pub(super) struct AdminCompanyFilter {
    archived: Option<bool>,
}

#[derive(Serialize, ToSchema)]
pub(super) struct AdminCompanyPage {
    items: Vec<Company>,
    page: i64,
    per_page: i64,
    total: i64,
}

pub fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new()
        .routes(
            routes!(list_companies, create_company)
                .layer(DefaultBodyLimit::max(COMPANY_JSON_LIMIT)),
        )
        .routes(
            routes!(get_company, update_company, delete_company)
                .layer(DefaultBodyLimit::max(COMPANY_JSON_LIMIT)),
        )
        .routes(routes!(set_default))
        .routes(routes!(archive_company))
        .routes(routes!(restore_company))
        .route_layer(middleware::from_fn(no_store))
}

async fn no_store(request: Request, next: Next) -> Response {
    let mut response = next.run(request).await;
    response.headers_mut().insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("private, no-store"),
    );
    response
}

#[utoipa::path(
    get, path = "/api/v1/companies", tag = "Companies", security(("bearer_auth" = [])),
    params(ListCompanies),
    responses(
        (status = 200, description = "Company profiles for this account", body = CompanyList),
        (status = 401, description = "Missing or invalid token", body = ErrorEnvelope),
        (status = 422, description = "Invalid list parameters", body = ErrorEnvelope),
    )
)]
async fn list_companies(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
    ApiQuery(query): ApiQuery<ListCompanies>,
) -> Result<Json<CompanyList>, ApiError> {
    let items = repository::list(&state.db, user.id, query.include_archived, user.superadmin)
        .await?
        .into_iter()
        .map(Company::with_alias)
        .collect();
    Ok(Json(CompanyList { items }))
}

#[utoipa::path(
    get, path = "/api/v1/admin/companies", tag = "Administration", security(("bearer_auth" = [])),
    params(PageQuery, AdminCompanyFilter),
    responses(
        (status = 200, description = "Company profiles and pagination metadata", body = AdminCompanyPage),
        (status = 403, description = "Superadministrator access required", body = ErrorEnvelope),
    )
)]
pub(super) async fn admin_companies(
    State(state): State<AppState>,
    ApiQuery(page): ApiQuery<PageQuery>,
    ApiQuery(filter): ApiQuery<AdminCompanyFilter>,
) -> Result<Json<AdminCompanyPage>, ApiError> {
    use sqlx::types::Json as DbJson;
    let (total, DbJson(items)): (i64, DbJson<Vec<Company>>) = sqlx::query_as(
        "WITH matching AS (
            SELECT id, name, variable_values AS values, is_default, true AS can_manage,
                archived_at, created_at, updated_at
            FROM companies
            WHERE $1::boolean IS NULL OR (archived_at IS NOT NULL) = $1
         ), paged AS (
            SELECT * FROM matching ORDER BY archived_at IS NOT NULL, is_default DESC, lower(name), id
            LIMIT $2 OFFSET $3
         )
         SELECT (SELECT count(*) FROM matching),
            COALESCE(jsonb_agg(paged ORDER BY archived_at IS NOT NULL, is_default DESC, lower(name), id), '[]'::jsonb)
         FROM paged",
    )
    .bind(filter.archived)
    .bind(page.limit())
    .bind(page.offset())
    .fetch_one(&state.db)
    .await?;
    Ok(Json(AdminCompanyPage {
        items: items.into_iter().map(Company::with_alias).collect(),
        page: page.number(),
        per_page: page.limit().unwrap_or(total.max(1)),
        total,
    }))
}

#[utoipa::path(
    post, path = "/api/v1/companies", tag = "Companies", security(("bearer_auth" = [])),
    request_body = SaveCompany,
    responses(
        (status = 201, description = "Company created with its dedicated billing account", body = Company),
        (status = 401, description = "Missing or invalid token", body = ErrorEnvelope),
        (status = 403, description = "Superadministrator access required", body = ErrorEnvelope),
        (status = 413, description = "The request exceeds the body size limit", body = ErrorEnvelope),
        (status = 422, description = "Invalid company data", body = ErrorEnvelope),
    )
)]
async fn create_company(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
    ApiJson(body): ApiJson<SaveCompany>,
) -> Result<impl IntoResponse, ApiError> {
    if !user.superadmin {
        return Err(ApiError::AdminRequired);
    }
    let name = body.checked_name()?;
    let company = repository::create(&state.db, &user, name, &body.values).await?;
    Ok((StatusCode::CREATED, Json(company.with_alias())))
}

#[utoipa::path(
    get, path = "/api/v1/companies/{id}", tag = "Companies", security(("bearer_auth" = [])),
    params(("id" = Uuid, Path, description = "Company UUID")),
    responses(
        (status = 200, description = "Company profile", body = Company),
        (status = 401, description = "Missing or invalid token", body = ErrorEnvelope),
        (status = 404, description = "Company not found in this account", body = ErrorEnvelope),
        (status = 422, description = "Invalid company identifier", body = ErrorEnvelope),
    )
)]
async fn get_company(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
    ApiPath(id): ApiPath<Uuid>,
) -> Result<Json<Company>, ApiError> {
    Ok(Json(
        repository::find_for_reader(&state.db, &user, id)
            .await?
            .with_alias(),
    ))
}

#[utoipa::path(
    put, path = "/api/v1/companies/{id}", tag = "Companies", security(("bearer_auth" = [])),
    params(("id" = Uuid, Path, description = "Company UUID")),
    request_body = SaveCompany,
    responses(
        (status = 200, description = "Company updated", body = Company),
        (status = 401, description = "Missing or invalid token", body = ErrorEnvelope),
        (status = 403, description = "Company billing manager or superadministrator required", body = ErrorEnvelope),
        (status = 404, description = "Company not found in this account", body = ErrorEnvelope),
        (status = 409, description = "Company is archived", body = ErrorEnvelope),
        (status = 413, description = "The request exceeds the body size limit", body = ErrorEnvelope),
        (status = 422, description = "Invalid company identifier or data", body = ErrorEnvelope),
    )
)]
async fn update_company(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
    ApiPath(id): ApiPath<Uuid>,
    ApiJson(body): ApiJson<SaveCompany>,
) -> Result<Json<Company>, ApiError> {
    let name = body.checked_name()?;
    let company = repository::update(&state.db, &user, id, name, &body.values).await?;
    Ok(Json(company.with_alias()))
}

#[utoipa::path(
    post, path = "/api/v1/companies/{id}/default", tag = "Companies", security(("bearer_auth" = [])),
    params(("id" = Uuid, Path, description = "Company UUID")),
    responses(
        (status = 200, description = "Default company for this account", body = Company),
        (status = 401, description = "Missing or invalid token", body = ErrorEnvelope),
        (status = 404, description = "Company not found in this account", body = ErrorEnvelope),
        (status = 409, description = "Company is archived", body = ErrorEnvelope),
        (status = 422, description = "Invalid company identifier", body = ErrorEnvelope),
    )
)]
async fn set_default(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
    ApiPath(id): ApiPath<Uuid>,
) -> Result<Json<Company>, ApiError> {
    if !user.superadmin {
        return Err(ApiError::AdminRequired);
    }
    let company = repository::set_default(&state.db, &user, id).await?;
    Ok(Json(company.with_alias()))
}

#[utoipa::path(
    post, path = "/api/v1/companies/{id}/archive", tag = "Companies", security(("bearer_auth" = [])),
    params(("id" = Uuid, Path, description = "Company UUID")),
    responses(
        (status = 200, description = "Archived company", body = Company),
        (status = 401, description = "Missing or invalid token", body = ErrorEnvelope),
        (status = 403, description = "Superadministrator access required", body = ErrorEnvelope),
        (status = 404, description = "Company not found in this account", body = ErrorEnvelope),
        (status = 422, description = "Invalid company identifier", body = ErrorEnvelope),
    )
)]
async fn archive_company(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
    ApiPath(id): ApiPath<Uuid>,
) -> Result<Json<Company>, ApiError> {
    if !user.superadmin {
        return Err(ApiError::AdminRequired);
    }
    let company = repository::archive(&state.db, &user, id).await?;
    Ok(Json(company.with_alias()))
}

#[utoipa::path(
    post, path = "/api/v1/companies/{id}/restore", tag = "Companies", security(("bearer_auth" = [])),
    params(("id" = Uuid, Path, description = "Company UUID")),
    responses(
        (status = 200, description = "Restored company", body = Company),
        (status = 401, description = "Missing or invalid token", body = ErrorEnvelope),
        (status = 403, description = "Superadministrator access required", body = ErrorEnvelope),
        (status = 404, description = "Company not found in this account", body = ErrorEnvelope),
        (status = 422, description = "Invalid company identifier", body = ErrorEnvelope),
    )
)]
async fn restore_company(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
    ApiPath(id): ApiPath<Uuid>,
) -> Result<Json<Company>, ApiError> {
    if !user.superadmin {
        return Err(ApiError::AdminRequired);
    }
    let company = repository::restore(&state.db, &user, id).await?;
    Ok(Json(company.with_alias()))
}

#[utoipa::path(
    delete, path = "/api/v1/companies/{id}", tag = "Companies", security(("bearer_auth" = [])),
    params(("id" = Uuid, Path, description = "Company UUID")),
    responses(
        (status = 204, description = "Company deleted"),
        (status = 401, description = "Missing or invalid token", body = ErrorEnvelope),
        (status = 403, description = "Superadministrator access required", body = ErrorEnvelope),
        (status = 404, description = "Company not found", body = ErrorEnvelope),
        (status = 409, description = "Company is not archived or still has templates, cases or billing", body = ErrorEnvelope),
        (status = 422, description = "Invalid company identifier", body = ErrorEnvelope),
    )
)]
async fn delete_company(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
    ApiPath(id): ApiPath<Uuid>,
) -> Result<StatusCode, ApiError> {
    if !user.superadmin {
        return Err(ApiError::AdminRequired);
    }
    repository::delete(&state.db, &user, id).await?;
    Ok(StatusCode::NO_CONTENT)
}
