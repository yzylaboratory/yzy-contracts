use anyhow::Context;
use reqwest::Client;
use tokio::sync::watch;

use crate::{app_state::AppState, config::BillingMailConfig, modules::billing::repository};

pub struct BillingWorker {
    state: AppState,
    http: Client,
}

impl BillingWorker {
    pub fn new(state: AppState) -> Self {
        Self {
            state,
            http: Client::new(),
        }
    }

    pub async fn run(&self, mut stop: watch::Receiver<bool>) {
        tracing::info!("billing worker started");
        loop {
            if *stop.borrow() {
                break;
            }
            if let Err(error) = self.tick().await {
                tracing::error!(error = format!("{error:#}"), "billing worker tick failed");
            }
            tokio::select! {
                _ = tokio::time::sleep(self.state.config.worker_poll_interval) => {}
                _ = stop.changed() => {}
            }
        }
        tracing::info!("billing worker stopped");
    }

    pub async fn tick(&self) -> anyhow::Result<()> {
        let db = &self.state.db;
        if repository::claim_daily_maintenance(db)
            .await
            .context("claim daily billing maintenance")?
        {
            let mut tx = db.begin().await.context("begin billing maintenance")?;
            repository::lock_assignments(&mut tx)
                .await
                .context("lock billing assignments")?;
            repository::issue_invoices(&mut *tx, None, None)
                .await
                .context("issue monthly invoices")?;
            tx.commit().await.context("commit invoice issuance")?;
            let queued = repository::enqueue_due_reminders(db)
                .await
                .context("enqueue billing reminders")?;
            tracing::info!(queued, "billing daily maintenance finished");
        }

        while let Some(job) = repository::claim_reminder(db)
            .await
            .context("claim billing reminder")?
        {
            match self.send_reminder(&job).await {
                Ok(()) => {
                    repository::mark_reminder_sent(db, job.id)
                        .await
                        .context("mark reminder sent")?;
                }
                Err(error) => {
                    let message = format!("{error:#}");
                    tracing::error!(reminder_id = %job.id, error = %message, "billing reminder failed");
                    repository::mark_reminder_failed(db, job.id, &message)
                        .await
                        .context("mark reminder failed")?;
                }
            }
        }
        Ok(())
    }

    async fn send_reminder(&self, job: &repository::ReminderJob) -> anyhow::Result<()> {
        let mail = self
            .state
            .config
            .billing_mail
            .as_ref()
            .context(
                "YZY_NOTIFICATIONS_URL, YZY_NOTIFICATIONS_TOKEN and BILLING_PORTAL_URL are required to send billing reminders",
            )?;
        let email = job
            .manager_email
            .as_deref()
            .context("billing manager has no confirmed email")?;
        let (subject, body) = reminder_copy(job, mail);
        send_via_notifications(&self.http, mail, email, &subject, &body, &job.kind, job.id).await
    }
}

fn reminder_copy(job: &repository::ReminderJob, mail: &BillingMailConfig) -> (String, String) {
    let amount = format_dop(job.total_minor);
    let due = job.due_on.format("%d/%m/%Y");
    let portal = mail.portal_url.trim_end_matches('/');
    let link = format!("{portal}/facturacion");
    match job.kind.as_str() {
        "issued" => (
            format!("Factura de membresía lista — {}", job.account_name),
            format!(
                "Se emitió la factura de {} por {}.\nVence el {}.\nConcepto: {}\nPaga aquí: {}\n",
                job.account_name, amount, due, job.transfer_memo, link
            ),
        ),
        "reminder" => (
            format!("Recordatorio de pago — {}", job.account_name),
            format!(
                "Tu membresía de {} tiene un pago pendiente de {}.\nVence el {}.\nPaga aquí: {}\n",
                job.account_name, amount, due, link
            ),
        ),
        "due" => (
            format!("Vence hoy — {}", job.account_name),
            format!(
                "Hoy vence el pago de {} por {}.\nSi ya transferiste, reporta la referencia en Membresía.\n{}\n",
                job.account_name, amount, link
            ),
        ),
        _ => (
            format!("Pago vencido — {}", job.account_name),
            format!(
                "El pago de {} por {} está vencido (vencía el {}).\nEl servicio se suspende el día 15 si no hay pago confirmado o en revisión.\n{}\n",
                job.account_name, amount, due, link
            ),
        ),
    }
}

fn format_dop(minor: i64) -> String {
    let major = minor as f64 / 100.0;
    format!("RD${major:.2}")
}

async fn send_via_notifications(
    http: &Client,
    mail: &BillingMailConfig,
    to: &str,
    subject: &str,
    text: &str,
    kind: &str,
    reminder_id: uuid::Uuid,
) -> anyhow::Result<()> {
    let url = format!("{}/v1/emails", mail.notifications_url);
    let response = http
        .post(&url)
        .header("X-Internal-Service-Token", &mail.service_token)
        .header("X-Yzy-Source-Service", "yzy-contracts-api")
        .header("X-Correlation-Id", reminder_id.to_string())
        .header("Idempotency-Key", format!("billing-reminder-{reminder_id}"))
        .json(&serde_json::json!({
            "product": mail.product,
            "to": [to],
            "subject": subject,
            "text": text,
            "kind": format!("billing_{kind}"),
        }))
        .send()
        .await
        .context("yzy-notifications request failed")?;
    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        anyhow::bail!("yzy-notifications returned {status}: {body}");
    }
    Ok(())
}
