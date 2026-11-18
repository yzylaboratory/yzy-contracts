use crate::modules::admin_pagination::PageQuery;
use chrono::{DateTime, Datelike, Months, NaiveDate, Utc};
use serde::Deserialize;
use sqlx::{PgConnection, PgExecutor, PgPool, types::Json};
use uuid::Uuid;

use super::dto::{
    AccountInput, BankAccount, BankAccountSettings, BillingAccount, BillingCompany, BillingInvoice,
    BillingPricing, CompanyPriceInput, InvoiceLine, InvoiceState,
};
use crate::error::ApiError;

/// Day-of-month offset from period (day 1): payment is due on day 10.
pub const DUE_DAY_OFFSET: i32 = 9;
/// Day-of-month offset from period: workspace suspension starts on day 15.
pub const SUSPEND_DAY_OFFSET: i32 = 14;
/// Day-of-month offset from period: first pending-payment reminder on day 7.
pub const REMINDER_DAY_OFFSET: i32 = 6;

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
         FROM billing_bank_destination WHERE id = 1",
    )
    .fetch_optional(executor)
    .await?;
    Ok(row.map(Into::into))
}

#[derive(sqlx::FromRow)]
struct PricingRow {
    price_usd_minor: i32,
    exchange_rate_milli: i32,
    unit_price_minor: i32,
    revision: Uuid,
    updated_at: DateTime<Utc>,
}

impl From<PricingRow> for BillingPricing {
    fn from(row: PricingRow) -> Self {
        Self {
            price_usd_minor: row.price_usd_minor,
            exchange_rate_milli: row.exchange_rate_milli,
            unit_price_minor: row.unit_price_minor,
            revision: Some(row.revision),
            updated_at: Some(row.updated_at),
        }
    }
}

pub async fn pricing(executor: impl PgExecutor<'_>) -> Result<BillingPricing, ApiError> {
    let row = sqlx::query_as::<_, PricingRow>(
        "SELECT price_usd_minor, exchange_rate_milli,
                billing_unit_price_minor(price_usd_minor, exchange_rate_milli) AS unit_price_minor,
                revision, updated_at
         FROM billing_pricing WHERE id = 1",
    )
    .fetch_one(executor)
    .await?;
    Ok(row.into())
}

pub async fn save_pricing(
    db: &PgPool,
    actor: Uuid,
    price_usd_minor: i32,
    exchange_rate_milli: i32,
    expected_revision: Option<Uuid>,
) -> Result<BillingPricing, ApiError> {
    let row = if let Some(revision) = expected_revision {
        sqlx::query_as::<_, PricingRow>(
            "UPDATE billing_pricing
             SET price_usd_minor = $1, exchange_rate_milli = $2,
                 updated_by = $3, updated_at = now(), revision = gen_random_uuid()
             WHERE id = 1 AND revision = $4
             RETURNING price_usd_minor, exchange_rate_milli,
                       billing_unit_price_minor(price_usd_minor, exchange_rate_milli) AS unit_price_minor,
                       revision, updated_at",
        )
        .bind(price_usd_minor)
        .bind(exchange_rate_milli)
        .bind(actor)
        .bind(revision)
        .fetch_optional(db)
        .await?
    } else {
        sqlx::query_as::<_, PricingRow>(
            "UPDATE billing_pricing
             SET price_usd_minor = $1, exchange_rate_milli = $2,
                 updated_by = $3, updated_at = now(), revision = gen_random_uuid()
             WHERE id = 1 AND updated_by IS NULL
             RETURNING price_usd_minor, exchange_rate_milli,
                       billing_unit_price_minor(price_usd_minor, exchange_rate_milli) AS unit_price_minor,
                       revision, updated_at",
        )
        .bind(price_usd_minor)
        .bind(exchange_rate_milli)
        .bind(actor)
        .fetch_optional(db)
        .await?
    };
    row.map(Into::into).ok_or(ApiError::BillingConflict(
        "El precio o la tasa cambiaron desde que los consultaste. Actualiza e inténtalo de nuevo.",
    ))
}

