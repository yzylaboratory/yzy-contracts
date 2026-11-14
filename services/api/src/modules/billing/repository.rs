use crate::modules::admin_pagination::PageQuery;
use chrono::{DateTime, Datelike, Months, NaiveDate, Utc};
use serde::Deserialize;
use sqlx::{PgConnection, PgExecutor, PgPool, types::Json};
use uuid::Uuid;

use super::dto::{
    AccountInput, BankAccount, BankAccountSettings, BillingAccount, BillingCompany, BillingInvoice,
    InvoiceLine, InvoiceState,
};
use crate::error::ApiError;

const MONTHLY_PRICE_MINOR: i32 = 200_000;

#[derive(sqlx::FromRow)]
struct BankDestination {
    #[sqlx(flatten)]
    account: BankAccount,
    revision: Uuid,
    updated_at: DateTime<Utc>,
}

impl From<BankDestination> for BankAccountSettings {
    fn from(row: BankDestination) -> Self {
        Self {
            bank_account: Some(row.account),
            revision: Some(row.revision),
            updated_at: Some(row.updated_at),
        }
    }
}

pub async fn bank_destination(
    executor: impl PgExecutor<'_>,
) -> Result<Option<BankAccountSettings>, ApiError> {
    let row = sqlx::query_as::<_, BankDestination>(
        "SELECT bank_name, account_holder, account_type, account_number, revision, updated_at
         FROM yzy_contracts.billing_bank_destination WHERE id = 1",
    )
    .fetch_optional(executor)
    .await?;
    Ok(row.map(Into::into))
}

pub async fn save_bank_destination(
    db: &PgPool,
    actor: Uuid,
    account: BankAccount,
    expected_revision: Option<Uuid>,
) -> Result<BankAccountSettings, ApiError> {
    let row = if let Some(revision) = expected_revision {
        sqlx::query_as::<_, BankDestination>(
            "UPDATE yzy_contracts.billing_bank_destination
             SET bank_name = $1, account_holder = $2, account_type = $3, account_number = $4,
                 updated_by = $5, updated_at = now(), revision = gen_random_uuid()
             WHERE id = 1 AND revision = $6
             RETURNING bank_name, account_holder, account_type, account_number, revision, updated_at",
        )
        .bind(account.bank_name)
        .bind(account.account_holder)
        .bind(account.account_type)
        .bind(account.account_number)
        .bind(actor)
        .bind(revision)
        .fetch_optional(db)
        .await?
    } else {
        sqlx::query_as::<_, BankDestination>(
            "INSERT INTO yzy_contracts.billing_bank_destination
                 (bank_name, account_holder, account_type, account_number, updated_by)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (id) DO NOTHING
             RETURNING bank_name, account_holder, account_type, account_number, revision, updated_at",
        )
        .bind(account.bank_name)
        .bind(account.account_holder)
        .bind(account.account_type)
        .bind(account.account_number)
        .bind(actor)
        .fetch_optional(db)
        .await?
    };
    row.map(Into::into).ok_or(ApiError::BillingBankConflict)
}

pub async fn managed_account_ids(
    executor: impl PgExecutor<'_>,
    manager: Option<Uuid>,
) -> Result<Vec<Uuid>, ApiError> {
    Ok(sqlx::query_scalar(
        "SELECT id FROM yzy_contracts.billing_accounts
         WHERE $1::uuid IS NULL OR (manager_user_id = $1 AND yzy_contracts.has_enabled_access($1))
         ORDER BY id FOR SHARE",
    )
    .bind(manager)
    .fetch_all(executor)
    .await?)
}

#[derive(Deserialize, sqlx::FromRow)]
struct AccountRow {
    id: Uuid,
    company_id: Option<Uuid>,
    name: String,
    manager_user_id: Uuid,
    starts_on: NaiveDate,
    companies: Json<Vec<BillingCompany>>,
}

const ACCOUNTS_ROWS: &str = "SELECT a.id, a.company_id, COALESCE(dedicated.name, a.name) AS name, a.manager_user_id,
           a.starts_on,
           COALESCE(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name) ORDER BY lower(c.name), c.id)
             FILTER (WHERE c.id IS NOT NULL), '[]'::jsonb) AS companies
         FROM yzy_contracts.billing_accounts a
         LEFT JOIN yzy_contracts.companies dedicated ON dedicated.id = a.company_id
         LEFT JOIN yzy_contracts.billing_account_companies ac ON ac.account_id = a.id AND ac.ends_on IS NULL
         LEFT JOIN yzy_contracts.companies c ON c.id = ac.company_id
         WHERE ($1::uuid[] IS NULL OR a.id = ANY($1))
         GROUP BY a.id, dedicated.name";

