mod dashboard;
mod dto;
mod history;
mod loan_pdf;
mod repository;

use axum::{Extension, Json, extract::State, http::StatusCode};
use sqlx::PgPool;
use utoipa_axum::{router::OpenApiRouter, routes};
use uuid::Uuid;

use self::dto::{
    CasePage, Client, ClientPage, ClientPatch, ClientTimelinePage, ClientWrite, ListCases,
    ListClients, ListTimeline, Operation, OperationPatch, OperationWrite,
};
use crate::{
    app_state::AppState,
    error::{ApiError, ErrorEnvelope},
    extract::{ApiJson, ApiPath, ApiQuery},
    modules::auth::AuthUser,
};

pub fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new()
        .routes(routes!(dashboard::summary))
        .routes(routes!(list_cases))
        .routes(routes!(get_case))
        .routes(routes!(loan_pdf::download))
        .routes(routes!(loan_pdf::download_docx))
        .routes(routes!(list_clients, create_client))
        .routes(routes!(get_client, update_client))
        .routes(routes!(list_timeline))
        .routes(routes!(list_operations, create_operation))
        .routes(routes!(get_operation, update_operation, delete_operation))
}

#[utoipa::path(
    get, path = "/api/v1/expedientes", tag = "Clients", security(("bearer_auth" = [])),
    params(ListCases),
    responses(
        (status = 200, description = "Case files for one company, with their client and vehicle, newest first", body = CasePage),
        (status = 401, body = ErrorEnvelope), (status = 403, body = ErrorEnvelope),
        (status = 404, description = "Company not found or not accessible", body = ErrorEnvelope),
        (status = 422, body = ErrorEnvelope)
    )
)]
async fn list_cases(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
    ApiQuery(query): ApiQuery<ListCases>,
) -> Result<Json<CasePage>, ApiError> {
    if query.q.as_ref().is_some_and(|q| q.contains('\0')) {
        return Err(ApiError::Validation("Valor inválido para q.".to_owned()));
    }
    let allowed: bool = sqlx::query_scalar("SELECT yzy_contracts.has_company_membership($1, $2)")
        .bind(user.id)
        .bind(query.company_id)
        .fetch_one(&state.db)
        .await?;
    if !allowed {
        return Err(ApiError::CompanyNotFound);
    }
    Ok(Json(repository::list_cases(&state.db, &query).await?))
}

#[utoipa::path(
    get, path = "/api/v1/expedientes/{id}", tag = "Clients", security(("bearer_auth" = [])),
    params(("id" = Uuid, Path, description = "Case file UUID")),
    responses(
        (status = 200, description = "Case file", body = Operation),
        (status = 401, body = ErrorEnvelope), (status = 403, body = ErrorEnvelope),
        (status = 404, body = ErrorEnvelope), (status = 422, body = ErrorEnvelope)
    )
)]
async fn get_case(
    State(state): State<AppState>,
    ApiPath(id): ApiPath<Uuid>,
) -> Result<Json<Operation>, ApiError> {
    repository::find_case(&state.db, id)
        .await?
        .map(Json)
        .ok_or(ApiError::ClientOperationNotFound)
}

/// Case-based generation requires the operation's current source and the
/// requested template to be available to this same active company.
pub(super) async fn require_generation_scope(
    db: &PgPool,
    actor: Uuid,
    company: Option<Uuid>,
    operation: Uuid,
    template: Uuid,
) -> Result<(), ApiError> {
    let company = company
        .ok_or_else(|| ApiError::Validation("Selecciona la empresa del expediente.".to_owned()))?;
    if !repository::operation_source_allowed(db, actor, company, operation).await? {
        return Err(ApiError::ClientOperationNotFound);
    }
    if !repository::contract_allowed(db, actor, company, template).await? {
        return Err(ApiError::ContractNotFound);
    }
    Ok(())
}

#[utoipa::path(
    get, path = "/api/v1/clients", tag = "Clients", security(("bearer_auth" = [])),
    params(ListClients),
    responses(
        (status = 200, description = "Global clients, ordered by name", body = ClientPage),
        (status = 401, body = ErrorEnvelope), (status = 403, body = ErrorEnvelope),
        (status = 422, body = ErrorEnvelope)
    )
)]
async fn list_clients(
    State(state): State<AppState>,
    ApiQuery(query): ApiQuery<ListClients>,
) -> Result<Json<ClientPage>, ApiError> {
    if query.q.as_ref().is_some_and(|q| q.contains('\0')) {
        return Err(ApiError::Validation("Valor inválido para q.".to_owned()));
    }
    Ok(Json(repository::list_clients(&state.db, &query).await?))
}

