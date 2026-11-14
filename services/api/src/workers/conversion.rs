use std::time::Duration;

use anyhow::Context;
use tokio::sync::watch;
use uuid::Uuid;

use crate::{
    app_state::AppState,
    infrastructure::extractor::{ConversionRequest, ExtractorClient, ExtractorError, user_message},
    modules::conversions::repository::{self, ClaimedJob, JobSource},
};

/// Longer than the extractor timeout, so a healthy attempt never loses its lease.
const LEASE_MARGIN: Duration = Duration::from_secs(60);
const RETRY_BASE_DELAY: Duration = Duration::from_secs(30);
const RETRY_MAX_DELAY: Duration = Duration::from_secs(15 * 60);
const SWEEP_BATCH: i64 = 20;
/// The extractor must start its download before this expires.
const SOURCE_URL_MARGIN: Duration = Duration::from_secs(60);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RetryDecision {
    RetryAfter(Duration),
    GiveUp,
}

/// Exponential backoff with a cap, limited by the job's attempt budget.
pub fn retry_decision(attempts: i32, max_attempts: i32) -> RetryDecision {
    if attempts >= max_attempts {
        return RetryDecision::GiveUp;
    }
    let exponent = u32::try_from(attempts.saturating_sub(1))
        .unwrap_or(0)
        .min(16);
    let delay = RETRY_BASE_DELAY.saturating_mul(2u32.saturating_pow(exponent));
    RetryDecision::RetryAfter(delay.min(RETRY_MAX_DELAY))
}