pub(super) async fn accounts_page(
    executor: impl PgExecutor<'_>,
    page: &PageQuery,
) -> Result<(i64, Vec<BillingAccount>), ApiError> {
    let (total, Json(items)): (i64, Json<Vec<AccountRow>>) =
        sqlx::query_as(sqlx::AssertSqlSafe(format!(
            "WITH matching AS ({ACCOUNTS_ROWS}), paged AS (
                SELECT * FROM matching ORDER BY lower(name), id LIMIT $2 OFFSET $3
             )
             SELECT (SELECT count(*) FROM matching),
                COALESCE(jsonb_agg(paged ORDER BY lower(name), id), '[]'::jsonb)
             FROM paged"
        )))
        .bind(None::<&[Uuid]>)
        .bind(page.limit())
        .bind(page.offset())
        .fetch_one(executor)
        .await?;
    Ok((total, items.into_iter().map(BillingAccount::from).collect()))
}

pub async fn accounts(
    executor: impl PgExecutor<'_>,
    ids: Option<&[Uuid]>,
) -> Result<Vec<BillingAccount>, ApiError> {
    let rows: Vec<AccountRow> = sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "{ACCOUNTS_ROWS} ORDER BY lower(COALESCE(dedicated.name, a.name)), a.id"
    )))
    .bind(ids)
    .fetch_all(executor)
    .await?;
    Ok(rows.into_iter().map(BillingAccount::from).collect())
}

impl From<AccountRow> for BillingAccount {
    fn from(row: AccountRow) -> Self {
        Self {
            id: row.id,
            company_id: row.company_id,
            name: row.name,
            manager_user_id: row.manager_user_id,
            starts_on: row.starts_on,
            monthly_total_minor: row.companies.len() as i64 * i64::from(MONTHLY_PRICE_MINOR),
            companies: row.companies.0,
        }
    }
}

pub async fn lock_assignments(db: &mut PgConnection) -> Result<(), sqlx::Error> {
    sqlx::query(
        "SELECT pg_advisory_xact_lock(hashtextextended('yzy_contracts.billing_assignments', 0))",
    )
    .execute(db)
    .await?;
    Ok(())
}

pub async fn provision_company_account(
    db: &mut PgConnection,
    company_id: Uuid,
    manager_id: Uuid,
    name: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "WITH created AS (
           INSERT INTO yzy_contracts.billing_accounts (company_id, name, manager_user_id, starts_on)
           VALUES ($1, $2, $3, (date_trunc('month', now() AT TIME ZONE 'America/Santo_Domingo') + interval '1 month')::date)
           RETURNING id, company_id, starts_on
         )
         INSERT INTO yzy_contracts.billing_account_companies (account_id, company_id, starts_on)
         SELECT id, company_id, starts_on FROM created",
    )
    .bind(company_id)
    .bind(name)
    .bind(manager_id)
    .execute(db)
    .await?;
    Ok(())
}

pub async fn suspend_company_billing(
    db: &mut PgConnection,
    company_id: Uuid,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "WITH next_month AS (
           SELECT (date_trunc('month', now() AT TIME ZONE 'America/Santo_Domingo') + interval '1 month')::date AS starts_on
         ), scheduled AS (
           DELETE FROM yzy_contracts.billing_account_companies ac USING yzy_contracts.billing_accounts a, next_month n
           WHERE a.company_id = $1 AND ac.account_id = a.id AND ac.ends_on IS NULL AND ac.starts_on >= n.starts_on
         )
         UPDATE yzy_contracts.billing_account_companies ac SET ends_on = n.starts_on
         FROM yzy_contracts.billing_accounts a, next_month n
         WHERE a.company_id = $1 AND ac.account_id = a.id AND ac.ends_on IS NULL AND ac.starts_on < n.starts_on",
    )
    .bind(company_id)
    .execute(db)
    .await?;
    Ok(())
}

pub async fn resume_company_billing(
    db: &mut PgConnection,
    company_id: Uuid,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO yzy_contracts.billing_account_companies (account_id, company_id, starts_on)
         SELECT a.id, a.company_id,
           GREATEST(
             a.starts_on,
             (date_trunc('month', now() AT TIME ZONE 'America/Santo_Domingo') + interval '1 month')::date,
             (SELECT max(ac.ends_on) FROM yzy_contracts.billing_account_companies ac WHERE ac.company_id = a.company_id)
           )
         FROM yzy_contracts.billing_accounts a WHERE a.company_id = $1
         ON CONFLICT (company_id) WHERE ends_on IS NULL DO NOTHING",
    )
    .bind(company_id)
    .execute(db)
    .await?;
    Ok(())
}

