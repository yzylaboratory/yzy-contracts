pub mod dto;
pub(super) mod repository;

use axum::{Extension, Json, extract::State, http::StatusCode};
use serde::Deserialize;
use sqlx::{PgExecutor, PgPool};
use utoipa::IntoParams;
use utoipa_axum::{router::OpenApiRouter, routes};
use uuid::Uuid;
use validator::Validate;

use crate::{
    app_state::AppState,
    error::{ApiError, ErrorEnvelope},
    extract::{ApiJson, ApiPath, ApiQuery},
    modules::{admin_pagination::PageQuery, auth::AuthUser, clients, contracts},
};
use dto::{
    AccountInput, BankAccount, BankAccountInput, BankAccountSettings, BillingAccount,
    BillingAccountList, BillingInvoice, BillingInvoiceList, BillingOverview, CreateAccount,
    TransferInput, VerificationDecision, VerificationInput,
};

pub fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new()
        .routes(routes!(overview))
        .routes(routes!(prepare_renewal))
        .routes(routes!(report_transfer))
}

async fn managed_account_ids(
    executor: impl PgExecutor<'_>,
    user: &AuthUser,
) -> Result<Vec<Uuid>, ApiError> {
    let ids =
        repository::managed_account_ids(executor, (!user.superadmin).then_some(user.id)).await?;
    if ids.is_empty() && !user.superadmin {
        return Err(ApiError::BillingRequired);
    }
    Ok(ids)
}

pub fn admin_router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new()
        .routes(routes!(admin_accounts, create_account))
        .routes(routes!(admin_bank_account, save_admin_bank_account))
        .routes(routes!(update_account))
        .routes(routes!(admin_invoices))
        .routes(routes!(verify_transfer))
}

async fn bank_account_settings(
    executor: impl PgExecutor<'_>,
    fallback: Option<&BankAccount>,
) -> Result<BankAccountSettings, ApiError> {
    Ok(repository::bank_destination(executor)
        .await?
        .unwrap_or_else(|| BankAccountSettings {
            bank_account: fallback.cloned(),
            revision: None,
            updated_at: None,
        }))
}

#[utoipa::path(
    get, path = "/api/v1/billing", tag = "Billing", security(("bearer_auth" = [])),
    responses(
        (status = 200, description = "Assigned billing accounts, invoices and optional bank details", body = BillingOverview),
        (status = 401, description = "Missing or invalid token", body = ErrorEnvelope),
        (status = 403, description = "Billing manager access required", body = ErrorEnvelope)
    )
)]
async fn overview(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
) -> Result<Json<BillingOverview>, ApiError> {
    let mut tx = state.db.begin().await?;
    repository::lock_assignments(&mut tx).await?;
    let ids = managed_account_ids(&mut *tx, &user).await?;
    repository::issue_invoices(&mut *tx, Some(&ids), None).await?;
    let accounts = repository::accounts(&mut *tx, Some(&ids)).await?;
    let invoices = repository::invoices(&mut *tx, Some(&ids), None).await?;
    let bank_account = bank_account_settings(&mut *tx, state.config.billing_bank_account.as_ref())
        .await?
        .bank_account;
    tx.commit().await?;
    Ok(Json(BillingOverview {
        accounts,
        invoices,
        bank_account,
    }))
}

#[utoipa::path(
    get, path = "/api/v1/admin/billing/bank-account", tag = "Billing", security(("bearer_auth" = [])),
    responses(
        (status = 200, description = "Effective transfer destination and current revision", body = BankAccountSettings),
        (status = 401, description = "Missing or invalid token", body = ErrorEnvelope),
        (status = 403, description = "Administrator access required", body = ErrorEnvelope)
    )
)]
async fn admin_bank_account(
    State(state): State<AppState>,
) -> Result<Json<BankAccountSettings>, ApiError> {
    Ok(Json(
        bank_account_settings(&state.db, state.config.billing_bank_account.as_ref()).await?,
    ))
}

