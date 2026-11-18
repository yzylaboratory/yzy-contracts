mod dto;
mod repository;
mod token;

use axum::{
    Extension, Json,
    extract::{DefaultBodyLimit, State},
    http::StatusCode,
    middleware,
};
use chrono::{Duration, Utc};
use sqlx::PgPool;
use utoipa_axum::{
    router::{OpenApiRouter, UtoipaMethodRouterExt},
    routes,
};
use uuid::Uuid;

use self::dto::{CheckProspectLink, ConvertedProspect, ProspectLink, ProspectList, SubmitProspect};
use crate::{
    app_state::AppState,
    error::{ApiError, ErrorEnvelope},
    extract::{ApiJson, ApiPath},
    modules::{access, auth::AuthUser},
};

/// How long a shared prospect link stays usable. A single named constant so
/// it is a one-line change if the business ever wants a different window.
const LINK_TTL_HOURS: i64 = 24;
/// Generous for the few short text fields a prospect submits; keeps an
/// unauthenticated caller from sending an oversized body.
const PROSPECT_JSON_LIMIT: usize = 16 * 1024;

pub fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new()
        .routes(routes!(create_link))
        .routes(routes!(list_prospects))
        .routes(routes!(convert_prospect))
}

/// Unauthenticated routes: only token check and submission, both scoped to
/// the company behind the link. No portal session is ever required.
pub fn public_router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new()
        .routes(routes!(check_link).layer(DefaultBodyLimit::max(PROSPECT_JSON_LIMIT)))
        .routes(routes!(submit_prospect).layer(DefaultBodyLimit::max(PROSPECT_JSON_LIMIT)))
        .route_layer(middleware::from_fn(access::no_store))
}

/// Same ownership control as creating a case file: the company must be
/// active and the actor enabled for it.
async fn require_company_scope(db: &PgPool, actor: Uuid, company: Uuid) -> Result<(), ApiError> {
    let allowed: bool = sqlx::query_scalar("SELECT has_company_membership($1, $2)")
        .bind(actor)
        .bind(company)
        .fetch_one(db)
        .await?;
    if allowed {
        Ok(())
    } else {
        Err(ApiError::CompanyNotFound)
    }
}

#[utoipa::path(
    post, path = "/api/v1/companies/{company_id}/prospect-links", tag = "Prospects",
    security(("bearer_auth" = [])),
    params(("company_id" = Uuid, Path, description = "Company UUID")),
    responses(
        (status = 201, description = "One-time link, valid for 24 hours; the token is returned once and never stored or logged", body = ProspectLink),
        (status = 401, body = ErrorEnvelope), (status = 403, body = ErrorEnvelope),
        (status = 404, description = "Company not found or not accessible", body = ErrorEnvelope),
        (status = 422, body = ErrorEnvelope)
    )
)]
async fn create_link(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
    ApiPath(company_id): ApiPath<Uuid>,
) -> Result<(StatusCode, Json<ProspectLink>), ApiError> {
    require_company_scope(&state.db, user.id, company_id).await?;
    let token = token::generate();
    let expires_at = Utc::now() + Duration::hours(LINK_TTL_HOURS);
    repository::create_link(
        &state.db,
        user.id,
        company_id,
        &token::digest(&token),
        expires_at,
    )
    .await?;
    Ok((
        StatusCode::CREATED,
        Json(ProspectLink { token, expires_at }),
    ))
}

#[utoipa::path(
    get, path = "/api/v1/companies/{company_id}/prospects", tag = "Prospects",
    security(("bearer_auth" = [])),
    params(("company_id" = Uuid, Path, description = "Company UUID")),
    responses(
        (status = 200, description = "Prospects self-registered through a link for this company, still pending conversion", body = ProspectList),
        (status = 401, body = ErrorEnvelope), (status = 403, body = ErrorEnvelope),
        (status = 404, description = "Company not found or not accessible", body = ErrorEnvelope),
        (status = 422, body = ErrorEnvelope)
    )
)]
async fn list_prospects(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
    ApiPath(company_id): ApiPath<Uuid>,
) -> Result<Json<ProspectList>, ApiError> {
    require_company_scope(&state.db, user.id, company_id).await?;
    Ok(Json(repository::list(&state.db, company_id).await?))
}

#[utoipa::path(
    post, path = "/api/v1/companies/{company_id}/prospects/{id}/convert", tag = "Prospects",
    security(("bearer_auth" = [])),
    params(("company_id" = Uuid, Path, description = "Company UUID"), ("id" = Uuid, Path, description = "Prospect UUID")),
    responses(
        (status = 200, description = "Converted into a global client with the canonical dedup and audit trail; the pending prospect record is removed", body = ConvertedProspect),
        (status = 401, body = ErrorEnvelope), (status = 403, body = ErrorEnvelope),
        (status = 404, description = "Company or prospect not found, or the prospect does not belong to this company", body = ErrorEnvelope),
        (status = 409, description = "A client with this identification already exists; no client was overwritten", body = ErrorEnvelope),
        (status = 422, body = ErrorEnvelope)
    )
)]
async fn convert_prospect(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
    ApiPath((company_id, id)): ApiPath<(Uuid, Uuid)>,
) -> Result<Json<ConvertedProspect>, ApiError> {
    require_company_scope(&state.db, user.id, company_id).await?;
    let client_id = repository::convert(&state.db, user.id, company_id, id).await?;
    Ok(Json(ConvertedProspect { client_id }))
}

#[utoipa::path(
    post, path = "/api/v1/public/prospect-links/check", tag = "Prospects",
    request_body = CheckProspectLink,
    responses(
        (status = 204, description = "The link is still usable"),
        (status = 404, description = "Unknown, malformed, expired or already used link", body = ErrorEnvelope),
        (status = 413, body = ErrorEnvelope), (status = 422, body = ErrorEnvelope)
    )
)]
async fn check_link(
    State(state): State<AppState>,
    ApiJson(body): ApiJson<CheckProspectLink>,
) -> Result<StatusCode, ApiError> {
    if !token::is_well_formed(&body.token) {
        return Err(ApiError::ProspectLinkUnavailable);
    }
    if repository::link_is_active(&state.db, &token::digest(&body.token)).await? {
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err(ApiError::ProspectLinkUnavailable)
    }
}

#[utoipa::path(
    post, path = "/api/v1/public/prospect-links/submit", tag = "Prospects",
    request_body = SubmitProspect,
    responses(
        (status = 204, description = "Submission recorded for the company behind the link"),
        (status = 404, description = "Unknown, malformed, expired or already used link", body = ErrorEnvelope),
        (status = 413, body = ErrorEnvelope), (status = 422, body = ErrorEnvelope)
    )
)]
async fn submit_prospect(
    State(state): State<AppState>,
    ApiJson(body): ApiJson<SubmitProspect>,
) -> Result<StatusCode, ApiError> {
    if !token::is_well_formed(&body.token) {
        return Err(ApiError::ProspectLinkUnavailable);
    }
    let token_hash = token::digest(&body.token);
    let data = body.normalize()?;
    if repository::submit(&state.db, &token_hash, data).await? {
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err(ApiError::ProspectLinkUnavailable)
    }
}