async fn apply_company_prices(
    db: &mut PgConnection,
    account_id: Uuid,
    prices: &[CompanyPriceInput],
) -> Result<(), ApiError> {
    for price in prices {
        if price.price_usd_minor.is_some_and(|amount| amount <= 0) {
            return Err(ApiError::Validation(
                "El precio por empresa debe ser mayor que cero.".to_owned(),
            ));
        }
        let updated = sqlx::query(
            "UPDATE billing_account_companies
             SET price_usd_minor = $3
             WHERE account_id = $1 AND company_id = $2 AND ends_on IS NULL",
        )
        .bind(account_id)
        .bind(price.company_id)
        .bind(price.price_usd_minor)
        .execute(&mut *db)
        .await?
        .rows_affected();
        if updated == 0 {
            return Err(ApiError::Validation(
                "Una de las empresas no pertenece a esta cuenta de facturación.".to_owned(),
            ));
        }
    }
    Ok(())
}

pub async fn save_bank_destination(
    db: &PgPool,
    actor: Uuid,
    account: BankAccount,
    expected_revision: Option<Uuid>,
) -> Result<BankAccountSettings, ApiError> {
    let row = if let Some(revision) = expected_revision {
        sqlx::query_as::<_, BankDestination>(
            "UPDATE billing_bank_destination
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
            "INSERT INTO billing_bank_destination
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
        "SELECT a.id FROM billing_accounts a
         WHERE $1::uuid IS NULL OR (
           EXISTS (
             SELECT 1 FROM billing_account_managers m
             WHERE m.account_id = a.id AND m.user_id = $1
           ) AND has_enabled_access($1)
         )
         ORDER BY a.id FOR SHARE",
    )
    .bind(manager)
    .fetch_all(executor)
    .await?)
}

async fn ensure_account_manager(
    db: &mut PgConnection,
    account_id: Uuid,
    previous_manager_id: Option<Uuid>,
    user_id: Uuid,
) -> Result<(), ApiError> {
    if let Some(previous) = previous_manager_id.filter(|previous| *previous != user_id) {
        sqlx::query(
            "DELETE FROM billing_account_managers
             WHERE account_id = $1 AND user_id = $2",
        )
        .bind(account_id)
        .bind(previous)
        .execute(&mut *db)
        .await?;
    }
    sqlx::query(
        "INSERT INTO billing_account_managers (account_id, user_id)
         VALUES ($1, $2) ON CONFLICT DO NOTHING",
    )
    .bind(account_id)
    .bind(user_id)
    .execute(&mut *db)
    .await?;
    Ok(())
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

const ACCOUNTS_ROWS: &str =
    "SELECT a.id, a.company_id, COALESCE(dedicated.name, a.name) AS name, a.manager_user_id,
           a.starts_on,
           COALESCE(jsonb_agg(jsonb_build_object(
               'id', c.id,
               'name', c.name,
               'price_usd_minor', ac.price_usd_minor,
               'unit_price_minor', billing_unit_price_minor(
                 COALESCE(ac.price_usd_minor, p.price_usd_minor), p.exchange_rate_milli)
             ) ORDER BY lower(c.name), c.id)
             FILTER (WHERE c.id IS NOT NULL), '[]'::jsonb) AS companies
         FROM billing_accounts a
         CROSS JOIN billing_pricing p
         LEFT JOIN companies dedicated ON dedicated.id = a.company_id
         LEFT JOIN billing_account_companies ac ON ac.account_id = a.id AND ac.ends_on IS NULL
         LEFT JOIN companies c ON c.id = ac.company_id
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
        let companies = row.companies.0;
        let monthly_total_minor = companies
            .iter()
            .map(|company| i64::from(company.unit_price_minor))
            .sum();
        Self {
            id: row.id,
            company_id: row.company_id,
            name: row.name,
            manager_user_id: row.manager_user_id,
            starts_on: row.starts_on,
            monthly_total_minor,
            companies,
        }
    }
}