pub async fn save_account(
    db: &PgPool,
    id: Option<Uuid>,
    mut input: AccountInput,
    starts_on: Option<NaiveDate>,
) -> Result<BillingAccount, ApiError> {
    let name = input.name.trim();
    let company_count = input.company_ids.len();
    input.company_ids.sort_unstable();
    input.company_ids.dedup();
    if name.is_empty()
        || input.company_ids.len() != company_count
        || (id.is_none() && company_count == 0)
    {
        return Err(ApiError::Validation(
            "Indica un nombre y empresas únicas.".to_owned(),
        ));
    }
    let mut tx = db.begin().await?;
    // Serialize assignment edits across accounts, including scheduled moves.
    lock_assignments(&mut tx).await?;
    let manager_enabled: bool = sqlx::query_scalar("SELECT yzy_contracts.has_enabled_access($1)")
        .bind(input.manager_user_id)
        .fetch_one(&mut *tx)
        .await?;
    if !manager_enabled {
        return Err(ApiError::Validation(
            "Selecciona un usuario habilitado como responsable de facturación.".to_owned(),
        ));
    }
    let today: NaiveDate =
        sqlx::query_scalar("SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'America/Santo_Domingo')::date")
            .fetch_one(&mut *tx)
            .await?;
    let current_month = today
        .with_day(1)
        .ok_or_else(|| anyhow::anyhow!("invalid billing date"))?;
    let next_month = current_month
        .checked_add_months(Months::new(1))
        .ok_or_else(|| anyhow::anyhow!("invalid billing date"))?;

    let effective = if let Some(account_id) = id {
        let (start, dedicated_company): (NaiveDate, Option<Uuid>) = sqlx::query_as(
            "SELECT starts_on, company_id FROM yzy_contracts.billing_accounts WHERE id = $1 FOR UPDATE",
        )
        .bind(account_id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or(ApiError::BillingNotFound)?;
        if let Some(company_id) = dedicated_company {
            let assigned: Vec<Uuid> = sqlx::query_scalar(
                "SELECT company_id FROM yzy_contracts.billing_account_companies WHERE account_id = $1 AND ends_on IS NULL",
            )
            .bind(account_id)
            .fetch_all(&mut *tx)
            .await?;
            if assigned != input.company_ids {
                return Err(ApiError::BillingConflict(
                    "La cuenta pertenece a su empresa. Archiva la empresa para detener futuros cobros.",
                ));
            }
            sqlx::query("UPDATE yzy_contracts.billing_accounts SET manager_user_id = $2 WHERE id = $1 AND company_id = $3")
                .bind(account_id)
                .bind(input.manager_user_id)
                .bind(company_id)
                .execute(&mut *tx)
                .await?;
            let account = accounts(&mut *tx, Some(&[account_id]))
                .await?
                .pop()
                .ok_or(ApiError::BillingNotFound)?;
            tx.commit().await?;
            return Ok(account);
        }
        next_month.max(start)
    } else {
        let start = starts_on.unwrap_or(next_month);
        if start.day() != 1 || start < current_month {
            return Err(ApiError::Validation(
                "El inicio debe ser el primer día del mes actual o de un mes futuro.".to_owned(),
            ));
        }
        start
    };

    let companies: Vec<Uuid> = sqlx::query_scalar(
        "SELECT id FROM yzy_contracts.companies
         WHERE id = ANY($1) AND archived_at IS NULL ORDER BY id FOR SHARE",
    )
    .bind(&input.company_ids)
    .fetch_all(&mut *tx)
    .await?;
    if companies.len() != company_count {
        return Err(ApiError::CompanyNotFound);
    }
    let other_payer: bool = sqlx::query_scalar(
        "SELECT EXISTS (
           SELECT 1 FROM yzy_contracts.billing_account_companies
           WHERE company_id = ANY($1) AND ($2::uuid IS NULL OR account_id <> $2)
             AND (ends_on IS NULL OR ends_on > $3)
         ) OR EXISTS (
           SELECT 1 FROM yzy_contracts.billing_accounts WHERE company_id = ANY($1)
         )",
    )
    .bind(&companies)
    .bind(id)
    .bind(effective)
    .fetch_one(&mut *tx)
    .await?;
    if other_payer {
        return Err(ApiError::BillingConflict(
            "Una de las empresas ya pertenece a otra cuenta de facturación.",
        ));
    }
    if let Some(account_id) = id {
        let changes_prepaid_companies: bool = sqlx::query_scalar(
            "SELECT EXISTS (
               SELECT 1 FROM yzy_contracts.billing_invoices i
               WHERE i.account_id = $1 AND i.period >= $2 AND (
                 NOT i.renewal_generated OR EXISTS (
                   SELECT 1 FROM yzy_contracts.billing_renewal_periods p
                   JOIN yzy_contracts.billing_transfer_reports r ON r.id = p.report_id
                   WHERE p.invoice_id = i.id AND r.approved IS DISTINCT FROM false
                 )
               )
             ) AND $3 <> ARRAY(
               SELECT company_id FROM yzy_contracts.billing_account_companies
               WHERE account_id = $1 AND ends_on IS NULL ORDER BY company_id
             )",
        )
        .bind(account_id)
        .bind(effective)
        .bind(&companies)
        .fetch_one(&mut *tx)
        .await?;
        if changes_prepaid_companies {
            return Err(ApiError::BillingConflict(
                "La cuenta tiene facturas para meses futuros. Podrás cambiar las empresas cuando esos meses queden fuera del cambio.",
            ));
        }
    }
    let account_id = if let Some(account_id) = id {
        sqlx::query("UPDATE yzy_contracts.billing_accounts SET name = $2, manager_user_id = $3 WHERE id = $1")
            .bind(account_id)
            .bind(name)
            .bind(input.manager_user_id)
            .execute(&mut *tx)
            .await?;
        sqlx::query(
            "DELETE FROM yzy_contracts.billing_account_companies
             WHERE account_id = $1 AND starts_on >= $2 AND ends_on IS NULL AND NOT (company_id = ANY($3))",
        )
        .bind(account_id)
        .bind(effective)
        .bind(&companies)
        .execute(&mut *tx)
        .await?;
        sqlx::query(
            "UPDATE yzy_contracts.billing_account_companies SET ends_on = $2
             WHERE account_id = $1 AND ends_on IS NULL AND NOT (company_id = ANY($3))",
        )
        .bind(account_id)
        .bind(effective)
        .bind(&companies)
        .execute(&mut *tx)
        .await?;
        account_id
    } else {
        sqlx::query_scalar(
            "INSERT INTO yzy_contracts.billing_accounts (name, manager_user_id, starts_on)
             VALUES ($1, $2, $3) RETURNING id",
        )
        .bind(name)
        .bind(input.manager_user_id)
        .bind(effective)
        .fetch_one(&mut *tx)
        .await?
    };
    sqlx::query(
        "INSERT INTO yzy_contracts.billing_account_companies (account_id, company_id, starts_on)
         SELECT $1, selected.company_id, $3 FROM unnest($2::uuid[]) AS selected(company_id)
         WHERE NOT EXISTS (
           SELECT 1 FROM yzy_contracts.billing_account_companies ac
           WHERE ac.account_id = $1 AND ac.company_id = selected.company_id AND ac.ends_on IS NULL
         )",
    )
    .bind(account_id)
    .bind(&companies)
    .bind(effective)
    .execute(&mut *tx)
    .await?;
    let account = accounts(&mut *tx, Some(&[account_id]))
        .await?
        .pop()
        .ok_or(ApiError::BillingNotFound)?;
    tx.commit().await?;
    Ok(account)
}

