use chrono::{DateTime, Datelike, Months, NaiveDate, Utc};
use serde::{Deserialize, Deserializer, Serialize};
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;
use validator::Validate;

use crate::error::ApiError;

const MAX_AMOUNT_MINOR: i64 = 9_007_199_254_740_991;

#[derive(Debug, Deserialize, Validate, IntoParams)]
#[serde(deny_unknown_fields)]
#[into_params(parameter_in = Query)]
pub(super) struct ListClients {
    #[serde(default = "default_page")]
    #[validate(range(min = 1))]
    #[param(minimum = 1, default = 1)]
    pub page: i64,
    #[serde(default = "default_per_page")]
    #[validate(range(min = 1, max = 100))]
    #[param(minimum = 1, maximum = 100, default = 20)]
    pub per_page: i64,
    #[validate(length(max = 200))]
    pub q: Option<String>,
}

#[derive(Debug, Deserialize, Validate, IntoParams)]
#[serde(deny_unknown_fields)]
#[into_params(parameter_in = Query)]
pub(super) struct ListCases {
    /// Company that owns the case files. Clients are global; expedientes are not.
    pub company_id: Uuid,
    #[serde(default = "default_page")]
    #[validate(range(min = 1))]
    #[param(minimum = 1, default = 1)]
    pub page: i64,
    #[serde(default = "default_per_page")]
    #[validate(range(min = 1, max = 100))]
    #[param(minimum = 1, maximum = 100, default = 20)]
    pub per_page: i64,
    #[validate(length(max = 200))]
    pub q: Option<String>,
}

fn default_page() -> i64 {
    1
}

fn default_per_page() -> i64 {
    20
}

#[derive(Debug, Deserialize, Serialize, ToSchema, sqlx::FromRow)]
pub(super) struct Client {
    pub id: Uuid,
    pub name: String,
    pub identity: Option<String>,
    pub address: Option<String>,
    pub phone: Option<String>,
    pub email: Option<String>,
    pub income_source: Option<String>,
    #[sqlx(json(nullable))]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub profile: Option<ClientProfile>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, ToSchema)]
pub(super) struct ClientPage {
    pub items: Vec<Client>,
    pub total: i64,
    pub page: i64,
    pub per_page: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize, ToSchema, sqlx::Type)]
#[serde(rename_all = "snake_case")]
#[sqlx(type_name = "text", rename_all = "snake_case")]
#[derive(Default)]
pub enum OperationStatus {
    #[default]
    Solicitud,
    EnProceso,
    Firma,
    Desembolso,
    Cerrado,
}

#[derive(Debug, Deserialize, Serialize, ToSchema)]
pub(super) struct CaseListItem {
    pub id: Uuid,
    pub client_id: Uuid,
    pub client_name: String,
    #[schema(required = true)]
    pub client_identity: Option<String>,
    pub company_id: Uuid,
    pub company_name: String,
    #[schema(required = true)]
    pub reference: Option<String>,
    #[schema(required = true)]
    pub contract_date: Option<NaiveDate>,
    pub status: OperationStatus,
    pub vehicle: Vehicle,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, ToSchema)]
pub(super) struct CasePage {
    pub items: Vec<CaseListItem>,
    pub total: i64,
    pub page: i64,
    pub per_page: i64,
}

#[derive(Debug, Deserialize, Validate, IntoParams)]
#[serde(deny_unknown_fields)]
#[into_params(parameter_in = Query)]
pub(super) struct ListTimeline {
    #[serde(default = "default_page")]
    #[validate(range(min = 1))]
    #[param(minimum = 1, default = 1)]
    pub page: i64,
    #[serde(default = "default_per_page")]
    #[validate(range(min = 1, max = 100))]
    #[param(minimum = 1, maximum = 100, default = 20)]
    pub per_page: i64,
    /// Return only events and generated documents for this operation.
    pub operation_id: Option<Uuid>,
}

