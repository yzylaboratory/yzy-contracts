use std::time::Duration;

use serde_json::Value;
use sqlx::PgPool;
use uuid::Uuid;

use super::ConversionResponse;
use crate::error::ApiError;

macro_rules! job_columns {
    () => {
        "id, contract_id, status, attempts, max_attempts, error_code, error_message, warnings,
         page_count, template_id, created_at, updated_at, completed_at"
    };
}

pub async fn find_for_reader(
    db: &PgPool,
    owner_id: Uuid,
    id: Uuid,
) -> sqlx::Result<Option<ConversionResponse>> {
    sqlx::query_as(concat!(
        "SELECT ",
        job_columns!(),
        " FROM yzy_contracts.conversion_jobs j WHERE id = $2
           AND EXISTS (SELECT 1 FROM yzy_contracts.contracts c WHERE c.id = j.contract_id
             AND c.deleted_at IS NULL AND yzy_contracts.can_read_contract($1, c.owner_id, c.company_id, c.shared_company_ids, c.catalog_key))"
    ))
    .bind(owner_id)
    .bind(id)
    .fetch_optional(db)
    .await
}

/// The contract row lock serializes concurrent requests; the partial unique
/// index on active jobs backs this up at the database level.
pub async fn enqueue(
    db: &PgPool,
    owner_id: Uuid,
    contract_id: Uuid,
    max_attempts: i32,
) -> Result<ConversionResponse, ApiError> {
    let mut tx = db.begin().await?;
    let locked: Option<Uuid> = sqlx::query_scalar(
        "SELECT id FROM yzy_contracts.contracts
         WHERE owner_id = $1 AND id = $2 AND deleted_at IS NULL AND catalog_key IS NULL
           AND yzy_contracts.can_read_contract($1, owner_id, company_id, shared_company_ids, catalog_key)
         FOR UPDATE",
    )
    .bind(owner_id)
    .bind(contract_id)
    .fetch_optional(&mut *tx)
    .await?;
    if locked.is_none() {
        return Err(ApiError::ContractNotFound);
    }

    let has_template: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM yzy_contracts.templates WHERE contract_id = $1)",
    )
    .bind(contract_id)
    .fetch_one(&mut *tx)
    .await?;
    if has_template {
        return Err(ApiError::ContractAlreadyConverted);
    }

    let active: Option<ConversionResponse> = sqlx::query_as(concat!(
        "SELECT ",
        job_columns!(),
        " FROM yzy_contracts.conversion_jobs
          WHERE contract_id = $1 AND status IN ('pending', 'processing')"
    ))
    .bind(contract_id)
    .fetch_optional(&mut *tx)
    .await?;
    if let Some(job) = active {
        return Ok(job);
    }

    let job: ConversionResponse = sqlx::query_as(concat!(
        "INSERT INTO yzy_contracts.conversion_jobs (contract_id, owner_id, max_attempts)
         VALUES ($1, $2, $3) RETURNING ",
        job_columns!()
    ))
    .bind(contract_id)
    .bind(owner_id)
    .bind(max_attempts)
    .fetch_one(&mut *tx)
    .await?;
    sqlx::query("UPDATE yzy_contracts.contracts SET status = 'converting' WHERE id = $1")
        .bind(contract_id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(job)
}

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct ClaimedJob {
    pub id: Uuid,
    pub contract_id: Uuid,
    pub owner_id: Uuid,
    pub attempts: i32,
    pub max_attempts: i32,
}