/// One statement publishes the invoice and its company snapshots. A concurrent
/// first access to a period can create only one invoice for each account.
pub async fn issue_invoices(
    executor: impl PgExecutor<'_>,
    accounts: Option<&[Uuid]>,
    companies: Option<&[Uuid]>,
) -> Result<(), ApiError> {
    issue_invoices_until(executor, accounts, companies, None).await
}

async fn issue_invoices_until(
    executor: impl PgExecutor<'_>,
    accounts: Option<&[Uuid]>,
    companies: Option<&[Uuid]>,
    until: Option<NaiveDate>,
) -> Result<(), ApiError> {
    sqlx::query(
        "WITH this_month AS (
           SELECT COALESCE($4::date, date_trunc('month', CURRENT_TIMESTAMP AT TIME ZONE 'America/Santo_Domingo')::date) AS starts_on
         ), billable AS MATERIALIZED (
           SELECT ac.account_id, ac.company_id, c.name AS company_name, month.period::date AS period
           FROM yzy_contracts.billing_account_companies ac
           JOIN yzy_contracts.companies c ON c.id = ac.company_id
           CROSS JOIN this_month tm
           CROSS JOIN LATERAL generate_series(ac.starts_on::timestamp,
             LEAST(
               tm.starts_on,
               ac.ends_on - interval '1 month',
               date_trunc('month', c.archived_at AT TIME ZONE 'America/Santo_Domingo')
             ),
             interval '1 month') AS month(period)
           WHERE ($1::uuid[] IS NULL OR ac.account_id = ANY($1))
             AND ($2::uuid[] IS NULL OR EXISTS (
               SELECT 1 FROM yzy_contracts.billing_account_companies relevant
               WHERE relevant.account_id = ac.account_id AND relevant.company_id = ANY($2)
                 AND relevant.starts_on <= month.period
                 AND (relevant.ends_on IS NULL OR relevant.ends_on > month.period)
             ))
         ), missing AS MATERIALIZED (
           SELECT DISTINCT b.account_id, b.period FROM billable b
           WHERE NOT EXISTS (SELECT 1 FROM yzy_contracts.billing_invoices i
                             WHERE i.account_id = b.account_id AND i.period = b.period)
         ), candidates AS MATERIALIZED (
           SELECT account_id, period, gen_random_uuid() AS id FROM missing
         ), issued AS (
           INSERT INTO yzy_contracts.billing_invoices (id, account_id, period, due_on, transfer_memo)
           SELECT id, account_id, period, period, 'YZY-' || replace(id::text, '-', '') FROM candidates
           ORDER BY account_id, period
           ON CONFLICT (account_id, period) DO NOTHING RETURNING id, account_id, period
         )
         INSERT INTO yzy_contracts.billing_invoice_lines (invoice_id, company_id, company_name, unit_price_minor)
         SELECT i.id, b.company_id, b.company_name, $3
         FROM issued i JOIN billable b USING (account_id, period)",
    )
    .bind(accounts)
    .bind(companies)
    .bind(MONTHLY_PRICE_MINOR)
    .bind(until)
    .execute(executor)
    .await?;
    Ok(())
}