#[utoipa::path(
    put, path = "/api/v1/admin/billing/bank-account", tag = "Billing", security(("bearer_auth" = [])),
    request_body = BankAccountInput,
    responses(
        (status = 200, description = "Transfer destination saved", body = BankAccountSettings),
        (status = 401, description = "Missing or invalid token", body = ErrorEnvelope),
        (status = 403, description = "Administrator access required", body = ErrorEnvelope),
        (status = 409, description = "The transfer destination revision has changed", body = ErrorEnvelope),
        (status = 422, description = "Invalid bank account details", body = ErrorEnvelope)
    )
)]
async fn save_admin_bank_account(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
    ApiJson(input): ApiJson<BankAccountInput>,
) -> Result<Json<BankAccountSettings>, ApiError> {
    if [
        &input.bank_name,
        &input.account_holder,
        &input.account_type,
        &input.account_number,
    ]
    .iter()
    .any(|field| field.trim().is_empty() || field.chars().any(char::is_control))
    {
        return Err(ApiError::Validation(
            "Completa los datos de la cuenta bancaria con texto válido.".to_owned(),
        ));
    }
    let account = BankAccount {
        bank_name: input.bank_name.trim().to_owned(),
        account_holder: input.account_holder.trim().to_owned(),
        account_type: input.account_type.trim().to_owned(),
        account_number: input.account_number.trim().to_owned(),
    };
    Ok(Json(
        repository::save_bank_destination(&state.db, user.id, account, input.expected_revision)
            .await?,
    ))
}

#[utoipa::path(
    put, path = "/api/v1/billing/invoices/{id}/transfer", tag = "Billing", security(("bearer_auth" = [])),
    params(("id" = Uuid, Path, description = "Invoice ID")), request_body = TransferInput,
    responses(
        (status = 200, description = "Bank transfer reported for manual review", body = BillingInvoice),
        (status = 401, description = "Missing or invalid token", body = ErrorEnvelope),
        (status = 403, description = "Billing manager access required", body = ErrorEnvelope),
        (status = 404, description = "Invoice not found in an assigned account", body = ErrorEnvelope),
        (status = 409, description = "Invoice already has a different transfer", body = ErrorEnvelope),
        (status = 422, description = "Invalid transfer reference", body = ErrorEnvelope)
    )
)]
async fn report_transfer(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
    ApiPath(id): ApiPath<Uuid>,
    ApiJson(input): ApiJson<TransferInput>,
) -> Result<Json<BillingInvoice>, ApiError> {
    let reference = input.reference.trim();
    if reference.is_empty() {
        return Err(ApiError::Validation(
            "Escribe la referencia de la transferencia.".to_owned(),
        ));
    }
    let mut tx = state.db.begin().await?;
    repository::lock_assignments(&mut tx).await?;
    let ids = managed_account_ids(&mut *tx, &user).await?;
    repository::lock_invoice(&mut tx, id, Some(&ids)).await?;
    repository::report_transfer(
        &mut tx,
        id,
        user.id,
        reference,
        input.months.unwrap_or(1),
        input.expected_total_minor,
    )
    .await?;
    let invoice = repository::invoices(&mut *tx, Some(&ids), Some(id))
        .await?
        .pop()
        .ok_or(ApiError::BillingNotFound)?;
    tx.commit().await?;
    Ok(Json(invoice))
}

#[utoipa::path(
    post, path = "/api/v1/billing/accounts/{id}/renewal-invoice", tag = "Billing", security(( "bearer_auth" = [])),
    params(("id" = Uuid, Path, description = "Billing account ID")),
    responses(
        (status = 200, description = "First unpaid invoice for the renewal", body = BillingInvoice),
        (status = 401, description = "Missing or invalid token", body = ErrorEnvelope),
        (status = 403, description = "Billing manager access required", body = ErrorEnvelope),
        (status = 404, description = "Billing account not assigned to the manager", body = ErrorEnvelope),
        (status = 409, description = "Renewal currently unavailable", body = ErrorEnvelope)
    )
)]
async fn prepare_renewal(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
    ApiPath(id): ApiPath<Uuid>,
) -> Result<Json<BillingInvoice>, ApiError> {
    let mut tx = state.db.begin().await?;
    repository::lock_assignments(&mut tx).await?;
    let ids = managed_account_ids(&mut *tx, &user).await?;
    if !ids.contains(&id) {
        return Err(ApiError::BillingNotFound);
    }
    if bank_account_settings(&mut *tx, state.config.billing_bank_account.as_ref())
        .await?
        .bank_account
        .is_none()
    {
        return Err(ApiError::BillingBankRequired);
    }
    let invoice = repository::prepare_renewal(&mut tx, id).await?;
    tx.commit().await?;
    Ok(Json(invoice))
}

#[utoipa::path(
    get, path = "/api/v1/admin/billing/accounts", tag = "Billing", security(("bearer_auth" = [])),
    params(PageQuery),
    responses(
        (status = 200, description = "Billing accounts", body = BillingAccountList),
        (status = 401, description = "Missing or invalid token", body = ErrorEnvelope),
        (status = 403, description = "Administrator access required", body = ErrorEnvelope)
    )
)]
async fn admin_accounts(
    State(state): State<AppState>,
    ApiQuery(page): ApiQuery<PageQuery>,
) -> Result<Json<BillingAccountList>, ApiError> {
    let (total, items) = repository::accounts_page(&state.db, &page).await?;
    Ok(Json(BillingAccountList {
        items,
        page: page.number(),
        per_page: page.limit().unwrap_or(total.max(1)),
        total,
    }))
}

