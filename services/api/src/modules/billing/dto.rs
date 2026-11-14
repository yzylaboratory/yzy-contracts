use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;
use validator::Validate;

#[derive(Serialize, ToSchema)]
pub struct BillingAccount {
    pub id: Uuid,
    /// Dedicated company. Null for legacy accounts.
    pub company_id: Option<Uuid>,
    pub name: String,
    pub manager_user_id: Uuid,
    pub starts_on: NaiveDate,
    pub companies: Vec<BillingCompany>,
    pub monthly_total_minor: i64,
}

#[derive(Serialize, ToSchema, Deserialize)]
pub struct BillingCompany {
    pub id: Uuid,
    pub name: String,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum InvoiceState {
    Pending,
    InReview,
    Paid,
}

#[derive(Serialize, ToSchema, Deserialize)]
pub struct InvoiceLine {
    pub company_id: Uuid,
    pub company_name: String,
    pub unit_price_minor: i32,
}

#[derive(Serialize, ToSchema)]
pub struct BillingInvoice {
    pub id: Uuid,
    pub account_id: Uuid,
    pub account_name: String,
    pub period: NaiveDate,
    pub due_on: NaiveDate,
    pub state: InvoiceState,
    pub is_overdue: bool,
    pub total_minor: i64,
    pub months: i16,
    pub discount_minor: i64,
    pub renewal_month_limit: i16,
    pub transfer_memo: String,
    pub lines: Vec<InvoiceLine>,
    pub transfer_reference: Option<String>,
    pub transfer_report_id: Option<Uuid>,
    pub transfer_reported_at: Option<DateTime<Utc>>,
    pub paid_at: Option<DateTime<Utc>>,
}

#[derive(Clone, Serialize, ToSchema, sqlx::FromRow)]
pub struct BankAccount {
    pub bank_name: String,
    pub account_holder: String,
    pub account_type: String,
    pub account_number: String,
}

#[derive(Serialize, ToSchema)]
pub struct BankAccountSettings {
    #[schema(required = true)]
    pub bank_account: Option<BankAccount>,
    #[schema(required = true)]
    pub revision: Option<Uuid>,
    #[schema(required = true)]
    pub updated_at: Option<DateTime<Utc>>,
}

#[derive(Deserialize, ToSchema, Validate)]
#[serde(deny_unknown_fields)]
pub struct BankAccountInput {
    #[validate(length(min = 1, max = 120))]
    #[schema(min_length = 1, max_length = 120)]
    pub bank_name: String,
    #[validate(length(min = 1, max = 200))]
    #[schema(min_length = 1, max_length = 200)]
    pub account_holder: String,
    #[validate(length(min = 1, max = 60))]
    #[schema(min_length = 1, max_length = 60)]
    pub account_type: String,
    #[validate(length(min = 1, max = 64))]
    #[schema(min_length = 1, max_length = 64)]
    pub account_number: String,
    #[serde(deserialize_with = "Deserialize::deserialize")]
    #[schema(required = true)]
    pub expected_revision: Option<Uuid>,
}

#[derive(Serialize, ToSchema)]
pub struct BillingOverview {
    pub accounts: Vec<BillingAccount>,
    pub invoices: Vec<BillingInvoice>,
    pub bank_account: Option<BankAccount>,
}

#[derive(Serialize, ToSchema)]
pub struct BillingAccountList {
    pub items: Vec<BillingAccount>,
    pub page: i64,
    pub per_page: i64,
    pub total: i64,
}

#[derive(Serialize, ToSchema)]
pub struct BillingInvoiceList {
    pub items: Vec<BillingInvoice>,
    pub page: i64,
    pub per_page: i64,
    pub total: i64,
}

#[derive(Deserialize, ToSchema, Validate)]
pub struct AccountInput {
    #[validate(length(min = 1, max = 200))]
    pub name: String,
    pub manager_user_id: Uuid,
    #[validate(length(max = 100))]
    pub company_ids: Vec<Uuid>,
}

#[derive(Deserialize, ToSchema, Validate)]
pub struct CreateAccount {
    #[serde(flatten)]
    #[validate(nested)]
    pub account: AccountInput,
    pub starts_on: Option<NaiveDate>,
}

#[derive(Deserialize, ToSchema, Validate)]
#[serde(deny_unknown_fields)]
pub struct TransferInput {
    #[validate(length(min = 1, max = 100))]
    pub reference: String,
    #[validate(range(min = 1, max = 12))]
    #[schema(minimum = 1, maximum = 12)]
    pub months: Option<i16>,
    #[validate(range(min = 1))]
    #[schema(minimum = 1)]
    pub expected_total_minor: Option<i64>,
}

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum VerificationDecision {
    Confirm,
    Reject,
}

#[derive(Deserialize, ToSchema, Validate)]
#[serde(deny_unknown_fields)]
pub struct VerificationInput {
    pub decision: VerificationDecision,
    pub report_id: Uuid,
}