#[derive(Debug, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
enum TimelineKind {
    ClientCreated,
    ClientUpdated,
    OperationCreated,
    OperationUpdated,
    DocumentGenerated,
}

#[derive(Debug, Deserialize, Serialize, ToSchema)]
pub(super) struct ClientTimelineEvent {
    /// Event ID. Together with kind it identifies the event.
    id: Uuid,
    kind: TimelineKind,
    occurred_at: DateTime<Utc>,
    #[schema(required = true)]
    operation_label: Option<String>,
    #[schema(required = true)]
    document_name: Option<String>,
    #[schema(required = true)]
    actor_name: Option<String>,
    changes: Vec<TimelineChange>,
}

#[derive(Debug, Deserialize, Serialize, ToSchema)]
pub(super) struct TimelineChange {
    pub field: String,
    /// Original field value. An unset field is JSON null.
    pub before: serde_json::Value,
    /// New field value. An unset field is JSON null.
    pub after: serde_json::Value,
}

#[derive(Debug, Serialize, ToSchema)]
pub(super) struct ClientTimelinePage {
    pub items: Vec<ClientTimelineEvent>,
    pub total: i64,
    pub page: i64,
    pub per_page: i64,
}

#[derive(Debug, Deserialize, Validate, ToSchema)]
#[serde(deny_unknown_fields)]
pub(super) struct ClientWrite {
    #[schema(min_length = 1, max_length = 200)]
    pub name: String,
    pub identity: Option<String>,
    pub address: Option<String>,
    pub phone: Option<String>,
    pub email: Option<String>,
    pub income_source: Option<String>,
    pub profile: Option<ClientProfile>,
}

#[derive(Debug, Deserialize, Validate, ToSchema)]
#[serde(deny_unknown_fields)]
pub(super) struct ClientPatch {
    #[serde(default, deserialize_with = "non_null_patch")]
    #[schema(nullable = false, min_length = 1, max_length = 200)]
    pub name: Option<String>,
    #[serde(default, deserialize_with = "nullable_patch")]
    #[schema(value_type = Option<String>)]
    pub identity: Option<Option<String>>,
    #[serde(default, deserialize_with = "nullable_patch")]
    #[schema(value_type = Option<String>)]
    pub address: Option<Option<String>>,
    #[serde(default, deserialize_with = "nullable_patch")]
    #[schema(value_type = Option<String>)]
    pub phone: Option<Option<String>>,
    #[serde(default, deserialize_with = "nullable_patch")]
    #[schema(value_type = Option<String>)]
    pub email: Option<Option<String>>,
    #[serde(default, deserialize_with = "nullable_patch")]
    #[schema(value_type = Option<String>)]
    pub income_source: Option<Option<String>>,
    #[serde(default, deserialize_with = "nullable_patch")]
    #[schema(value_type = Option<ClientProfile>)]
    pub profile: Option<Option<ClientProfile>>,
}

impl From<ClientWrite> for ClientPatch {
    fn from(body: ClientWrite) -> Self {
        Self {
            name: Some(body.name),
            identity: Some(body.identity),
            address: Some(body.address),
            phone: Some(body.phone),
            email: Some(body.email),
            income_source: Some(body.income_source),
            profile: Some(body.profile),
        }
    }
}

impl ClientPatch {
    pub fn normalize(&mut self) -> Result<(), ApiError> {
        if let Some(name) = &mut self.name {
            normalize_text("name", name, 200)?;
            if name.is_empty() {
                return Err(invalid("name"));
            }
        }
        for (field, value, max) in [
            ("identity", &mut self.identity, 64),
            ("address", &mut self.address, 1000),
            ("phone", &mut self.phone, 80),
            ("email", &mut self.email, 254),
            ("income_source", &mut self.income_source, 1000),
        ] {
            if let Some(value) = value {
                normalize_optional_text(field, value, max)?;
            }
        }
        // Client data is recorded in uppercase, as it appears in contracts.
        // Email keeps its case.
        if let Some(name) = &mut self.name {
            *name = name.to_uppercase();
        }
        for value in [
            &mut self.identity,
            &mut self.address,
            &mut self.income_source,
        ]
        .into_iter()
        .flatten()
        {
            uppercase(value);
        }
        if let Some(Some(profile)) = &mut self.profile {
            profile.normalize()?;
        }
        Ok(())
    }
}