#[utoipa::path(
    post, path = "/api/v1/admin/billing/accounts", tag = "Billing", security(("bearer_auth" = [])),
    request_body = CreateAccount,
    responses(
        (status = 201, description = "Legacy billing account created for companies without a dedicated account", body = BillingAccount),
        (status = 401, description = "Missing or invalid token", body = ErrorEnvelope),
        (status = 403, description = "Administrator access required", body = ErrorEnvelope),
        (status = 404, description = "Company not found", body = ErrorEnvelope),
        (status = 409, description = "The bank account is missing or a company already has a billing account for this period", body = ErrorEnvelope),
        (status = 422, description = "Invalid account details or manager", body = ErrorEnvelope)
    )
)]
async fn create_account(
    State(state): State<AppState>,
    ApiJson(input): ApiJson<CreateAccount>,
) -> Result<(StatusCode, Json<BillingAccount>), ApiError> {
    if bank_account_settings(&state.db, state.config.billing_bank_account.as_ref())
        .await?
        .bank_account
        .is_none()
    {
        return Err(ApiError::BillingBankRequired);
    }
    let account = repository::save_account(&state.db, None, input.account, input.starts_on).await?;
    Ok((StatusCode::CREATED, Json(account)))
}

#[utoipa::path(
    put, path = "/api/v1/admin/billing/accounts/{id}", tag = "Billing", security(("bearer_auth" = [])),
    params(("id" = Uuid, Path, description = "Billing account ID")), request_body = AccountInput,
    responses(
        (status = 200, description = "Billing account updated", body = BillingAccount),
        (status = 401, description = "Missing or invalid token", body = ErrorEnvelope),
        (status = 403, description = "Administrator access required", body = ErrorEnvelope),
        (status = 404, description = "Billing account or company not found", body = ErrorEnvelope),
        (status = 409, description = "A company already has a billing account for this period", body = ErrorEnvelope),
        (status = 422, description = "Invalid account details or manager", body = ErrorEnvelope)
    )
)]
async fn update_account(
    State(state): State<AppState>,
    ApiPath(id): ApiPath<Uuid>,
    ApiJson(input): ApiJson<AccountInput>,
) -> Result<Json<BillingAccount>, ApiError> {
    Ok(Json(
        repository::save_account(&state.db, Some(id), input, None).await?,
    ))
}

#[derive(Deserialize, Validate, IntoParams)]
#[into_params(parameter_in = Query)]
struct AdminInvoiceFilter {
    in_review: Option<bool>,
}

#[utoipa::path(
    get, path = "/api/v1/admin/billing/invoices", tag = "Billing", security(("bearer_auth" = [])),
    params(PageQuery, AdminInvoiceFilter),
    responses(
        (status = 200, description = "Invoices across billing accounts", body = BillingInvoiceList),
        (status = 401, description = "Missing or invalid token", body = ErrorEnvelope),
        (status = 403, description = "Administrator access required", body = ErrorEnvelope)
    )
)]
async fn admin_invoices(
    State(state): State<AppState>,
    ApiQuery(page): ApiQuery<PageQuery>,
    ApiQuery(filter): ApiQuery<AdminInvoiceFilter>,
) -> Result<Json<BillingInvoiceList>, ApiError> {
    let mut tx = state.db.begin().await?;
    repository::lock_assignments(&mut tx).await?;
    repository::issue_invoices(&mut *tx, None, None).await?;
    let (total, items) = repository::invoices_page(&mut *tx, &page, filter.in_review).await?;
    tx.commit().await?;
    Ok(Json(BillingInvoiceList {
        items,
        page: page.number(),
        per_page: page.limit().unwrap_or(total.max(1)),
        total,
    }))
}