pub async fn lock_assignments(db: &mut PgConnection) -> Result<(), sqlx::Error> {
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended('billing_assignments', 0))")
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
           INSERT INTO billing_accounts (company_id, name, manager_user_id, starts_on)
           VALUES ($1, $2, $3, (date_trunc('month', now() AT TIME ZONE 'America/Santo_Domingo') + interval '1 month')::date)
           RETURNING id, company_id, starts_on, manager_user_id
         ), linked AS (
           INSERT INTO billing_account_companies (account_id, company_id, starts_on)
           SELECT id, company_id, starts_on FROM created
         )
         INSERT INTO billing_account_managers (account_id, user_id)
         SELECT id, manager_user_id FROM created",
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
           DELETE FROM billing_account_companies ac USING billing_accounts a, next_month n
           WHERE a.company_id = $1 AND ac.account_id = a.id AND ac.ends_on IS NULL AND ac.starts_on >= n.starts_on
         )
         UPDATE billing_account_companies ac SET ends_on = n.starts_on
         FROM billing_accounts a, next_month n
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
        "INSERT INTO billing_account_companies (account_id, company_id, starts_on)
         SELECT a.id, a.company_id,
           GREATEST(
             a.starts_on,
             (date_trunc('month', now() AT TIME ZONE 'America/Santo_Domingo') + interval '1 month')::date,
             (SELECT max(ac.ends_on) FROM billing_account_companies ac WHERE ac.company_id = a.company_id)
           )
         FROM billing_accounts a WHERE a.company_id = $1
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
    let manager_enabled: bool = sqlx::query_scalar("SELECT has_enabled_access($1)")
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

    let mut previous_manager_id = None;
    let effective = if let Some(account_id) = id {
        let (start, dedicated_company, current_manager): (NaiveDate, Option<Uuid>, Uuid) =
            sqlx::query_as(
                "SELECT starts_on, company_id, manager_user_id
                 FROM billing_accounts WHERE id = $1 FOR UPDATE",
            )
            .bind(account_id)
            .fetch_optional(&mut *tx)
            .await?
            .ok_or(ApiError::BillingNotFound)?;
        previous_manager_id = Some(current_manager);
        if let Some(company_id) = dedicated_company {
            let assigned: Vec<Uuid> = sqlx::query_scalar(
                "SELECT company_id FROM billing_account_companies WHERE account_id = $1 AND ends_on IS NULL",
            )
            .bind(account_id)
            .fetch_all(&mut *tx)
            .await?;
            if assigned != input.company_ids {
                return Err(ApiError::BillingConflict(
                    "La cuenta pertenece a su empresa. Archiva la empresa para detener futuros cobros.",
                ));
            }
            sqlx::query("UPDATE billing_accounts SET manager_user_id = $2 WHERE id = $1 AND company_id = $3")
                .bind(account_id)
                .bind(input.manager_user_id)
                .bind(company_id)
                .execute(&mut *tx)
                .await?;
            ensure_account_manager(
                &mut tx,
                account_id,
                previous_manager_id,
                input.manager_user_id,
            )
            .await?;
            apply_company_prices(&mut tx, account_id, &input.company_prices).await?;
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
        "SELECT id FROM companies
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
           SELECT 1 FROM billing_account_companies
           WHERE company_id = ANY($1) AND ($2::uuid IS NULL OR account_id <> $2)
             AND (ends_on IS NULL OR ends_on > $3)
         ) OR EXISTS (
           SELECT 1 FROM billing_accounts WHERE company_id = ANY($1)
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
               SELECT 1 FROM billing_invoices i
               WHERE i.account_id = $1 AND i.period >= $2 AND (
                 NOT i.renewal_generated OR EXISTS (
                   SELECT 1 FROM billing_renewal_periods p
                   JOIN billing_transfer_reports r ON r.id = p.report_id
                   WHERE p.invoice_id = i.id AND r.approved IS DISTINCT FROM false
                 )
               )
             ) AND $3 <> ARRAY(
               SELECT company_id FROM billing_account_companies
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
        sqlx::query("UPDATE billing_accounts SET name = $2, manager_user_id = $3 WHERE id = $1")
            .bind(account_id)
            .bind(name)
            .bind(input.manager_user_id)
            .execute(&mut *tx)
            .await?;
        sqlx::query(
            "DELETE FROM billing_account_companies
             WHERE account_id = $1 AND starts_on >= $2 AND ends_on IS NULL AND NOT (company_id = ANY($3))",
        )
        .bind(account_id)
        .bind(effective)
        .bind(&companies)
        .execute(&mut *tx)
        .await?;
        sqlx::query(
            "UPDATE billing_account_companies SET ends_on = $2
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
            "INSERT INTO billing_accounts (name, manager_user_id, starts_on)
             VALUES ($1, $2, $3) RETURNING id",
        )
        .bind(name)
        .bind(input.manager_user_id)
        .bind(effective)
        .fetch_one(&mut *tx)
        .await?
    };
    ensure_account_manager(
        &mut tx,
        account_id,
        previous_manager_id,
        input.manager_user_id,
    )
    .await?;
    sqlx::query(
        "INSERT INTO billing_account_companies (account_id, company_id, starts_on)
         SELECT $1, selected.company_id, $3 FROM unnest($2::uuid[]) AS selected(company_id)
         WHERE NOT EXISTS (
           SELECT 1 FROM billing_account_companies ac
           WHERE ac.account_id = $1 AND ac.company_id = selected.company_id AND ac.ends_on IS NULL
         )",
    )
    .bind(account_id)
    .bind(&companies)
    .bind(effective)
    .execute(&mut *tx)
    .await?;
    apply_company_prices(&mut tx, account_id, &input.company_prices).await?;
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
           SELECT COALESCE($3::date, date_trunc('month', CURRENT_TIMESTAMP AT TIME ZONE 'America/Santo_Domingo')::date) AS starts_on
         ), billable AS MATERIALIZED (
           SELECT ac.account_id, ac.company_id, c.name AS company_name, month.period::date AS period,
                  billing_unit_price_minor(
                    COALESCE(ac.price_usd_minor, p.price_usd_minor), p.exchange_rate_milli
                  ) AS unit_price_minor
           FROM billing_account_companies ac
           JOIN companies c ON c.id = ac.company_id
           CROSS JOIN billing_pricing p
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
               SELECT 1 FROM billing_account_companies relevant
               WHERE relevant.account_id = ac.account_id AND relevant.company_id = ANY($2)
                 AND relevant.starts_on <= month.period
                 AND (relevant.ends_on IS NULL OR relevant.ends_on > month.period)
             ))
         ), missing AS MATERIALIZED (
           SELECT DISTINCT b.account_id, b.period FROM billable b
           WHERE NOT EXISTS (SELECT 1 FROM billing_invoices i
                             WHERE i.account_id = b.account_id AND i.period = b.period)
         ), candidates AS MATERIALIZED (
           SELECT account_id, period, gen_random_uuid() AS id FROM missing
         ), issued AS (
           INSERT INTO billing_invoices (id, account_id, period, due_on, transfer_memo)
           SELECT id, account_id, period, (period + ($4::int * interval '1 day'))::date,
                  'YZY-' || replace(id::text, '-', '') FROM candidates
           ORDER BY account_id, period
           ON CONFLICT (account_id, period) DO NOTHING RETURNING id, account_id, period
         )
         INSERT INTO billing_invoice_lines (invoice_id, company_id, company_name, unit_price_minor)
         SELECT i.id, b.company_id, b.company_name, b.unit_price_minor
         FROM issued i JOIN billable b USING (account_id, period)",
    )
    .bind(accounts)
    .bind(companies)
    .bind(until)
    .bind(DUE_DAY_OFFSET)
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
            ((SELECT max(i.period) FROM billing_invoices i
              WHERE i.account_id = a.id AND i.paid_at IS NOT NULL) + interval '1 month')::date)
         FROM billing_accounts a WHERE a.id = $1",
    )
    .bind(account_id)
    .fetch_one(&mut *db)
    .await?;
    let has_companies: bool = sqlx::query_scalar(
        "SELECT EXISTS (
           SELECT 1 FROM billing_account_companies ac
           JOIN companies c ON c.id = ac.company_id AND c.archived_at IS NULL
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
        "UPDATE billing_invoices SET renewal_generated = false
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
           CASE WHEN i.paid_at IS NULL AND r.id IS NULL THEN billing_renewal_month_limit(i.id)
                ELSE 1::smallint END AS renewal_month_limit,
           i.transfer_memo, l.lines, r.reference AS transfer_reference,
           r.id AS transfer_report_id, r.submitted_at AS transfer_reported_at, i.paid_at
         FROM billing_invoices i
         JOIN billing_accounts a ON a.id = i.account_id
         LEFT JOIN companies dedicated ON dedicated.id = a.company_id
         JOIN LATERAL (
           SELECT sum(unit_price_minor) AS total_minor,
             jsonb_agg(jsonb_build_object('company_id', company_id, 'company_name', company_name,
               'unit_price_minor', unit_price_minor) ORDER BY lower(company_name), company_id) AS lines
           FROM billing_invoice_lines WHERE invoice_id = i.id
         ) l ON true
         LEFT JOIN billing_transfer_reports r
           ON r.invoice_id = i.id AND r.approved IS DISTINCT FROM false
         WHERE ($1::uuid[] IS NULL OR i.account_id = ANY($1)) AND ($2::uuid IS NULL OR i.id = $2)
           AND (NOT i.renewal_generated OR r.id IS NOT NULL
                OR i.period <= date_trunc('month', now() AT TIME ZONE 'America/Santo_Domingo')::date)
           AND NOT EXISTS (
             SELECT 1 FROM billing_renewal_periods p
             JOIN billing_transfer_reports reserved ON reserved.id = p.report_id
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
        "SELECT i.id FROM billing_invoices i WHERE i.id = $1
         AND ($2::uuid[] IS NULL OR i.account_id = ANY($2))
         AND NOT EXISTS (
           SELECT 1 FROM billing_renewal_periods p
           JOIN billing_transfer_reports r ON r.id = p.report_id
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
        "SELECT reference, months FROM billing_transfer_reports
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
        "SELECT sum(unit_price_minor) FROM billing_invoice_lines WHERE invoice_id = $1",
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
        "INSERT INTO billing_transfer_reports (invoice_id, submitted_by, reference, months, discount_minor)
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
            "INSERT INTO billing_renewal_periods (report_id, period, invoice_id)
             SELECT $1, period, id FROM billing_invoices WHERE id = ANY($2)",
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
        "SELECT account_id, period, billing_renewal_month_limit(id)
         FROM billing_invoices WHERE id = $1",
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
           INSERT INTO billing_invoices (id, account_id, period, due_on, transfer_memo, renewal_generated)
           SELECT id, $1, period, (period + ($4::int * interval '1 day'))::date,
                  'YZY-' || replace(id::text, '-', ''), true FROM candidates
           ORDER BY period ON CONFLICT (account_id, period) DO NOTHING RETURNING id
         )
         INSERT INTO billing_invoice_lines (invoice_id, company_id, company_name, unit_price_minor)
         SELECT issued.id, l.company_id, l.company_name, l.unit_price_minor
         FROM issued CROSS JOIN billing_invoice_lines l WHERE l.invoice_id = $2",
    )
    .bind(account_id)
    .bind(invoice_id)
    .bind(&periods)
    .bind(DUE_DAY_OFFSET)
    .execute(&mut *db)
    .await?;
    let available: Vec<Uuid> = sqlx::query_scalar(
        "SELECT i.id FROM billing_invoices i
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
        "SELECT approved FROM billing_transfer_reports WHERE id = $1 AND invoice_id = $2",
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
        "UPDATE billing_transfer_reports SET approved = $3, verified_at = now(), verified_by = $4
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
            "UPDATE billing_invoices SET paid_at = now()
             WHERE id = $1 OR id IN (
               SELECT invoice_id FROM billing_renewal_periods WHERE report_id = $2
             )",
        )
        .bind(invoice_id)
        .bind(report_id)
        .execute(db)
        .await?;
    } else {
        let drafts: Vec<Uuid> = sqlx::query_scalar(
            "SELECT i.id FROM billing_invoices i
             JOIN billing_renewal_periods p ON p.invoice_id = i.id
             WHERE p.report_id = $1 AND i.renewal_generated FOR UPDATE OF i",
        )
        .bind(report_id)
        .fetch_all(&mut *db)
        .await?;
        sqlx::query("DELETE FROM billing_invoice_lines WHERE invoice_id = ANY($1)")
            .bind(&drafts)
            .execute(&mut *db)
            .await?;
        sqlx::query("DELETE FROM billing_invoices WHERE id = ANY($1)")
            .bind(&drafts)
            .execute(db)
            .await?;
    }
    Ok(())
}