pub async fn prepare_renewal(
    db: &mut PgConnection,
    account_id: Uuid,
) -> Result<BillingInvoice, ApiError> {
    let ids = [account_id];
    issue_invoices(&mut *db, Some(&ids), None).await?;
    let existing = invoices(&mut *db, Some(&ids), None).await?;
    if let Some(invoice) = existing
        .into_iter()
        .filter(|invoice| {
            matches!(
                invoice.state,
                InvoiceState::Pending | InvoiceState::InReview
            )
        })
        .min_by_key(|invoice| invoice.period)
    {
        return if matches!(invoice.state, InvoiceState::Pending) {
            Ok(invoice)
        } else {
            Err(ApiError::BillingConflict(
                "Espera la revisión de la transferencia antes de renovar otra vez.",
            ))
        };
    }
    let period: NaiveDate = sqlx::query_scalar(
        "SELECT GREATEST(a.starts_on, date_trunc('month', now() AT TIME ZONE 'America/Santo_Domingo')::date,
            ((SELECT max(i.period) FROM yzy_contracts.billing_invoices i
              WHERE i.account_id = a.id AND i.paid_at IS NOT NULL) + interval '1 month')::date)
         FROM yzy_contracts.billing_accounts a WHERE a.id = $1",
    )
    .bind(account_id)
    .fetch_one(&mut *db)
    .await?;
    let has_companies: bool = sqlx::query_scalar(
        "SELECT EXISTS (
           SELECT 1 FROM yzy_contracts.billing_account_companies ac
           JOIN yzy_contracts.companies c ON c.id = ac.company_id AND c.archived_at IS NULL
           WHERE ac.account_id = $1 AND ac.starts_on <= $2 AND (ac.ends_on IS NULL OR ac.ends_on > $2)
         )",
    )
    .bind(account_id)
    .bind(period)
    .fetch_one(&mut *db)
    .await?;
    if !has_companies {
        return Err(ApiError::BillingConflict(
            "La cuenta no tiene empresas activas para el próximo período.",
        ));
    }
    issue_invoices_until(&mut *db, Some(&ids), None, Some(period)).await?;
    let invoice_id: Uuid = sqlx::query_scalar(
        "UPDATE yzy_contracts.billing_invoices SET renewal_generated = false
         WHERE account_id = $1 AND period = $2 RETURNING id",
    )
    .bind(account_id)
    .bind(period)
    .fetch_one(&mut *db)
    .await?;
    invoices(db, Some(&ids), Some(invoice_id))
        .await?
        .pop()
        .ok_or(ApiError::BillingNotFound)
}

#[derive(Deserialize, sqlx::FromRow)]
struct InvoiceRow {
    id: Uuid,
    account_id: Uuid,
    account_name: String,
    period: NaiveDate,
    due_on: NaiveDate,
    is_overdue: bool,
    total_minor: i64,
    months: i16,
    discount_minor: i64,
    renewal_month_limit: i16,
    transfer_memo: String,
    lines: Json<Vec<InvoiceLine>>,
    transfer_reference: Option<String>,
    transfer_report_id: Option<Uuid>,
    transfer_reported_at: Option<DateTime<Utc>>,
    paid_at: Option<DateTime<Utc>>,
}