/// How one attempt ended.
#[derive(Debug, PartialEq, Eq)]
enum AttemptFailure {
    Transient(&'static str),
    Permanent(&'static str),
}

pub struct ConversionWorker {
    state: AppState,
    extractor: ExtractorClient,
    worker_id: String,
}

impl ConversionWorker {
    pub fn new(state: AppState, extractor: ExtractorClient) -> Self {
        Self {
            state,
            extractor,
            worker_id: format!("worker-{}", Uuid::new_v4()),
        }
    }

    pub fn worker_id(&self) -> &str {
        &self.worker_id
    }

    pub async fn run(&self, mut stop: watch::Receiver<bool>) {
        tracing::info!(worker_id = %self.worker_id, "conversion worker started");
        loop {
            if *stop.borrow() {
                break;
            }
            let worked = match self.tick().await {
                Ok(worked) => worked,
                Err(error) => {
                    tracing::error!(error = format!("{error:#}"), "worker tick failed");
                    false
                }
            };
            if worked {
                continue;
            }
            tokio::select! {
                _ = tokio::time::sleep(self.state.config.worker_poll_interval) => {}
                _ = stop.changed() => {}
            }
        }
        tracing::info!(worker_id = %self.worker_id, "conversion worker stopped");
    }

    /// One unit of work. Returns whether a job was processed.
    pub async fn tick(&self) -> anyhow::Result<bool> {
        let processed = self.process_next_job().await?;
        if !processed {
            self.sweep().await?;
        }
        Ok(processed)
    }

    pub async fn process_next_job(&self) -> anyhow::Result<bool> {
        let db = &self.state.db;
        repository::fail_exhausted_leases(db, user_message("WORKER_LEASE_EXPIRED"))
            .await
            .context("could not fail exhausted jobs")?;

        let lease = self.state.config.extractor.timeout + LEASE_MARGIN;
        let Some(job) = repository::claim_next(db, &self.worker_id, lease)
            .await
            .context("could not claim a job")?
        else {
            return Ok(false);
        };
        tracing::info!(job_id = %job.id, attempt = job.attempts, "conversion started");

        let Some(source) = repository::load_source(db, &job)
            .await
            .context("could not load the job's contract")?
        else {
            // The contract was deleted, which also removes its jobs.
            return Ok(true);
        };

        match self.convert(&job, &source).await {
            Ok(completed) => {
                if completed {
                    tracing::info!(job_id = %job.id, "conversion completed");
                } else {
                    tracing::warn!(job_id = %job.id, "conversion result discarded: job no longer held");
                }
            }
            Err(failure) => self.record_failure(&job, failure).await?,
        }
        Ok(true)
    }

    async fn convert(&self, job: &ClaimedJob, source: &JobSource) -> Result<bool, AttemptFailure> {
        let storage = &self.state.storage;
        let object = storage.head(&source.object_key).await.map_err(|error| {
            tracing::warn!(job_id = %job.id, error = format!("{error:#}"), "could not inspect source");
            AttemptFailure::Transient("STORAGE_UNAVAILABLE")
        })?;
        let object = object.ok_or(AttemptFailure::Permanent("SOURCE_MISSING"))?;
        // Upload URLs stay valid for a while after registration, so the object
        // could have been replaced after it passed validation.
        if object.etag != source.object_etag || object.size_bytes != source.size_bytes {
            return Err(AttemptFailure::Permanent("SOURCE_CHANGED"));
        }

        let url_ttl = self.state.config.extractor.timeout + SOURCE_URL_MARGIN;
        let source_url = storage
            .presign_get(&source.object_key, None, url_ttl)
            .await
            .map_err(|error| {
                tracing::error!(job_id = %job.id, error = format!("{error:#}"), "could not presign source");
                AttemptFailure::Transient("STORAGE_UNAVAILABLE")
            })?;

        let output = self
            .extractor
            .convert(&ConversionRequest {
                job_id: job.id,
                file_name: &source.original_file_name,
                mime_type: &source.mime_type,
                download_url: &source_url,
            })
            .await
            .map_err(|error| match error {
                ExtractorError::Transient { code } => AttemptFailure::Transient(code),
                ExtractorError::Permanent { code } => AttemptFailure::Permanent(code),
            })?;

        if output.markdown.trim().is_empty() {
            return Err(AttemptFailure::Permanent("EMPTY_EXTRACTION"));
        }
        if output.markdown.contains('\0') {
            return Err(AttemptFailure::Permanent("INVALID_EXTRACTOR_OUTPUT"));
        }
        if output.markdown.len() > self.state.config.template_max_bytes {
            return Err(AttemptFailure::Permanent("MARKDOWN_TOO_LARGE"));
        }
        let warnings = serde_json::to_value(&output.warnings)
            .map_err(|_| AttemptFailure::Permanent("INVALID_EXTRACTOR_OUTPUT"))?;

        repository::complete(
            &self.state.db,
            job,
            &self.worker_id,
            &source.name,
            &output.markdown,
            output.page_count,
            warnings,
        )
        .await
        .map_err(|error| {
            tracing::error!(job_id = %job.id, %error, "could not store the conversion result");
            AttemptFailure::Transient("STORAGE_UNAVAILABLE")
        })
    }

    async fn record_failure(
        &self,
        job: &ClaimedJob,
        failure: AttemptFailure,
    ) -> anyhow::Result<()> {
        let db = &self.state.db;
        let (code, decision) = match failure {
            AttemptFailure::Transient(code) => {
                (code, retry_decision(job.attempts, job.max_attempts))
            }
            AttemptFailure::Permanent(code) => (code, RetryDecision::GiveUp),
        };
        let message = user_message(code);
        match decision {
            RetryDecision::RetryAfter(delay) => {
                tracing::warn!(job_id = %job.id, code, attempt = job.attempts, "conversion will retry");
                repository::schedule_retry(db, job, &self.worker_id, delay, code, message).await
            }
            RetryDecision::GiveUp => {
                tracing::warn!(job_id = %job.id, code, attempt = job.attempts, "conversion failed");
                repository::mark_failed(db, job, &self.worker_id, code, message).await
            }
        }
        .context("could not record the conversion failure")
    }

    /// Removes the files of deleted contracts and of uploads never registered.
    /// A storage failure leaves the row in place, so the next sweep retries.
    pub async fn sweep(&self) -> anyhow::Result<()> {
        let db = &self.state.db;
        for purge in repository::contracts_pending_purge(db, SWEEP_BATCH).await? {
            match self.state.storage.delete(&purge.object_key).await {
                Ok(()) => repository::hard_delete_contract(db, &purge).await?,
                Err(error) => {
                    tracing::warn!(contract_id = %purge.id, error = format!("{error:#}"), "could not purge object");
                }
            }
        }
        for upload in repository::expired_uploads(db, SWEEP_BATCH).await? {
            match self.state.storage.delete(&upload.object_key).await {
                Ok(()) => repository::delete_expired_upload(db, upload.id).await?,
                Err(error) => {
                    tracing::warn!(upload_id = %upload.id, error = format!("{error:#}"), "could not purge upload");
                }
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn retries_back_off_exponentially_up_to_the_cap() {
        assert_eq!(
            retry_decision(1, 5),
            RetryDecision::RetryAfter(Duration::from_secs(30))
        );
        assert_eq!(
            retry_decision(2, 5),
            RetryDecision::RetryAfter(Duration::from_secs(60))
        );
        assert_eq!(
            retry_decision(4, 5),
            RetryDecision::RetryAfter(Duration::from_secs(240))
        );
        assert_eq!(
            retry_decision(9, 20),
            RetryDecision::RetryAfter(RETRY_MAX_DELAY)
        );
    }

    #[test]
    fn gives_up_when_attempts_are_spent() {
        assert_eq!(retry_decision(3, 3), RetryDecision::GiveUp);
        assert_eq!(retry_decision(4, 3), RetryDecision::GiveUp);
    }
}