pub async fn claim_daily_maintenance(db: &PgPool) -> Result<bool, ApiError> {
    let claimed: Option<(String,)> = sqlx::query_as(
        "INSERT INTO billing_job_runs (job, run_on)
         SELECT 'daily_maintenance', (CURRENT_TIMESTAMP AT TIME ZONE 'America/Santo_Domingo')::date
         WHERE NOT EXISTS (
           SELECT 1 FROM billing_job_runs
           WHERE job = 'daily_maintenance'
             AND run_on = (CURRENT_TIMESTAMP AT TIME ZONE 'America/Santo_Domingo')::date
         )
         ON CONFLICT (job) DO UPDATE
           SET run_on = EXCLUDED.run_on, finished_at = now()
           WHERE billing_job_runs.run_on < EXCLUDED.run_on
         RETURNING job",
    )
    .fetch_optional(db)
    .await?;
    Ok(claimed.is_some())
}

pub async fn enqueue_due_reminders(db: &PgPool) -> Result<u64, ApiError> {
    sqlx::query(
        "UPDATE billing_reminders r
         SET sent_at = COALESCE(sent_at, now()), last_error = COALESCE(last_error, 'cancelled')
         WHERE r.sent_at IS NULL
           AND EXISTS (
             SELECT 1 FROM billing_invoices i
             WHERE i.id = r.invoice_id
               AND (
                 i.paid_at IS NOT NULL
                 OR EXISTS (
                   SELECT 1 FROM billing_transfer_reports tr
                   WHERE tr.invoice_id = i.id AND tr.approved IS DISTINCT FROM false
                 )
               )
           )",
    )
    .execute(db)
    .await?;
    let result = sqlx::query(
        "WITH today AS (
           SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'America/Santo_Domingo')::date AS day
         ), targets AS (
           SELECT i.id AS invoice_id, kind.kind, today.day AS scheduled_for
           FROM billing_invoices i
           CROSS JOIN today
           CROSS JOIN LATERAL (VALUES
             ('issued', i.period),
             ('reminder', (i.period + ($1::int * interval '1 day'))::date),
             ('due', i.due_on),
             ('overdue', (i.due_on + interval '1 day')::date)
           ) AS kind(kind, on_day)
           WHERE i.paid_at IS NULL
             AND NOT EXISTS (
               SELECT 1 FROM billing_transfer_reports r
               WHERE r.invoice_id = i.id AND r.approved IS DISTINCT FROM false
             )
             AND kind.on_day <= today.day
             AND i.period <= today.day
         )
         INSERT INTO billing_reminders (invoice_id, kind, scheduled_for)
         SELECT invoice_id, kind, scheduled_for FROM targets
         ON CONFLICT (invoice_id, kind) DO NOTHING",
    )
    .bind(REMINDER_DAY_OFFSET)
    .execute(db)
    .await?;
    Ok(result.rows_affected())
}