const INVOICES_ROWS: &str = "SELECT i.id, i.account_id, COALESCE(dedicated.name, a.name) AS account_name, i.period, i.due_on,
           (i.paid_at IS NULL AND i.due_on < (CURRENT_TIMESTAMP AT TIME ZONE 'America/Santo_Domingo')::date) AS is_overdue,
           l.total_minor * COALESCE(r.months, 1) - COALESCE(r.discount_minor, 0) AS total_minor,
           COALESCE(r.months, 1::smallint) AS months, COALESCE(r.discount_minor, 0) AS discount_minor,
           CASE WHEN i.paid_at IS NULL AND r.id IS NULL THEN yzy_contracts.billing_renewal_month_limit(i.id)
                ELSE 1::smallint END AS renewal_month_limit,
           i.transfer_memo, l.lines, r.reference AS transfer_reference,
           r.id AS transfer_report_id, r.submitted_at AS transfer_reported_at, i.paid_at
         FROM yzy_contracts.billing_invoices i
         JOIN yzy_contracts.billing_accounts a ON a.id = i.account_id
         LEFT JOIN yzy_contracts.companies dedicated ON dedicated.id = a.company_id
         JOIN LATERAL (
           SELECT sum(unit_price_minor) AS total_minor,
             jsonb_agg(jsonb_build_object('company_id', company_id, 'company_name', company_name,
               'unit_price_minor', unit_price_minor) ORDER BY lower(company_name), company_id) AS lines
           FROM yzy_contracts.billing_invoice_lines WHERE invoice_id = i.id
         ) l ON true
         LEFT JOIN yzy_contracts.billing_transfer_reports r
           ON r.invoice_id = i.id AND r.approved IS DISTINCT FROM false
         WHERE ($1::uuid[] IS NULL OR i.account_id = ANY($1)) AND ($2::uuid IS NULL OR i.id = $2)
           AND (NOT i.renewal_generated OR r.id IS NOT NULL
                OR i.period <= date_trunc('month', now() AT TIME ZONE 'America/Santo_Domingo')::date)
           AND NOT EXISTS (
             SELECT 1 FROM yzy_contracts.billing_renewal_periods p
             JOIN yzy_contracts.billing_transfer_reports reserved ON reserved.id = p.report_id
             WHERE p.invoice_id = i.id AND reserved.approved IS DISTINCT FROM false
           )
           AND ($3::boolean IS NULL OR (i.paid_at IS NULL AND r.id IS NOT NULL) = $3)";

pub(super) async fn invoices_page(
    executor: impl PgExecutor<'_>,
    page: &PageQuery,
    in_review: Option<bool>,
) -> Result<(i64, Vec<BillingInvoice>), ApiError> {
    let (total, Json(items)): (i64, Json<Vec<InvoiceRow>>) = sqlx::query_as(
        sqlx::AssertSqlSafe(format!(
            "WITH matching AS ({INVOICES_ROWS}), paged AS (
                SELECT * FROM matching ORDER BY CASE WHEN $3 IS TRUE THEN transfer_reported_at END, period DESC, lower(account_name), id LIMIT $4 OFFSET $5
             )
             SELECT (SELECT count(*) FROM matching),
                COALESCE(jsonb_agg(paged ORDER BY CASE WHEN $3 IS TRUE THEN transfer_reported_at END, period DESC, lower(account_name), id), '[]'::jsonb)
             FROM paged"
        )),
    )
    .bind(None::<&[Uuid]>).bind(None::<Uuid>).bind(in_review)
    .bind(page.limit())
    .bind(page.offset())
    .fetch_one(executor)
    .await?;
    Ok((total, items.into_iter().map(BillingInvoice::from).collect()))
}

pub async fn invoices(
    executor: impl PgExecutor<'_>,
    accounts: Option<&[Uuid]>,
    invoice: Option<Uuid>,
) -> Result<Vec<BillingInvoice>, ApiError> {
    let rows: Vec<InvoiceRow> = sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "{INVOICES_ROWS} ORDER BY i.period DESC, lower(COALESCE(dedicated.name, a.name)), i.id"
    )))
    .bind(accounts)
    .bind(invoice)
    .bind(None::<bool>)
    .fetch_all(executor)
    .await?;
    Ok(rows.into_iter().map(BillingInvoice::from).collect())
}