#[utoipa::path(
    post, path = "/api/v1/clients", tag = "Clients", security(("bearer_auth" = [])),
    request_body = ClientWrite,
    responses(
        (status = 201, description = "Registered client", body = Client),
        (status = 401, body = ErrorEnvelope), (status = 403, body = ErrorEnvelope),
        (status = 409, description = "A client with this identification already exists", body = ErrorEnvelope),
        (status = 422, body = ErrorEnvelope)
    )
)]
async fn create_client(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
    ApiJson(body): ApiJson<ClientWrite>,
) -> Result<(StatusCode, Json<Client>), ApiError> {
    let mut body = ClientPatch::from(body);
    body.normalize()?;
    let client = repository::create_client(&state.db, user.id, body).await?;
    Ok((StatusCode::CREATED, Json(client)))
}

#[utoipa::path(
    get, path = "/api/v1/clients/{client_id}", tag = "Clients", security(("bearer_auth" = [])),
    params(("client_id" = Uuid, Path)),
    responses(
        (status = 200, description = "Client record", body = Client),
        (status = 401, body = ErrorEnvelope), (status = 403, body = ErrorEnvelope),
        (status = 404, body = ErrorEnvelope), (status = 422, body = ErrorEnvelope)
    )
)]
async fn get_client(
    State(state): State<AppState>,
    ApiPath(client): ApiPath<Uuid>,
) -> Result<Json<Client>, ApiError> {
    repository::find_client(&state.db, client)
        .await?
        .map(Json)
        .ok_or(ApiError::ClientNotFound)
}

#[utoipa::path(
    get, path = "/api/v1/clients/{client_id}/timeline", tag = "Clients", security(("bearer_auth" = [])),
    params(("client_id" = Uuid, Path), ListTimeline),
    responses(
        (status = 200, description = "Client history across all companies or history for one operation, with linked documents, newest first", body = ClientTimelinePage),
        (status = 401, body = ErrorEnvelope), (status = 403, body = ErrorEnvelope),
        (status = 404, description = "Client or operation not found", body = ErrorEnvelope), (status = 422, body = ErrorEnvelope)
    )
)]
async fn list_timeline(
    State(state): State<AppState>,
    ApiPath(client): ApiPath<Uuid>,
    ApiQuery(query): ApiQuery<ListTimeline>,
) -> Result<Json<ClientTimelinePage>, ApiError> {
    repository::list_timeline(&state.db, client, &query)
        .await?
        .map(Json)
        .ok_or(if query.operation_id.is_some() {
            ApiError::ClientOperationNotFound
        } else {
            ApiError::ClientNotFound
        })
}

#[utoipa::path(
    patch, path = "/api/v1/clients/{client_id}", tag = "Clients", security(("bearer_auth" = [])),
    params(("client_id" = Uuid, Path)), request_body = ClientPatch,
    responses(
        (status = 200, description = "Updated client record", body = Client),
        (status = 401, body = ErrorEnvelope), (status = 403, body = ErrorEnvelope),
        (status = 404, body = ErrorEnvelope), (status = 409, description = "A client with this identification already exists", body = ErrorEnvelope),
        (status = 422, body = ErrorEnvelope)
    )
)]
async fn update_client(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
    ApiPath(client): ApiPath<Uuid>,
    ApiJson(mut body): ApiJson<ClientPatch>,
) -> Result<Json<Client>, ApiError> {
    body.normalize()?;
    repository::update_client(&state.db, user.id, client, body)
        .await?
        .map(Json)
        .ok_or(ApiError::ClientNotFound)
}

#[utoipa::path(
    get, path = "/api/v1/clients/{client_id}/operations", tag = "Clients", security(("bearer_auth" = [])),
    params(("client_id" = Uuid, Path)),
    responses(
        (status = 200, description = "Client case files across all companies, newest first", body = [Operation]),
        (status = 401, body = ErrorEnvelope), (status = 403, body = ErrorEnvelope),
        (status = 404, body = ErrorEnvelope), (status = 422, body = ErrorEnvelope)
    )
)]
async fn list_operations(
    State(state): State<AppState>,
    ApiPath(client): ApiPath<Uuid>,
) -> Result<Json<Vec<Operation>>, ApiError> {
    repository::list_operations(&state.db, client)
        .await?
        .map(Json)
        .ok_or(ApiError::ClientNotFound)
}