#[utoipa::path(
    put, path = "/api/v1/admin/billing/invoices/{id}/verification", tag = "Billing", security(("bearer_auth" = [])),
    params(("id" = Uuid, Path, description = "Invoice ID")), request_body = VerificationInput,
    responses(
        (status = 200, description = "Reported transfer confirmed or rejected", body = BillingInvoice),
        (status = 401, description = "Missing or invalid token", body = ErrorEnvelope),
        (status = 403, description = "Administrator access required", body = ErrorEnvelope),
        (status = 404, description = "Invoice or report not found", body = ErrorEnvelope),
        (status = 409, description = "The report was already reviewed with another decision", body = ErrorEnvelope),
        (status = 422, description = "Invalid decision", body = ErrorEnvelope)
    )
)]
async fn verify_transfer(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
    ApiPath(id): ApiPath<Uuid>,
    ApiJson(input): ApiJson<VerificationInput>,
) -> Result<Json<BillingInvoice>, ApiError> {
    let mut tx = state.db.begin().await?;
    repository::lock_assignments(&mut tx).await?;
    repository::lock_invoice(&mut tx, id, None).await?;
    repository::verify_transfer(
        &mut tx,
        id,
        input.report_id,
        user.id,
        matches!(input.decision, VerificationDecision::Confirm),
    )
    .await?;
    let invoice = repository::invoices(&mut *tx, None, Some(id))
        .await?
        .pop()
        .ok_or(ApiError::BillingNotFound)?;
    tx.commit().await?;
    Ok(Json(invoice))
}

#[derive(Deserialize, IntoParams, Validate)]
#[into_params(parameter_in = Query)]
pub struct GenerationScope {
    pub company_id: Option<Uuid>,
    /// Registered client operation. Requires the company_id of the operation.
    pub operation_id: Option<Uuid>,
}

/// Resolve the requested company against the contract and operation scope.
pub async fn require_generation_access(
    db: &PgPool,
    owner: Uuid,
    contract_id: Uuid,
    selected_company: Option<Uuid>,
    operation: Option<Uuid>,
) -> Result<(), ApiError> {
    if let Some(operation) = operation {
        clients::require_generation_scope(db, owner, selected_company, operation, contract_id)
            .await?;
    }
    let source = contracts::repository::scope_for_reader(db, owner, contract_id)
        .await?
        .ok_or(ApiError::ContractNotFound)?;
    check_generation_scope(db, owner, source, selected_company).await
}

async fn check_generation_scope(
    db: &PgPool,
    owner: Uuid,
    source: contracts::repository::StoredContractScope,
    selected_company: Option<Uuid>,
) -> Result<(), ApiError> {
    let company = selected_company.or(source.company_id);
    if let Some(company) = company {
        require_company_membership(db, owner, company).await?;
    }
    if source
        .company_id
        .is_some_and(|fixed| Some(fixed) != company)
        || source
            .shared_company_ids
            .as_ref()
            .is_some_and(|scope| company.is_none_or(|id| !scope.contains(&id)))
    {
        return Err(ApiError::Validation(
            "Selecciona una empresa autorizada para este contrato.".to_owned(),
        ));
    }
    Ok(())
}

async fn require_company_membership(
    db: &PgPool,
    owner: Uuid,
    company: Uuid,
) -> Result<(), ApiError> {
    let allowed: bool = sqlx::query_scalar("SELECT yzy_contracts.has_company_membership($1, $2)")
        .bind(owner)
        .bind(company)
        .fetch_one(db)
        .await?;
    if !allowed {
        return Err(ApiError::CompanyNotFound);
    }
    Ok(())
}

pub async fn require_legacy_import_access(
    db: &PgPool,
    owner: Uuid,
    contract_id: Uuid,
    selected_company: Option<Uuid>,
) -> Result<(), ApiError> {
    if let Some(source) = contracts::repository::scope_for_reader(db, owner, contract_id).await? {
        // The readable source already confirms at least one active company.
        if selected_company.is_none() && source.shared_company_ids.is_some() {
            return Ok(());
        }
        return check_generation_scope(db, owner, source, selected_company).await;
    }
    if let Some(company) = selected_company {
        require_company_membership(db, owner, company).await?;
    }
    Ok(())
}

#[utoipa::path(
    get, path = "/api/v1/contracts/{id}/generation-access", tag = "Contracts", security(("bearer_auth" = [])),
    params(("id" = Uuid, Path, description = "Contract ID"), GenerationScope),
    responses(
        (status = 204, description = "The caller can generate a document in this scope"),
        (status = 401, description = "Missing or invalid token", body = ErrorEnvelope),
        (status = 403, description = "Company access required", body = ErrorEnvelope),
        (status = 404, description = "Contract, operation or company not found", body = ErrorEnvelope),
        (status = 422, description = "The contract requires a permitted company selection", body = ErrorEnvelope)
    )
)]
pub async fn generation_access(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
    ApiPath(id): ApiPath<Uuid>,
    ApiQuery(scope): ApiQuery<GenerationScope>,
) -> Result<StatusCode, ApiError> {
    require_generation_access(&state.db, user.id, id, scope.company_id, scope.operation_id).await?;
    Ok(StatusCode::NO_CONTENT)
}