fn uppercase(value: &mut Option<String>) {
    if let Some(text) = value {
        *text = text.to_uppercase();
    }
}

#[derive(Debug, Deserialize, Serialize, ToSchema, sqlx::FromRow)]
pub(super) struct Operation {
    pub id: Uuid,
    pub company_id: Uuid,
    pub client_id: Uuid,
    /// Optional source contract used when a document needs a base clause.
    #[schema(required = true)]
    pub contract_id: Option<Uuid>,
    pub reference: Option<String>,
    pub contract_date: Option<NaiveDate>,
    pub signature_date: Option<NaiveDate>,
    pub status: OperationStatus,
    #[sqlx(json)]
    pub vehicle: Vehicle,
    #[sqlx(json(nullable))]
    pub financing: Option<Financing>,
    #[sqlx(json(nullable))]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub application: Option<CaseApplication>,
    #[schema(minimum = 1, maximum = 9_007_199_254_740_991_i64)]
    pub insurance_installment_minor: Option<i64>,
    pub insurance_paid: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize, Validate, ToSchema)]
#[serde(deny_unknown_fields)]
pub(super) struct OperationWrite {
    pub company_id: Uuid,
    pub contract_id: Option<Uuid>,
    /// Optional manual reference for legacy callers. Omit it to assign a stable company abbreviation and sequence.
    pub reference: Option<String>,
    #[schema(value_type = Option<NaiveDate>)]
    pub contract_date: Option<CalendarDate>,
    #[schema(value_type = Option<NaiveDate>)]
    pub signature_date: Option<CalendarDate>,
    /// Defaults to `solicitud` when omitted.
    #[serde(default)]
    pub status: Option<OperationStatus>,
    pub vehicle: Vehicle,
    pub financing: Option<Financing>,
    pub application: Option<CaseApplication>,
    #[schema(minimum = 1, maximum = 9_007_199_254_740_991_i64)]
    pub insurance_installment_minor: Option<i64>,
    /// True when insurance is already paid in full and insurance documents should be omitted.
    #[serde(default)]
    pub insurance_paid: Option<bool>,
}

#[derive(Debug, Deserialize, Validate, ToSchema)]
#[serde(deny_unknown_fields)]
pub(super) struct OperationPatch {
    #[serde(default, deserialize_with = "nullable_patch")]
    #[schema(value_type = Option<Uuid>)]
    pub contract_id: Option<Option<Uuid>>,
    /// Changes to legacy manual references. Automatically assigned references are immutable.
    #[serde(default, deserialize_with = "nullable_patch")]
    #[schema(value_type = Option<String>)]
    pub reference: Option<Option<String>>,
    #[serde(default, deserialize_with = "nullable_patch")]
    #[schema(value_type = Option<NaiveDate>)]
    pub contract_date: Option<Option<CalendarDate>>,
    #[serde(default, deserialize_with = "nullable_patch")]
    #[schema(value_type = Option<NaiveDate>)]
    pub signature_date: Option<Option<CalendarDate>>,
    #[serde(default, deserialize_with = "non_null_patch")]
    #[schema(nullable = false)]
    pub status: Option<OperationStatus>,
    #[serde(default, deserialize_with = "non_null_patch")]
    #[schema(nullable = false)]
    pub vehicle: Option<Vehicle>,
    #[serde(default, deserialize_with = "nullable_patch")]
    #[schema(value_type = Option<Financing>)]
    pub financing: Option<Option<Financing>>,
    /// Amounts in cents for the selected extraordinary payments, in order from signing. Each amount schedules one payment at a four-month interval before the final installment. Zero marks a pending amount.
    #[serde(default, deserialize_with = "non_null_patch")]
    #[schema(max_items = 299, nullable = false)]
    #[validate(length(max = 299))]
    pub extraordinary_payment_amounts_minor: Option<Vec<i64>>,
    #[serde(default, deserialize_with = "nullable_patch")]
    #[schema(value_type = Option<CaseApplication>)]
    pub application: Option<Option<CaseApplication>>,
    #[serde(default, deserialize_with = "nullable_patch")]
    #[schema(value_type = Option<i64>, minimum = 1, maximum = 9_007_199_254_740_991_i64)]
    pub insurance_installment_minor: Option<Option<i64>>,
    #[serde(default, deserialize_with = "non_null_patch")]
    #[schema(nullable = false)]
    pub insurance_paid: Option<bool>,
}

