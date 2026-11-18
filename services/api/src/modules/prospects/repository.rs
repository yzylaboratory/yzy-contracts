use chrono::{DateTime, Utc};
use sqlx::PgPool;
use uuid::Uuid;

use super::dto::{NormalizedProspect, Prospect, ProspectList};
use crate::{error::ApiError, modules::clients};

pub(super) async fn create_link(
    db: &PgPool,
    actor: Uuid,
    company: Uuid,
    token_hash: &[u8],
    identity_binding: &[u8],
    expires_at: DateTime<Utc>,
) -> sqlx::Result<()> {
    sqlx::query(
        "INSERT INTO prospect_links (company_id, token_hash, created_by, expires_at, identity_binding)
         VALUES ($1, $2, $3, $4, $5)",
    )
    .bind(company)
    .bind(token_hash)
    .bind(actor)
    .bind(expires_at)
    .bind(identity_binding)
    .execute(db)
    .await?;
    Ok(())
}

pub(super) async fn list(db: &PgPool, company: Uuid) -> sqlx::Result<ProspectList> {
    let items = sqlx::query_as(
        "SELECT id, submitted_at, name, identity, phone, address, email,
                nationality, marital_status, occupation
         FROM prospects WHERE company_id = $1
         ORDER BY submitted_at DESC, id DESC",
    )
    .bind(company)
    .fetch_all(db)
    .await?;
    Ok(ProspectList { items })
}

pub(super) async fn verify_identity(
    db: &PgPool,
    token_hash: &[u8],
    identity_binding: &[u8],
) -> sqlx::Result<bool> {
    let verified = sqlx::query_scalar(
        "UPDATE prospect_links
         SET failed_identity_checks = failed_identity_checks
           + CASE WHEN identity_binding = $2 THEN 0 ELSE 1 END
         WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()
           AND identity_binding IS NOT NULL AND failed_identity_checks < 5
           AND EXISTS (
             SELECT 1 FROM companies
             WHERE id = prospect_links.company_id AND archived_at IS NULL
           )
         RETURNING identity_binding = $2",
    )
    .bind(token_hash)
    .bind(identity_binding)
    .fetch_optional(db)
    .await?;
    Ok(verified.unwrap_or(false))
}

/// Atomically claims the link and records the submission in one statement,
/// so a repeated or concurrent submit against the same token can never
/// land twice: only the request that flips `used_at` inserts a row.
pub(super) async fn submit(
    db: &PgPool,
    token_hash: &[u8],
    identity_binding: &[u8],
    data: NormalizedProspect,
) -> sqlx::Result<bool> {
    let saved: Option<Uuid> = sqlx::query_scalar(
        "WITH link AS (
           UPDATE prospect_links
           SET used_at = CASE WHEN identity_binding = $2 THEN now() ELSE NULL END,
               failed_identity_checks = failed_identity_checks
                 + CASE WHEN identity_binding = $2 THEN 0 ELSE 1 END
           WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()
             AND identity_binding IS NOT NULL AND failed_identity_checks < 5
             AND EXISTS (
               SELECT 1 FROM companies
               WHERE id = prospect_links.company_id AND archived_at IS NULL
             )
           RETURNING company_id, used_at
         )
         INSERT INTO prospects
            (company_id, name, identity, phone, address, email, nationality, marital_status, occupation)
         SELECT company_id, $3, $4, $5, $6, $7, $8, $9, $10 FROM link WHERE used_at IS NOT NULL
         RETURNING id",
    )
    .bind(token_hash)
    .bind(identity_binding)
    .bind(data.name)
    .bind(data.identity)
    .bind(data.phone)
    .bind(data.address)
    .bind(data.email)
    .bind(data.nationality)
    .bind(data.marital_status)
    .bind(data.position)
    .fetch_optional(db)
    .await?;
    Ok(saved.is_some())
}

/// Reuses client creation and its canonical audit trail inside one
/// transaction that also removes the pending prospect's PII once the client
/// exists. The row lock on the prospect prevents converting it twice, and a
/// global identity conflict rolls back the whole transaction, so no
/// existing client is ever overwritten.
pub(super) async fn convert(
    db: &PgPool,
    actor: Uuid,
    company: Uuid,
    prospect_id: Uuid,
) -> Result<Uuid, ApiError> {
    let mut tx = db.begin().await?;
    let prospect: Option<Prospect> = sqlx::query_as(
        "SELECT id, submitted_at, name, identity, phone, address, email,
                nationality, marital_status, occupation
         FROM prospects WHERE id = $1 AND company_id = $2
         FOR UPDATE",
    )
    .bind(prospect_id)
    .bind(company)
    .fetch_optional(&mut *tx)
    .await?;
    let Some(prospect) = prospect else {
        return Err(ApiError::ProspectNotFound);
    };
    let client_id = clients::create_client_from_prospect(
        &mut tx,
        actor,
        clients::ProspectConversion {
            name: prospect.name,
            identity: prospect.identity,
            phone: prospect.phone,
            address: prospect.address,
            email: prospect.email,
            nationality: prospect.nationality,
            marital_status: prospect.marital_status,
            position: prospect.position,
        },
    )
    .await?;
    sqlx::query("DELETE FROM prospects WHERE id = $1")
        .bind(prospect_id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(client_id)
}