#[derive(Debug, sqlx::FromRow)]
pub struct ReminderJob {
    pub id: Uuid,
    pub invoice_id: Uuid,
    pub kind: String,
    pub account_name: String,
    pub due_on: NaiveDate,
    pub total_minor: i64,
    pub manager_user_id: Uuid,
    pub manager_email: Option<String>,
    pub transfer_memo: String,
}

pub async fn claim_reminder(db: &PgPool) -> Result<Option<ReminderJob>, ApiError> {
    Ok(sqlx::query_as(
        "WITH next AS (
           SELECT r.id
           FROM billing_reminders r
           WHERE r.sent_at IS NULL AND r.next_attempt_at <= now() AND r.attempts < 8
           ORDER BY r.next_attempt_at, r.id
           FOR UPDATE SKIP LOCKED
           LIMIT 1
         ), claimed AS (
           UPDATE billing_reminders r
           SET attempts = r.attempts + 1,
               next_attempt_at = now() + interval '15 minutes'
           FROM next WHERE r.id = next.id
           RETURNING r.id, r.invoice_id, r.kind
         )
         SELECT c.id, c.invoice_id, c.kind, COALESCE(dedicated.name, a.name) AS account_name,
                i.due_on, lines.total_minor, a.manager_user_id,
                confirmed_identity_email(a.manager_user_id) AS manager_email,
                i.transfer_memo
         FROM claimed c
         JOIN billing_invoices i ON i.id = c.invoice_id
         JOIN billing_accounts a ON a.id = i.account_id
         LEFT JOIN companies dedicated ON dedicated.id = a.company_id
         JOIN LATERAL (
           SELECT COALESCE(sum(unit_price_minor), 0)::bigint AS total_minor
           FROM billing_invoice_lines WHERE invoice_id = i.id
         ) lines ON true
         WHERE i.paid_at IS NULL
           AND NOT EXISTS (
             SELECT 1 FROM billing_transfer_reports r
             WHERE r.invoice_id = i.id AND r.approved IS DISTINCT FROM false
           )",
    )
    .fetch_optional(db)
    .await?)
}

