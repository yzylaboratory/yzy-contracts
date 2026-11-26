use sqlx::{PgExecutor, PgPool, Postgres, Transaction, types::Json};
use uuid::Uuid;

use super::{Company, CompanyValues};
use crate::{
    error::ApiError,
    modules::{auth::AuthUser, billing::repository as billing},
};

pub(in crate::modules) async fn list(
    db: &PgPool,
    user_id: Uuid,
    include_archived: bool,
    superadmin: bool,
) -> Result<Vec<Company>, sqlx::Error> {
    // Enabled people read every active company; only the superadministrator manages or sees archived ones.
    sqlx::query_as(
        "SELECT c.id, c.name, c.variable_values,
                c.is_default AND $3 AS is_default,
                ($3 OR c.id IN (SELECT billing_companies_for($1))) AS can_manage,
                c.archived_at, c.created_at, c.updated_at
         FROM companies c
         WHERE (($2 AND $3) OR c.archived_at IS NULL)
         ORDER BY c.archived_at IS NOT NULL, c.is_default DESC, lower(c.name), c.id",
    )
    .bind(user_id)
    .bind(include_archived)
    .bind(superadmin)
    .fetch_all(db)
    .await
}

pub(in crate::modules) async fn find_for_reader(
    db: impl PgExecutor<'_>,
    user: &AuthUser,
    id: Uuid,
) -> Result<Company, ApiError> {
    sqlx::query_as(
        "SELECT c.id, c.name, c.variable_values,
                c.is_default AND $3 AS is_default,
                ($3 OR c.id IN (SELECT billing_companies_for($1))) AS can_manage,
                c.archived_at, c.created_at, c.updated_at
         FROM companies c
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
        "SELECT c.owner_id FROM companies c WHERE c.id = $2
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
         FROM companies c WHERE c.owner_id = $1 AND c.id = $2
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
        "INSERT INTO companies (owner_id, name, variable_values, is_default)
         VALUES ($1, $2, $3, NOT EXISTS (
           SELECT 1 FROM companies WHERE owner_id = $1 AND archived_at IS NULL
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
        "UPDATE companies SET name = $2, variable_values = $3
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
        sqlx::query("UPDATE companies SET is_default = false WHERE owner_id = $1 AND is_default")
            .bind(owner)
            .execute(&mut *tx)
            .await?;
        company = sqlx::query_as(
            "UPDATE companies SET is_default = true WHERE owner_id = $1 AND id = $2
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
            "UPDATE companies SET archived_at = now(), is_default = false
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
                "UPDATE companies SET is_default = true
                 WHERE owner_id = $1 AND id = (
                   SELECT id FROM companies
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
            "UPDATE companies
             SET archived_at = NULL, is_default = NOT EXISTS (
               SELECT 1 FROM companies WHERE owner_id = $1 AND archived_at IS NULL
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

/// Permanently removes an archived company that never held documents, cases or billed periods.
pub(super) async fn delete(db: &PgPool, user: &AuthUser, id: Uuid) -> Result<(), ApiError> {
    let owner = managing_owner(db, user, id).await?;
    let mut tx = lock_owner(db, owner).await?;
    billing::lock_assignments(&mut tx).await?;
    let existing = find_for_manager(&mut *tx, user, owner, id).await?;
    if existing.archived_at.is_none() {
        return Err(ApiError::CompanyNotArchived);
    }
    let (contracts, operations, prospects, insured, billed): (bool, bool, bool, bool, bool) =
        sqlx::query_as(
            "SELECT
           EXISTS (SELECT 1 FROM contracts WHERE company_id = $1 OR $1 = ANY(shared_company_ids)),
           EXISTS (SELECT 1 FROM client_operations WHERE company_id = $1),
           EXISTS (SELECT 1 FROM prospects WHERE company_id = $1),
           EXISTS (SELECT 1 FROM insurance_carriers WHERE company_id = $1),
           EXISTS (SELECT 1 FROM billing_invoice_lines WHERE company_id = $1)
           OR EXISTS (
             SELECT 1 FROM billing_accounts a
             WHERE a.company_id = $1 AND (
               EXISTS (SELECT 1 FROM billing_invoices i WHERE i.account_id = a.id)
               OR EXISTS (SELECT 1 FROM billing_account_companies ac
                          WHERE ac.account_id = a.id AND ac.company_id <> $1)
             )
           )",
        )
        .bind(id)
        .fetch_one(&mut *tx)
        .await?;
    let mut uses = Vec::new();
    if contracts {
        uses.push("plantillas");
    }
    if operations {
        uses.push("expedientes");
    }
    if prospects {
        uses.push("prospectos");
    }
    if insured {
        uses.push("aseguradoras o pólizas");
    }
    if billed {
        uses.push("facturación");
    }
    if !uses.is_empty() {
        return Err(ApiError::CompanyInUse(format!(
            "La empresa tiene {} y no se puede borrar. Déjala archivada.",
            uses.join(", ")
        )));
    }
    sqlx::query("DELETE FROM prospect_links WHERE company_id = $1")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    let deleted: bool = sqlx::query_scalar("SELECT delete_archived_company($1)")
        .bind(id)
        .fetch_one(&mut *tx)
        .await?;
    if !deleted {
        return Err(ApiError::CompanyNotArchived);
    }
    tx.commit().await?;
    Ok(())
}