#[utoipa::path(
    post, path = "/api/v1/clients/{client_id}/operations", tag = "Clients", security(("bearer_auth" = [])),
    params(("client_id" = Uuid, Path)), request_body = OperationWrite,
    responses(
        (status = 201, description = "Registered case file with an automatically assigned reference when omitted", body = Operation),
        (status = 401, body = ErrorEnvelope), (status = 403, body = ErrorEnvelope),
        (status = 404, body = ErrorEnvelope), (status = 409, body = ErrorEnvelope), (status = 422, body = ErrorEnvelope)
    )
)]
async fn create_operation(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
    ApiPath(client): ApiPath<Uuid>,
    ApiJson(body): ApiJson<OperationWrite>,
) -> Result<(StatusCode, Json<Operation>), ApiError> {
    let company = body.company_id;
    let mut body = OperationPatch::from(body);
    body.normalize()?;
    repository::find_client(&state.db, client)
        .await?
        .ok_or(ApiError::ClientNotFound)?;
    if !repository::active_company(&state.db, company).await? {
        return Err(ApiError::CompanyNotFound);
    }
    let operation = repository::create_operation(&state.db, user.id, company, client, body)
        .await?
        .ok_or(ApiError::ContractNotFound)?;
    Ok((StatusCode::CREATED, Json(operation)))
}

#[utoipa::path(
    get, path = "/api/v1/companies/{company_id}/clients/{client_id}/operations/{operation_id}", tag = "Clients", security(("bearer_auth" = [])),
    params(("company_id" = Uuid, Path), ("client_id" = Uuid, Path), ("operation_id" = Uuid, Path)),
    responses(
        (status = 200, description = "Client case file", body = Operation),
        (status = 401, body = ErrorEnvelope), (status = 403, body = ErrorEnvelope),
        (status = 404, body = ErrorEnvelope), (status = 422, body = ErrorEnvelope)
    )
)]
async fn get_operation(
    State(state): State<AppState>,
    ApiPath((company, client, operation)): ApiPath<(Uuid, Uuid, Uuid)>,
) -> Result<Json<Operation>, ApiError> {
    repository::find_operation(&state.db, company, client, operation)
        .await?
        .map(Json)
        .ok_or(ApiError::ClientOperationNotFound)
}

#[utoipa::path(
    patch, path = "/api/v1/companies/{company_id}/clients/{client_id}/operations/{operation_id}", tag = "Clients", security(("bearer_auth" = [])),
    params(("company_id" = Uuid, Path), ("client_id" = Uuid, Path), ("operation_id" = Uuid, Path)),
    request_body = OperationPatch,
    responses(
        (status = 200, description = "Updated client case file", body = Operation),
        (status = 401, body = ErrorEnvelope), (status = 403, body = ErrorEnvelope),
        (status = 404, body = ErrorEnvelope), (status = 409, body = ErrorEnvelope), (status = 422, body = ErrorEnvelope)
    )
)]
async fn update_operation(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
    ApiPath((company, client, operation)): ApiPath<(Uuid, Uuid, Uuid)>,
    ApiJson(mut body): ApiJson<OperationPatch>,
) -> Result<Json<Operation>, ApiError> {
    body.normalize()?;
    repository::update_operation(&state.db, user.id, company, client, operation, body)
        .await?
        .map(Json)
        .ok_or(ApiError::ClientOperationNotFound)
}

#[utoipa::path(
    delete, path = "/api/v1/companies/{company_id}/clients/{client_id}/operations/{operation_id}", tag = "Clients", security(("bearer_auth" = [])),
    params(("company_id" = Uuid, Path), ("client_id" = Uuid, Path), ("operation_id" = Uuid, Path)),
    responses(
        (status = 204, description = "Case file marked as deleted; it no longer appears in lists or detail views"),
        (status = 401, body = ErrorEnvelope),
        (status = 403, description = "Only the company's billing manager can delete case files", body = ErrorEnvelope),
        (status = 404, body = ErrorEnvelope), (status = 422, body = ErrorEnvelope)
    )
)]
async fn delete_operation(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
    ApiPath((company, client, operation)): ApiPath<(Uuid, Uuid, Uuid)>,
) -> Result<StatusCode, ApiError> {
    repository::find_operation(&state.db, company, client, operation)
        .await?
        .ok_or(ApiError::ClientOperationNotFound)?;
    if !repository::delete_operation(
        &state.db,
        user.id,
        user.superadmin,
        company,
        client,
        operation,
    )
    .await?
    {
        return Err(ApiError::BillingRequired);
    }
    Ok(StatusCode::NO_CONTENT)
}
