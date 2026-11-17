use sqlx::{PgExecutor, PgPool, Postgres, Transaction, types::Json};
use uuid::Uuid;

use super::{Company, CompanyValues};
use crate::{
    error::ApiError,
    modules::{auth::AuthUser, billing::repository as billing},
};

pub(super) async fn list(
    db: &PgPool,
    user_id: Uuid,
    include_archived: bool,
    superadmin: bool,
) -> Result<Vec<Company>, sqlx::Error> {
    // Enabled people read every active company; only the superadministrator manages or sees archived ones.
    sqlx::query_as(
        "SELECT c.id, c.name, c.variable_values,
                c.is_default AND $3 AS is_default,
                ($3 OR c.id IN (SELECT yzy_contracts.billing_companies_for($1))) AS can_manage,
                c.archived_at, c.created_at, c.updated_at
         FROM yzy_contracts.companies c
         WHERE (($2 AND $3) OR c.archived_at IS NULL)
         ORDER BY c.archived_at IS NOT NULL, c.is_default DESC, lower(c.name), c.id",
    )
    .bind(user_id)
    .bind(include_archived)
    .bind(superadmin)
    .fetch_all(db)
    .await
}

pub(super) async fn find_for_reader(
    db: impl PgExecutor<'_>,
    user: &AuthUser,
    id: Uuid,
) -> Result<Company, ApiError> {
    sqlx::query_as(
        "SELECT c.id, c.name, c.variable_values,
                c.is_default AND $3 AS is_default,
                ($3 OR c.id IN (SELECT yzy_contracts.billing_companies_for($1))) AS can_manage,
                c.archived_at, c.created_at, c.updated_at
         FROM yzy_contracts.companies c
         WHERE c.id = $2 AND ($3 OR c.archived_at IS NULL)",
    )
    .bind(user.id)
    .bind(id)
    .bind(user.superadmin)
    .fetch_optional(db)
    .await?
    .ok_or(ApiError::CompanyNotFound)
}

async fn managing_owner<'e>(
    db: impl PgExecutor<'e>,
    user: &AuthUser,
    id: Uuid,
) -> Result<Uuid, ApiError> {
    sqlx::query_scalar(
        "SELECT c.owner_id FROM yzy_contracts.companies c WHERE c.id = $2
         AND $3 AND $1::uuid IS NOT NULL",
    )
    .bind(user.id)
    .bind(id)
    .bind(user.superadmin)
    .fetch_optional(db)
    .await?
    .ok_or(ApiError::CompanyNotFound)
}

async fn find_for_manager<'e>(
    db: impl PgExecutor<'e>,
    user: &AuthUser,
    owner: Uuid,
    id: Uuid,
) -> Result<Company, ApiError> {
    sqlx::query_as(
        "SELECT c.id, c.name, c.variable_values, c.is_default, true AS can_manage,
                c.archived_at, c.created_at, c.updated_at
         FROM yzy_contracts.companies c WHERE c.owner_id = $1 AND c.id = $2
         AND $4 AND $3::uuid IS NOT NULL",
    )
    .bind(owner)
    .bind(id)
    .bind(user.id)
    .bind(user.superadmin)
    .fetch_optional(db)
    .await?
    .ok_or(ApiError::CompanyNotFound)
}

async fn lock_owner(db: &PgPool, owner: Uuid) -> Result<Transaction<'_, Postgres>, sqlx::Error> {
    let mut tx = db.begin().await?;
    // Serialize company mutations for this account, including the first
    // insert where there is no profile row to lock. The unique index is
    // the final database guarantee that defaults cannot overlap.
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1::uuid::text, 743294))")
        .bind(owner)
        .execute(&mut *tx)
        .await?;
    Ok(tx)
}

pub(super) async fn create(
    db: &PgPool,
    user: &AuthUser,
    name: &str,
    values: &CompanyValues,
) -> Result<Company, sqlx::Error> {
    let owner = user.id;
    let mut tx = lock_owner(db, owner).await?;
    billing::lock_assignments(&mut tx).await?;
    let company: Company = sqlx::query_as(
        "INSERT INTO yzy_contracts.companies (owner_id, name, variable_values, is_default)
         VALUES ($1, $2, $3, NOT EXISTS (
           SELECT 1 FROM yzy_contracts.companies WHERE owner_id = $1 AND archived_at IS NULL
         ))
         RETURNING id, name, variable_values, is_default, true AS can_manage, archived_at, created_at, updated_at",
    )
    .bind(owner)
    .bind(name)
    .bind(Json(values))
    .fetch_one(&mut *tx)
    .await?;
    billing::provision_company_account(&mut tx, company.id, user.id, &company.name).await?;
    tx.commit().await?;
    Ok(company)
}