impl From<InvoiceRow> for BillingInvoice {
    fn from(row: InvoiceRow) -> Self {
        Self {
            id: row.id,
            account_id: row.account_id,
            account_name: row.account_name,
            period: row.period,
            due_on: row.due_on,
            state: if row.paid_at.is_some() {
                InvoiceState::Paid
            } else if row.transfer_report_id.is_some() {
                InvoiceState::InReview
            } else {
                InvoiceState::Pending
            },
            is_overdue: row.is_overdue,
            total_minor: row.total_minor,
            months: row.months,
            discount_minor: row.discount_minor,
            renewal_month_limit: row.renewal_month_limit,
            transfer_memo: row.transfer_memo,
            lines: row.lines.0,
            transfer_reference: row.transfer_reference,
            transfer_report_id: row.transfer_report_id,
            transfer_reported_at: row.transfer_reported_at,
            paid_at: row.paid_at,
        }
    }
}

pub async fn lock_invoice(
    db: &mut PgConnection,
    id: Uuid,
    accounts: Option<&[Uuid]>,
) -> Result<(), ApiError> {
    sqlx::query_scalar::<_, Uuid>(
        "SELECT i.id FROM yzy_contracts.billing_invoices i WHERE i.id = $1
         AND ($2::uuid[] IS NULL OR i.account_id = ANY($2))
         AND NOT EXISTS (
           SELECT 1 FROM yzy_contracts.billing_renewal_periods p
           JOIN yzy_contracts.billing_transfer_reports r ON r.id = p.report_id
           WHERE p.invoice_id = i.id AND r.approved IS DISTINCT FROM false
         )
         AND (NOT i.renewal_generated
              OR i.period <= date_trunc('month', now() AT TIME ZONE 'America/Santo_Domingo')::date)
         FOR UPDATE",
    )
    .bind(id)
    .bind(accounts)
    .fetch_optional(db)
    .await?
    .ok_or(ApiError::BillingNotFound)?;
    Ok(())
}

pub async fn report_transfer(
    db: &mut PgConnection,
    invoice_id: Uuid,
    user_id: Uuid,
    reference: &str,
    months: i16,
    expected_total: Option<i64>,
) -> Result<(), ApiError> {
    let previous: Option<(String, i16)> = sqlx::query_as(
        "SELECT reference, months FROM yzy_contracts.billing_transfer_reports
         WHERE invoice_id = $1 AND approved IS DISTINCT FROM false",
    )
    .bind(invoice_id)
    .fetch_optional(&mut *db)
    .await?;
    if let Some((previous_reference, previous_months)) = previous {
        return if previous_reference == reference && previous_months == months {
            Ok(())
        } else {
            Err(ApiError::BillingConflict(
                "La factura ya tiene una transferencia reportada o pagada.",
            ))
        };
    }
    let monthly_amount: i64 = sqlx::query_scalar(
        "SELECT sum(unit_price_minor) FROM yzy_contracts.billing_invoice_lines WHERE invoice_id = $1",
    )
    .bind(invoice_id)
    .fetch_one(&mut *db)
    .await?;
    let subtotal = monthly_amount * i64::from(months);
    let discount = if months > 1 { subtotal / 10 } else { 0 };
    if months > 1 && expected_total.is_none()
        || expected_total.is_some_and(|amount| amount != subtotal - discount)
    {
        return Err(ApiError::BillingConflict(
            "El monto cambió. Actualiza Membresía y revisa el total antes de reportar.",
        ));
    }
    let future = if months > 1 {
        renewal_periods(db, invoice_id, months).await?
    } else {
        Vec::new()
    };
    let report_id: Uuid = sqlx::query_scalar(
        "INSERT INTO yzy_contracts.billing_transfer_reports (invoice_id, submitted_by, reference, months, discount_minor)
         VALUES ($1, $2, $3, $4, $5) RETURNING id",
    )
    .bind(invoice_id)
    .bind(user_id)
    .bind(reference)
    .bind(months)
    .bind(discount)
    .fetch_one(&mut *db)
    .await?;
    if !future.is_empty() {
        sqlx::query(
            "INSERT INTO yzy_contracts.billing_renewal_periods (report_id, period, invoice_id)
             SELECT $1, period, id FROM yzy_contracts.billing_invoices WHERE id = ANY($2)",
        )
        .bind(report_id)
        .bind(&future)
        .execute(db)
        .await?;
    }
    Ok(())
}