/// Takes the next due job. SKIP LOCKED lets several workers run without ever
/// claiming the same job, and an expired lease makes a dead worker's job
/// claimable again.
pub async fn claim_next(
    db: &PgPool,
    worker_id: &str,
    lease: Duration,
) -> sqlx::Result<Option<ClaimedJob>> {
    sqlx::query_as(
        "UPDATE yzy_contracts.conversion_jobs
         SET status = 'processing',
             attempts = attempts + 1,
             locked_by = $1,
             locked_until = now() + make_interval(secs => $2),
             started_at = COALESCE(started_at, now()),
             error_code = NULL,
             error_message = NULL
         WHERE id = (
           SELECT id FROM yzy_contracts.conversion_jobs
           WHERE attempts < max_attempts
             AND ((status = 'pending' AND next_attempt_at <= now())
                  OR (status = 'processing' AND locked_until < now()))
           ORDER BY next_attempt_at
           LIMIT 1
           FOR UPDATE SKIP LOCKED
         )
         RETURNING id, contract_id, owner_id, attempts, max_attempts",
    )
    .bind(worker_id)
    .bind(lease.as_secs_f64())
    .fetch_optional(db)
    .await
}

/// A job whose worker died on its last attempt can never be claimed again.
pub async fn fail_exhausted_leases(db: &PgPool, error_message: &str) -> sqlx::Result<u64> {
    let result = sqlx::query(
        "WITH failed AS (
           UPDATE yzy_contracts.conversion_jobs
           SET status = 'failed', locked_by = NULL, locked_until = NULL,
               error_code = 'WORKER_LEASE_EXPIRED', error_message = $1, completed_at = now()
           WHERE status = 'processing' AND locked_until < now() AND attempts >= max_attempts
           RETURNING contract_id
         )
         UPDATE yzy_contracts.contracts c
         SET status = 'conversion_failed'
         FROM failed WHERE c.id = failed.contract_id AND c.deleted_at IS NULL",
    )
    .bind(error_message)
    .execute(db)
    .await?;
    Ok(result.rows_affected())
}

#[derive(Debug, sqlx::FromRow)]
pub struct JobSource {
    pub name: String,
    pub original_file_name: String,
    pub mime_type: String,
    pub size_bytes: i64,
    pub object_key: String,
    pub object_etag: String,
}

pub async fn load_source(db: &PgPool, job: &ClaimedJob) -> sqlx::Result<Option<JobSource>> {
    sqlx::query_as(
        "SELECT name, original_file_name, mime_type, size_bytes, object_key, object_etag
         FROM yzy_contracts.contracts
         WHERE owner_id = $1 AND id = $2 AND deleted_at IS NULL AND catalog_key IS NULL",
    )
    .bind(job.owner_id)
    .bind(job.contract_id)
    .fetch_optional(db)
    .await
}