impl From<OperationWrite> for OperationPatch {
    fn from(body: OperationWrite) -> Self {
        Self {
            contract_id: Some(body.contract_id),
            reference: Some(body.reference),
            contract_date: Some(body.contract_date),
            signature_date: Some(body.signature_date),
            status: Some(body.status.unwrap_or_default()),
            vehicle: Some(body.vehicle),
            financing: Some(body.financing),
            extraordinary_payment_amounts_minor: None,
            application: Some(body.application),
            insurance_installment_minor: Some(body.insurance_installment_minor),
            insurance_paid: Some(body.insurance_paid.unwrap_or(false)),
        }
    }
}

impl OperationPatch {
    pub fn normalize(&mut self) -> Result<(), ApiError> {
        if let Some(reference) = &mut self.reference {
            normalize_optional_text("reference", reference, 200)?;
        }
        if let Some(vehicle) = &mut self.vehicle {
            vehicle.normalize()?;
        }
        if let Some(Some(financing)) = &self.financing {
            financing.check()?;
        }
        if let Some(Some(application)) = &mut self.application {
            application.normalize()?;
        }
        if let Some(Some(amount)) = self.insurance_installment_minor
            && !(1..=MAX_AMOUNT_MINOR).contains(&amount)
        {
            return Err(invalid("insurance_installment_minor"));
        }
        Ok(())
    }
}

#[derive(Debug, Default, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub(crate) struct ClientProfile {
    #[serde(skip_serializing_if = "Option::is_none")]
    treatment: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    nationality: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    marital_status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    spouse_not_applicable: Option<bool>,
    owns_home: Option<bool>,
    rents_home: Option<bool>,
    owns_vehicle: Option<bool>,
    employer: Option<String>,
    work_address: Option<String>,
    work_phone: Option<String>,
    position: Option<String>,
    employment_duration: Option<String>,
    fixed_income: Option<String>,
    other_income: Option<String>,
    other_income_source: Option<String>,
    pay_days: Option<String>,
    spouse: Option<CaseSpouse>,
    #[serde(default)]
    #[schema(max_items = 3)]
    family_references: Vec<CaseReference>,
    #[serde(default)]
    #[schema(max_items = 2)]
    personal_references: Vec<CaseReference>,
}

impl ClientProfile {
    /// Fills a prospect's legacy flat nationality/marital_status/position
    /// into this profile wherever it has no value of its own, so a canonical
    /// profile's own fields always win over the pre-profile columns.
    pub(crate) fn merge_legacy(
        mut self,
        nationality: Option<String>,
        marital_status: Option<String>,
        position: Option<String>,
    ) -> Self {
        if self.nationality.is_none() {
            self.nationality = nationality;
        }
        if self.marital_status.is_none() {
            self.marital_status = marital_status;
        }
        if self.position.is_none() {
            self.position = position;
        }
        self
    }