pub async fn mark_reminder_sent(db: &PgPool, id: Uuid) -> Result<(), ApiError> {
    sqlx::query(
        "UPDATE billing_reminders
         SET sent_at = now(), last_error = NULL WHERE id = $1",
    )
    .bind(id)
    .execute(db)
    .await?;
    Ok(())
}

pub async fn mark_reminder_failed(db: &PgPool, id: Uuid, error: &str) -> Result<(), ApiError> {
    sqlx::query("UPDATE billing_reminders SET last_error = $2 WHERE id = $1")
        .bind(id)
        .bind(error)
        .execute(db)
        .await?;
    Ok(())
}

pub async fn suspended_company_ids(db: &PgPool) -> Result<Vec<Uuid>, ApiError> {
    Ok(
        sqlx::query_scalar("SELECT company_id FROM billing_suspended_companies()")
            .fetch_all(db)
            .await?,
    )
}

#[derive(Debug, sqlx::FromRow)]
pub struct PendingAlertRow {
    pub invoice_id: Uuid,
    pub account_name: String,
    pub due_on: NaiveDate,
    pub period: NaiveDate,
    pub total_minor: i64,
    pub today: NaiveDate,
}

pub async fn pending_alert_for_manager(
    db: &PgPool,
    user_id: Uuid,
) -> Result<Option<PendingAlertRow>, ApiError> {
    Ok(sqlx::query_as(
        "SELECT i.id AS invoice_id, COALESCE(dedicated.name, a.name) AS account_name,
                i.due_on, i.period, lines.total_minor,
                (CURRENT_TIMESTAMP AT TIME ZONE 'America/Santo_Domingo')::date AS today
         FROM billing_invoices i
         JOIN billing_accounts a ON a.id = i.account_id
         LEFT JOIN companies dedicated ON dedicated.id = a.company_id
         JOIN billing_account_managers m ON m.account_id = a.id AND m.user_id = $1
         JOIN LATERAL (
           SELECT COALESCE(sum(unit_price_minor), 0)::bigint AS total_minor
           FROM billing_invoice_lines WHERE invoice_id = i.id
         ) lines ON true
         WHERE i.paid_at IS NULL
           AND NOT EXISTS (
             SELECT 1 FROM billing_transfer_reports r
             WHERE r.invoice_id = i.id AND r.approved IS DISTINCT FROM false
           )
           AND (CURRENT_TIMESTAMP AT TIME ZONE 'America/Santo_Domingo')::date
               >= (i.period + ($2::int * interval '1 day'))::date
         ORDER BY i.due_on, i.period, i.id
         LIMIT 1",
    )
    .bind(user_id)
    .bind(REMINDER_DAY_OFFSET)
    .fetch_optional(db)
    .await?)
}