/// Stores the template and completes the job atomically. Returns `false` when
/// this worker no longer holds the job (lease lost, or contract deleted).
pub async fn complete(
    db: &PgPool,
    job: &ClaimedJob,
    worker_id: &str,
    template_name: &str,
    markdown: &str,
    page_count: Option<i32>,
    warnings: Value,
) -> sqlx::Result<bool> {
    let mut tx = db.begin().await?;
    let held: Option<Uuid> = sqlx::query_scalar(
        "SELECT j.id FROM yzy_contracts.conversion_jobs j
         JOIN yzy_contracts.contracts c ON c.id = j.contract_id AND c.deleted_at IS NULL
         WHERE j.id = $1 AND j.status = 'processing' AND j.locked_by = $2 AND j.attempts = $3
         FOR UPDATE OF j, c",
    )
    .bind(job.id)
    .bind(worker_id)
    .bind(job.attempts)
    .fetch_optional(&mut *tx)
    .await?;
    if held.is_none() {
        return Ok(false);
    }

    let template_id: Uuid = sqlx::query_scalar(
        "INSERT INTO yzy_contracts.templates (contract_id, owner_id, name, content_markdown)
         VALUES ($1, $2, $3, $4)
         RETURNING id",
    )
    .bind(job.contract_id)
    .bind(job.owner_id)
    .bind(template_name)
    .bind(markdown)
    .fetch_one(&mut *tx)
    .await?;

    sqlx::query(
        "UPDATE yzy_contracts.conversion_jobs
         SET status = 'completed', locked_by = NULL, locked_until = NULL, template_id = $2,
             page_count = $3, warnings = $4, completed_at = now()
         WHERE id = $1",
    )
    .bind(job.id)
    .bind(template_id)
    .bind(page_count)
    .bind(sqlx::types::Json(warnings))
    .execute(&mut *tx)
    .await?;
    sqlx::query("UPDATE yzy_contracts.contracts SET status = 'converted' WHERE id = $1")
        .bind(job.contract_id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(true)
}

pub async fn schedule_retry(
    db: &PgPool,
    job: &ClaimedJob,
    worker_id: &str,
    delay: Duration,
    error_code: &str,
    error_message: &str,
) -> sqlx::Result<()> {
    sqlx::query(
        "UPDATE yzy_contracts.conversion_jobs
         SET status = 'pending', locked_by = NULL, locked_until = NULL,
             next_attempt_at = now() + make_interval(secs => $4),
             error_code = $5, error_message = $6
         WHERE id = $1 AND status = 'processing' AND locked_by = $2 AND attempts = $3",
    )
    .bind(job.id)
    .bind(worker_id)
    .bind(job.attempts)
    .bind(delay.as_secs_f64())
    .bind(error_code)
    .bind(error_message)
    .execute(db)
    .await?;
    Ok(())
}

pub async fn mark_failed(
    db: &PgPool,
    job: &ClaimedJob,
    worker_id: &str,
    error_code: &str,
    error_message: &str,
) -> sqlx::Result<()> {
    let mut tx = db.begin().await?;
    let updated = sqlx::query(
        "UPDATE yzy_contracts.conversion_jobs
         SET status = 'failed', locked_by = NULL, locked_until = NULL,
             error_code = $4, error_message = $5, completed_at = now()
         WHERE id = $1 AND status = 'processing' AND locked_by = $2 AND attempts = $3",
    )
    .bind(job.id)
    .bind(worker_id)
    .bind(job.attempts)
    .bind(error_code)
    .bind(error_message)
    .execute(&mut *tx)
    .await?;
    if updated.rows_affected() == 1 {
        sqlx::query(
            "UPDATE yzy_contracts.contracts SET status = 'conversion_failed'
             WHERE id = $1 AND deleted_at IS NULL",
        )
        .bind(job.contract_id)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await
}

#[derive(Debug, sqlx::FromRow)]
pub struct PendingPurge {
    pub id: Uuid,
    pub upload_id: Uuid,
    pub object_key: String,
}

pub async fn contracts_pending_purge(db: &PgPool, limit: i64) -> sqlx::Result<Vec<PendingPurge>> {
    sqlx::query_as(
        "SELECT id, upload_id, object_key FROM yzy_contracts.contracts
         WHERE deleted_at IS NOT NULL ORDER BY deleted_at LIMIT $1",
    )
    .bind(limit)
    .fetch_all(db)
    .await
}

/// Runs only after the object is gone from storage.
pub async fn hard_delete_contract(db: &PgPool, purge: &PendingPurge) -> sqlx::Result<()> {
    let mut tx = db.begin().await?;
    sqlx::query("DELETE FROM yzy_contracts.contracts WHERE id = $1 AND deleted_at IS NOT NULL")
        .bind(purge.id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM yzy_contracts.file_uploads WHERE id = $1")
        .bind(purge.upload_id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await
}

#[derive(Debug, sqlx::FromRow)]
pub struct ExpiredUpload {
    pub id: Uuid,
    pub object_key: String,
}

pub async fn expired_uploads(db: &PgPool, limit: i64) -> sqlx::Result<Vec<ExpiredUpload>> {
    sqlx::query_as(
        "SELECT id, object_key FROM yzy_contracts.file_uploads
         WHERE consumed_at IS NULL AND register_before < now()
         ORDER BY register_before LIMIT $1",
    )
    .bind(limit)
    .fetch_all(db)
    .await
}

pub async fn delete_expired_upload(db: &PgPool, id: Uuid) -> sqlx::Result<()> {
    sqlx::query(
        "DELETE FROM yzy_contracts.file_uploads
         WHERE id = $1 AND consumed_at IS NULL AND register_before < now()",
    )
    .bind(id)
    .execute(db)
    .await?;
    Ok(())
}