    pub(crate) fn normalize(&mut self) -> Result<(), ApiError> {
        for (field, value, limit) in [
            ("treatment", &mut self.treatment, 80),
            ("nationality", &mut self.nationality, 120),
            ("marital_status", &mut self.marital_status, 80),
            ("employer", &mut self.employer, 200),
            ("work_address", &mut self.work_address, 1000),
            ("work_phone", &mut self.work_phone, 80),
            ("position", &mut self.position, 200),
            ("employment_duration", &mut self.employment_duration, 100),
            ("fixed_income", &mut self.fixed_income, 200),
            ("other_income", &mut self.other_income, 200),
            ("other_income_source", &mut self.other_income_source, 200),
            ("pay_days", &mut self.pay_days, 100),
        ] {
            normalize_optional_text(field, value, limit)?;
            uppercase(value);
        }
        normalize_contacts(
            &mut self.spouse,
            &mut self.family_references,
            &mut self.personal_references,
            "profile",
        )?;
        if let Some(spouse) = &mut self.spouse {
            for value in [
                &mut spouse.name,
                &mut spouse.identity,
                &mut spouse.employer,
                &mut spouse.employment_duration,
                &mut spouse.position,
                &mut spouse.address,
            ] {
                uppercase(value);
            }
        }
        for reference in self
            .family_references
            .iter_mut()
            .chain(self.personal_references.iter_mut())
        {
            for value in [
                &mut reference.name,
                &mut reference.relationship,
                &mut reference.address,
            ] {
                uppercase(value);
            }
        }
        Ok(())
    }
}

#[derive(Debug, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub(super) struct CaseApplication {
    /// Date of the loan application, independent of the eventual contract date.
    #[schema(value_type = Option<NaiveDate>)]
    #[serde(skip_serializing_if = "Option::is_none")]
    application_date: Option<CalendarDate>,
    owns_home: Option<bool>,
    rents_home: Option<bool>,
    owns_vehicle: Option<bool>,
    employer: Option<String>,
    work_address: Option<String>,
    work_phone: Option<String>,
    position: Option<String>,
    employment_duration: Option<String>,
    fixed_income: Option<String>,
    other_income: Option<String>,
    other_income_source: Option<String>,
    pay_days: Option<String>,
    pub(super) requested_amount_minor: Option<i64>,
    spouse: Option<CaseSpouse>,
    #[serde(default)]
    #[schema(max_items = 3)]
    family_references: Vec<CaseReference>,
    #[serde(default)]
    #[schema(max_items = 2)]
    personal_references: Vec<CaseReference>,
}