pub(super) async fn update(
    db: &PgPool,
    user: &AuthUser,
    id: Uuid,
    name: &str,
    values: &CompanyValues,
) -> Result<Company, ApiError> {
    let mut tx = db.begin().await?;
    billing::lock_assignments(&mut tx).await?;
    let existing = find_for_reader(&mut *tx, user, id).await?;
    if !existing.can_manage {
        return Err(ApiError::BillingRequired);
    }
    if existing.archived_at.is_some() {
        return Err(ApiError::CompanyArchived);
    }
    let company = sqlx::query_as(
        "UPDATE yzy_contracts.companies SET name = $2, variable_values = $3
         WHERE id = $1 AND archived_at IS NULL
         RETURNING id, name, variable_values, is_default AND $4 AS is_default, true AS can_manage,
                   archived_at, created_at, updated_at",
    )
    .bind(id)
    .bind(name)
    .bind(Json(values))
    .bind(user.superadmin)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or(ApiError::CompanyArchived)?;
    tx.commit().await?;
    Ok(company)
}

pub(super) async fn set_default(
    db: &PgPool,
    user: &AuthUser,
    id: Uuid,
) -> Result<Company, ApiError> {
    let owner = managing_owner(db, user, id).await?;
    let mut tx = lock_owner(db, owner).await?;
    let mut company = find_for_manager(&mut *tx, user, owner, id).await?;
    if company.archived_at.is_some() {
        return Err(ApiError::CompanyArchived);
    }
    if !company.is_default {
        sqlx::query(
            "UPDATE yzy_contracts.companies SET is_default = false WHERE owner_id = $1 AND is_default",
        )
        .bind(owner)
        .execute(&mut *tx)
        .await?;
        company = sqlx::query_as(
            "UPDATE yzy_contracts.companies SET is_default = true WHERE owner_id = $1 AND id = $2
             RETURNING id, name, variable_values, is_default, true AS can_manage, archived_at, created_at, updated_at",
        )
        .bind(owner)
        .bind(id)
        .fetch_one(&mut *tx)
        .await?;
    }
    tx.commit().await?;
    Ok(company)
}

pub(super) async fn archive(db: &PgPool, user: &AuthUser, id: Uuid) -> Result<Company, ApiError> {
    let owner = managing_owner(db, user, id).await?;
    let mut tx = lock_owner(db, owner).await?;
    billing::lock_assignments(&mut tx).await?;
    let existing = find_for_manager(&mut *tx, user, owner, id).await?;
    let company = if existing.archived_at.is_some() {
        existing
    } else {
        let archived = sqlx::query_as(
            "UPDATE yzy_contracts.companies SET archived_at = now(), is_default = false
             WHERE owner_id = $1 AND id = $2
             RETURNING id, name, variable_values, is_default, true AS can_manage, archived_at, created_at, updated_at",
        )
        .bind(owner)
        .bind(id)
        .fetch_one(&mut *tx)
        .await?;
        billing::suspend_company_billing(&mut tx, id).await?;
        if existing.is_default {
            sqlx::query(
                "UPDATE yzy_contracts.companies SET is_default = true
                 WHERE owner_id = $1 AND id = (
                   SELECT id FROM yzy_contracts.companies
                   WHERE owner_id = $1 AND archived_at IS NULL ORDER BY created_at, id LIMIT 1
                 )",
            )
            .bind(owner)
            .execute(&mut *tx)
            .await?;
        }
        archived
    };
    tx.commit().await?;
    Ok(company)
}

pub(super) async fn restore(db: &PgPool, user: &AuthUser, id: Uuid) -> Result<Company, ApiError> {
    let owner = managing_owner(db, user, id).await?;
    let mut tx = lock_owner(db, owner).await?;
    billing::lock_assignments(&mut tx).await?;
    let existing = find_for_manager(&mut *tx, user, owner, id).await?;
    let company = if existing.archived_at.is_none() {
        existing
    } else {
        let restored = sqlx::query_as(
            "UPDATE yzy_contracts.companies
             SET archived_at = NULL, is_default = NOT EXISTS (
               SELECT 1 FROM yzy_contracts.companies WHERE owner_id = $1 AND archived_at IS NULL
             )
             WHERE owner_id = $1 AND id = $2
             RETURNING id, name, variable_values, is_default, true AS can_manage, archived_at, created_at, updated_at",
        )
        .bind(owner)
        .bind(id)
        .fetch_one(&mut *tx)
        .await?;
        billing::resume_company_billing(&mut tx, id).await?;
        restored
    };
    tx.commit().await?;
    Ok(company)
}