async fn renewal_periods(
    db: &mut PgConnection,
    invoice_id: Uuid,
    months: i16,
) -> Result<Vec<Uuid>, ApiError> {
    let (account_id, period, limit): (Uuid, NaiveDate, i16) = sqlx::query_as(
        "SELECT account_id, period, yzy_contracts.billing_renewal_month_limit(id)
         FROM yzy_contracts.billing_invoices WHERE id = $1",
    )
    .bind(invoice_id)
    .fetch_one(&mut *db)
    .await?;
    if months > limit {
        return Err(ApiError::BillingConflict(
            "Algunos meses ya están cubiertos o cambian las empresas de la cuenta. Actualiza Membresía y elige una duración disponible.",
        ));
    }
    let periods: Vec<NaiveDate> = (1..months)
        .map(|offset| {
            period
                .checked_add_months(Months::new(offset as u32))
                .ok_or_else(|| anyhow::anyhow!("invalid renewal period").into())
        })
        .collect::<Result<_, ApiError>>()?;
    sqlx::query(
        "WITH candidates AS MATERIALIZED (
           SELECT period, gen_random_uuid() AS id FROM unnest($3::date[]) AS months(period)
         ), issued AS (
           INSERT INTO yzy_contracts.billing_invoices (id, account_id, period, due_on, transfer_memo, renewal_generated)
           SELECT id, $1, period, period, 'YZY-' || replace(id::text, '-', ''), true FROM candidates
           ORDER BY period ON CONFLICT (account_id, period) DO NOTHING RETURNING id
         )
         INSERT INTO yzy_contracts.billing_invoice_lines (invoice_id, company_id, company_name, unit_price_minor)
         SELECT issued.id, l.company_id, l.company_name, l.unit_price_minor
         FROM issued CROSS JOIN yzy_contracts.billing_invoice_lines l WHERE l.invoice_id = $2",
    )
    .bind(account_id)
    .bind(invoice_id)
    .bind(&periods)
    .execute(&mut *db)
    .await?;
    let available: Vec<Uuid> = sqlx::query_scalar(
        "SELECT i.id FROM yzy_contracts.billing_invoices i
         WHERE i.account_id = $1 AND i.period = ANY($2) AND i.paid_at IS NULL
         ORDER BY i.period FOR UPDATE OF i",
    )
    .bind(account_id)
    .bind(&periods)
    .fetch_all(db)
    .await?;
    if available.len() != periods.len() {
        return Err(ApiError::BillingConflict(
            "Algunos meses elegidos ya tienen un pago o un monto distinto. Actualiza Membresía y selecciona otra duración.",
        ));
    }
    Ok(available)
}

pub async fn verify_transfer(
    db: &mut PgConnection,
    invoice_id: Uuid,
    report_id: Uuid,
    user_id: Uuid,
    approve: bool,
) -> Result<(), ApiError> {
    let previous: Option<bool> = sqlx::query_scalar(
        "SELECT approved FROM yzy_contracts.billing_transfer_reports WHERE id = $1 AND invoice_id = $2",
    )
    .bind(report_id)
    .bind(invoice_id)
    .fetch_optional(&mut *db)
    .await?
    .ok_or(ApiError::BillingNotFound)?;
    if let Some(previous) = previous {
        return if previous == approve {
            Ok(())
        } else {
            Err(ApiError::BillingConflict("Este reporte ya fue revisado."))
        };
    }
    sqlx::query(
        "UPDATE yzy_contracts.billing_transfer_reports SET approved = $3, verified_at = now(), verified_by = $4
         WHERE id = $1 AND invoice_id = $2",
    )
    .bind(report_id)
    .bind(invoice_id)
    .bind(approve)
    .bind(user_id)
    .execute(&mut *db)
    .await?;
    if approve {
        sqlx::query(
            "UPDATE yzy_contracts.billing_invoices SET paid_at = now()
             WHERE id = $1 OR id IN (
               SELECT invoice_id FROM yzy_contracts.billing_renewal_periods WHERE report_id = $2
             )",
        )
        .bind(invoice_id)
        .bind(report_id)
        .execute(db)
        .await?;
    } else {
        let drafts: Vec<Uuid> = sqlx::query_scalar(
            "SELECT i.id FROM yzy_contracts.billing_invoices i
             JOIN yzy_contracts.billing_renewal_periods p ON p.invoice_id = i.id
             WHERE p.report_id = $1 AND i.renewal_generated FOR UPDATE OF i",
        )
        .bind(report_id)
        .fetch_all(&mut *db)
        .await?;
        sqlx::query("DELETE FROM yzy_contracts.billing_invoice_lines WHERE invoice_id = ANY($1)")
            .bind(&drafts)
            .execute(&mut *db)
            .await?;
        sqlx::query("DELETE FROM yzy_contracts.billing_invoices WHERE id = ANY($1)")
            .bind(&drafts)
            .execute(db)
            .await?;
    }
    Ok(())
}