#[derive(Debug, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
struct CaseSpouse {
    name: Option<String>,
    identity: Option<String>,
    phone: Option<String>,
    employer: Option<String>,
    employment_duration: Option<String>,
    position: Option<String>,
    address: Option<String>,
    work_phone: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
struct CaseReference {
    name: Option<String>,
    relationship: Option<String>,
    phone: Option<String>,
    address: Option<String>,
}

impl CaseApplication {
    fn normalize(&mut self) -> Result<(), ApiError> {
        for (field, value, limit) in [
            ("employer", &mut self.employer, 200),
            ("work_address", &mut self.work_address, 1000),
            ("work_phone", &mut self.work_phone, 80),
            ("position", &mut self.position, 200),
            ("employment_duration", &mut self.employment_duration, 100),
            ("fixed_income", &mut self.fixed_income, 200),
            ("other_income", &mut self.other_income, 200),
            ("other_income_source", &mut self.other_income_source, 200),
            ("pay_days", &mut self.pay_days, 100),
        ] {
            normalize_optional_text(field, value, limit)?;
        }
        if self
            .requested_amount_minor
            .is_some_and(|amount| !(1..=MAX_AMOUNT_MINOR).contains(&amount))
        {
            return Err(invalid("application.requested_amount_minor"));
        }
        normalize_contacts(
            &mut self.spouse,
            &mut self.family_references,
            &mut self.personal_references,
            "application",
        )
    }
}

fn normalize_contacts(
    spouse: &mut Option<CaseSpouse>,
    family_references: &mut [CaseReference],
    personal_references: &mut [CaseReference],
    scope: &str,
) -> Result<(), ApiError> {
    if let Some(spouse) = spouse {
        for (field, value, limit) in [
            ("spouse.name", &mut spouse.name, 200),
            ("spouse.identity", &mut spouse.identity, 64),
            ("spouse.phone", &mut spouse.phone, 80),
            ("spouse.employer", &mut spouse.employer, 200),
            (
                "spouse.employment_duration",
                &mut spouse.employment_duration,
                100,
            ),
            ("spouse.position", &mut spouse.position, 200),
            ("spouse.address", &mut spouse.address, 1000),
            ("spouse.work_phone", &mut spouse.work_phone, 80),
        ] {
            normalize_optional_text(field, value, limit)?;
        }
    }
    for (field, references, limit) in [
        ("family_references", family_references, 3),
        ("personal_references", personal_references, 2),
    ] {
        if references.len() > limit {
            return Err(invalid(&format!("{scope}.{field}")));
        }
        for reference in references {
            for (name, value, max) in [
                ("reference.name", &mut reference.name, 200),
                ("reference.relationship", &mut reference.relationship, 100),
                ("reference.phone", &mut reference.phone, 80),
                ("reference.address", &mut reference.address, 1000),
            ] {
                normalize_optional_text(name, value, max)?;
            }
        }
    }
    Ok(())
}

#[derive(Debug, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub(super) struct Vehicle {
    #[serde(skip_serializing_if = "Option::is_none")]
    registration_number: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    chassis_number: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    plate: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    make: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    year: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    engine_number: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    vehicle_type: Option<String>,
    /// Document the vehicle data comes from. A vehicle imported with a bill of
    /// lading has no type, plate or engine number until it is registered.
    #[serde(skip_serializing_if = "Option::is_none")]
    source_document: Option<VehicleDocument>,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, ToSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(super) enum VehicleDocument {
    VehicleRegistration,
    BillOfLading,
}

impl Vehicle {
    fn normalize(&mut self) -> Result<(), ApiError> {
        for (field, value) in [
            ("registration_number", &mut self.registration_number),
            ("chassis_number", &mut self.chassis_number),
            ("plate", &mut self.plate),
            ("make", &mut self.make),
            ("model", &mut self.model),
            ("year", &mut self.year),
            ("color", &mut self.color),
            ("engine_number", &mut self.engine_number),
            ("vehicle_type", &mut self.vehicle_type),
        ] {
            normalize_optional_text(field, value, 200)?;
            // Vehicle data is recorded in uppercase, as it appears in contracts.
            if let Some(text) = value {
                *text = text.to_uppercase();
            }
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(try_from = "String")]
pub(super) struct CalendarDate(pub NaiveDate);

impl TryFrom<String> for CalendarDate {
    type Error = &'static str;

    fn try_from(value: String) -> Result<Self, Self::Error> {
        const INVALID_DATE: &str = "Usa una fecha válida con formato AAAA-MM-DD.";
        let date: NaiveDate = value.parse().map_err(|_| INVALID_DATE)?;
        if value.len() != 10 || date.year() < 1 || date.to_string() != value {
            return Err(INVALID_DATE);
        }
        Ok(Self(date))
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub(super) struct Payment {
    #[schema(value_type = NaiveDate)]
    date: CalendarDate,
    /// Zero is allowed for an extraordinary payment with a pending amount.
    #[schema(minimum = 0, maximum = 9_007_199_254_740_991_i64)]
    amount_minor: i64,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub(super) struct Financing {
    /// Dates must be strictly increasing and precede the final principal date.
    interest_installments: Vec<Payment>,
    final_principal: Payment,
    extraordinary_payments: Vec<Payment>,
    /// The extraordinary payment dates are calculated from the case signature date.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub extraordinary_from_signature: bool,
    /// Explicit number of extraordinary payments saved for this plan.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schema(minimum = 0, maximum = 299)]
    extraordinary_payment_count: Option<usize>,
    #[schema(minimum = 1, maximum = 9_007_199_254_740_991_i64)]
    #[serde(skip_serializing_if = "Option::is_none")]
    insurance_installment_count: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub monthly_plan: Option<MonthlyPlan>,
}

#[derive(Clone, Debug, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub(super) struct MonthlyPlan {
    #[schema(minimum = 1, maximum = 9_007_199_254_740_991_i64)]
    capital_minor: i64,
    #[schema(minimum = 1, maximum = 9_007_199_254_740_991_i64)]
    monthly_rate_basis_points: i64,
    #[schema(minimum = 1, maximum = 1200)]
    installment_count: u32,
}

impl Financing {
    pub fn schedule_extraordinary(
        &mut self,
        signature: Option<NaiveDate>,
        amounts: Option<&[i64]>,
        previous: Option<&Self>,
    ) -> Result<(), ApiError> {
        if amounts.is_none()
            && !self.extraordinary_from_signature
            && !previous.is_some_and(|plan| plan.extraordinary_from_signature)
        {
            return Ok(());
        }
        let signature = signature.ok_or_else(|| {
            ApiError::Validation(
                "Guarda la fecha de firma antes de calcular los abonos extraordinarios.".to_owned(),
            )
        })?;
        let dates: Vec<_> = (4..1200)
            .step_by(4)
            .map_while(|month| {
                signature
                    .checked_add_months(Months::new(month))
                    .filter(|date| date.year() <= 9999)
            })
            .take_while(|date| *date < self.final_principal.date.0)
            .collect();
        if let Some(amounts) = amounts
            && (amounts.len() > dates.len()
                || amounts
                    .iter()
                    .any(|amount| !(0..=MAX_AMOUNT_MINOR).contains(amount)))
        {
            return Err(ApiError::Validation(
                "Revisa los montos de los abonos y el plazo del expediente.".to_owned(),
            ));
        }
        let saved_plan = previous
            .filter(|plan| plan.extraordinary_from_signature)
            .unwrap_or(self);
        let saved = &saved_plan.extraordinary_payments;
        let count = amounts.map_or_else(
            || {
                saved_plan.extraordinary_payment_count.unwrap_or_else(|| {
                    saved
                        .iter()
                        .rposition(|payment| payment.amount_minor > 0)
                        .map_or(2, |index| (index + 1).max(2))
                })
            },
            <[i64]>::len,
        );
        self.extraordinary_payments = dates
            .into_iter()
            .take(count)
            .enumerate()
            .map(|(index, date)| Payment {
                date: CalendarDate(date),
                amount_minor: amounts.map_or_else(
                    || saved.get(index).map_or(0, |payment| payment.amount_minor),
                    |amounts| amounts[index],
                ),
            })
            .collect();
        self.extraordinary_from_signature = true;
        self.extraordinary_payment_count = Some(self.extraordinary_payments.len());
        self.check()
    }

    pub fn calculate_monthly(
        &mut self,
        signature: Option<NaiveDate>,
        requested_amount: Option<i64>,
    ) -> Result<(), ApiError> {
        let Some(plan) = &mut self.monthly_plan else {
            return Ok(());
        };
        let signature = signature.ok_or_else(|| {
            ApiError::Validation(
                "Guarda la fecha de firma antes de calcular el plan de pagos.".to_owned(),
            )
        })?;
        plan.capital_minor = requested_amount.ok_or_else(|| {
            ApiError::Validation(
                "Guarda el monto en la solicitud de préstamo antes de calcular el plan de pagos."
                    .to_owned(),
            )
        })?;
        if !(1..=1200).contains(&plan.installment_count)
            || !(1..=MAX_AMOUNT_MINOR).contains(&plan.capital_minor)
            || !(1..=MAX_AMOUNT_MINOR).contains(&plan.monthly_rate_basis_points)
        {
            return Err(invalid("financing.monthly_plan"));
        }
        let interest =
            (i128::from(plan.capital_minor) * i128::from(plan.monthly_rate_basis_points) + 5000)
                / 10000;
        if interest < 1
            || i128::from(plan.capital_minor) + interest * i128::from(plan.installment_count)
                > i128::from(MAX_AMOUNT_MINOR)
        {
            return Err(ApiError::Validation(
                "El interés o el total del plan está fuera del rango permitido.".to_owned(),
            ));
        }
        let payment = |month, amount_minor| {
            let date = signature
                .checked_add_months(Months::new(month))
                .filter(|date| date.year() <= 9999)
                .ok_or_else(|| {
                    ApiError::Validation("El plan de pagos supera el año 9999.".to_owned())
                })?;
            Ok::<_, ApiError>(Payment {
                date: CalendarDate(date),
                amount_minor,
            })
        };
        let interest = interest as i64;
        self.interest_installments = (1..plan.installment_count)
            .map(|month| payment(month, interest))
            .collect::<Result<_, _>>()?;
        self.final_principal = payment(plan.installment_count, plan.capital_minor + interest)?;
        self.check()
    }

    fn check(&self) -> Result<(), ApiError> {
        if self
            .interest_installments
            .windows(2)
            .any(|pair| pair[0].date.0 >= pair[1].date.0)
            || self
                .interest_installments
                .last()
                .is_some_and(|payment| payment.date.0 >= self.final_principal.date.0)
        {
            return Err(ApiError::Validation(
                "Las fechas de las cuotas de intereses deben estar en orden ascendente, sin repetirse y antes de la última cuota de capital."
                    .to_owned(),
            ));
        }
        let mut total = 0;
        for payment in self
            .interest_installments
            .iter()
            .chain([&self.final_principal])
        {
            if !(1..=MAX_AMOUNT_MINOR - total).contains(&payment.amount_minor) {
                return Err(invalid("financing.amount_minor"));
            }
            total += payment.amount_minor;
        }
        if self
            .insurance_installment_count
            .is_some_and(|count| !(1..=MAX_AMOUNT_MINOR).contains(&count))
        {
            return Err(invalid("financing.insurance_installment_count"));
        }
        if let Some(first) = self.extraordinary_payments.first() {
            for (index, payment) in self.extraordinary_payments.iter().enumerate() {
                let months = u32::try_from(index).ok().and_then(|i| i.checked_mul(4));
                let expected =
                    months.and_then(|months| first.date.0.checked_add_months(Months::new(months)));
                if !self.extraordinary_from_signature && expected != Some(payment.date.0) {
                    return Err(invalid("financing.extraordinary_payments.date"));
                }
                let minimum = i64::from(!self.extraordinary_from_signature);
                if !(minimum..=MAX_AMOUNT_MINOR).contains(&payment.amount_minor) {
                    return Err(invalid("financing.extraordinary_payments.amount_minor"));
                }
            }
        }
        Ok(())
    }
}

fn nullable_patch<'de, D, T>(deserializer: D) -> Result<Option<Option<T>>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(deserializer).map(Some)
}

fn non_null_patch<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    T::deserialize(deserializer).map(Some)
}

fn normalize_text(field: &str, value: &mut String, max: usize) -> Result<(), ApiError> {
    let trimmed = value.trim();
    if trimmed.chars().count() > max || trimmed.contains('\0') {
        return Err(invalid(field));
    }
    if trimmed.len() != value.len() {
        *value = trimmed.to_owned();
    }
    Ok(())
}

fn normalize_optional_text(
    field: &str,
    value: &mut Option<String>,
    max: usize,
) -> Result<(), ApiError> {
    if let Some(text) = value {
        normalize_text(field, text, max)?;
        if text.is_empty() {
            *value = None;
        }
    }
    Ok(())
}

fn invalid(field: &str) -> ApiError {
    ApiError::Validation(format!("Valor inválido para {field}."))
}
