use chrono::{DateTime, Utc};
use serde_json::{Value, json};
use sqlx::{Postgres, Transaction, types::Json};
use uuid::Uuid;

use super::dto::{Client, Operation, TimelineChange};

const CLIENT_FIELDS: &[&str] = &[
    "name",
    "identity",
    "address",
    "phone",
    "email",
    "income_source",
    "profile",
];
const OPERATION_FIELDS: &[&str] = &[
    "contract_id",
    "application",
    "reference",
    "contract_date",
    "signature_date",
    "status",
    "insurance_paid",
    "insurance_installment_minor",
    "vehicle.registration_number",
    "vehicle.chassis_number",
    "vehicle.plate",
    "vehicle.make",
    "vehicle.model",
    "vehicle.year",
    "vehicle.color",
    "vehicle.engine_number",
    "vehicle.vehicle_type",
    "financing.interest_installments",
    "financing.final_principal",
    "financing.extraordinary_payments",
    "financing.extraordinary_from_signature",
    "financing.insurance_installment_count",
    "financing.monthly_plan.capital_minor",
    "financing.monthly_plan.monthly_rate_basis_points",
    "financing.monthly_plan.installment_count",
];

pub(super) struct Snapshot {
    company_id: Option<Uuid>,
    client_id: Uuid,
    operation_id: Option<Uuid>,
    operation_label: Option<String>,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
    data: Value,
}

impl From<&Client> for Snapshot {
    fn from(client: &Client) -> Self {
        Self {
            company_id: None,
            client_id: client.id,
            operation_id: None,
            operation_label: None,
            created_at: client.created_at,
            updated_at: client.updated_at,
            data: json!(client),
        }
    }
}

impl From<&Operation> for Snapshot {
    fn from(operation: &Operation) -> Self {
        let data = json!(operation);
        let vehicle = &data["vehicle"];
        let model = [vehicle["make"].as_str(), vehicle["model"].as_str()]
            .into_iter()
            .flatten()
            .collect::<Vec<_>>()
            .join(" ");
        let label = [
            (!model.is_empty()).then_some(model.as_str()),
            vehicle["plate"]
                .as_str()
                .or_else(|| vehicle["registration_number"].as_str()),
        ]
        .into_iter()
        .flatten()
        .collect::<Vec<_>>()
        .join(" · ");
        Self {
            company_id: Some(operation.company_id),
            client_id: operation.client_id,
            operation_id: Some(operation.id),
            operation_label: operation
                .reference
                .clone()
                .or_else(|| (!label.is_empty()).then_some(label)),
            created_at: operation.created_at,
            updated_at: operation.updated_at,
            data,
        }
    }
}

impl Snapshot {
    pub(super) async fn record_creation(
        &self,
        tx: &mut Transaction<'_, Postgres>,
        actor: Uuid,
    ) -> sqlx::Result<()> {
        let kind = if self.operation_id.is_some() {
            "operation_created"
        } else {
            "client_created"
        };
        self.insert(tx, kind, self.created_at, Some(actor), &[])
            .await
    }

    /// Returns false for an unchanged record so the caller can discard the timestamp update.
    pub(super) async fn record_update(
        &self,
        tx: &mut Transaction<'_, Postgres>,
        actor: Uuid,
        previous: &Self,
    ) -> sqlx::Result<bool> {
        let (kind, fields) = if self.operation_id.is_some() {
            ("operation_updated", OPERATION_FIELDS)
        } else {
            ("client_updated", CLIENT_FIELDS)
        };
        let mut changes: Vec<_> = fields
            .iter()
            .filter_map(|field| {
                let before = field_value(&previous.data, field);
                let after = field_value(&self.data, field);
                (before != after).then(|| TimelineChange {
                    field: (*field).to_owned(),
                    before: history_value(field, before),
                    after: history_value(field, after),
                })
            })
            .collect();
        if changes.is_empty() {
            return Ok(false);
        }
        if let Some(contract) = changes
            .iter_mut()
            .find(|change| change.field == "contract_id")
        {
            self.label_contracts(tx, contract).await?;
        }
        if previous.updated_at > previous.created_at {
            // Preserve the old timeline's last update if it had no audit entry.
            previous
                .insert(tx, kind, previous.updated_at, None, &[])
                .await?;
        }
        self.insert(tx, kind, self.updated_at, Some(actor), &changes)
            .await?;
        Ok(true)
    }

    async fn label_contracts(
        &self,
        tx: &mut Transaction<'_, Postgres>,
        change: &mut TimelineChange,
    ) -> sqlx::Result<()> {
        let ids: Vec<_> = [&change.before, &change.after]
            .into_iter()
            .filter_map(|value| value.as_str().and_then(|id| id.parse::<Uuid>().ok()))
            .collect();
        let names: Vec<(Uuid, String)> = sqlx::query_as(
            "SELECT id, name FROM yzy_contracts.contracts
             WHERE id = ANY($1) AND deleted_at IS NULL
               AND (company_id = $2 OR $2 = ANY(shared_company_ids))",
        )
        .bind(&ids)
        .bind(self.company_id)
        .fetch_all(&mut **tx)
        .await?;
        for value in [&mut change.before, &mut change.after] {
            if let Some((id, name)) = names
                .iter()
                .find(|(id, _)| value.as_str().and_then(|id| id.parse::<Uuid>().ok()) == Some(*id))
            {
                *value = Value::String(format!("{name} · {id}"));
            }
        }
        Ok(())
    }

    async fn insert(
        &self,
        tx: &mut Transaction<'_, Postgres>,
        kind: &str,
        occurred_at: DateTime<Utc>,
        actor: Option<Uuid>,
        changes: &[TimelineChange],
    ) -> sqlx::Result<()> {
        sqlx::query(
            "INSERT INTO yzy_contracts.client_case_history
                (company_id, client_id, operation_id, kind, occurred_at, actor_id, actor_name, operation_label, changes)
             SELECT $1, $2, $3, $4, $5, $6,
                    COALESCE(
                        (SELECT NULLIF(btrim(name), '') FROM yzy_contracts.access_identities WHERE user_id = $6),
                        yzy_contracts.confirmed_identity_email($6), ($6::uuid)::text
                    ), $7, $8
             WHERE $6 IS NOT NULL OR NOT EXISTS (
                SELECT 1 FROM yzy_contracts.client_case_history
                WHERE company_id IS NOT DISTINCT FROM $1 AND client_id = $2 AND operation_id IS NOT DISTINCT FROM $3
                  AND kind = $4 AND occurred_at = $5
             )",
        )
        .bind(self.company_id)
        .bind(self.client_id)
        .bind(self.operation_id)
        .bind(kind)
        .bind(occurred_at)
        .bind(actor)
        .bind(&self.operation_label)
        .bind(Json(changes))
        .execute(&mut **tx)
        .await?;
        Ok(())
    }
}

fn field_value<'a>(data: &'a Value, field: &str) -> &'a Value {
    match field.split_once('.') {
        Some((parent, child)) => &data[parent][child],
        None => &data[field],
    }
}

// The case has the current application. Avoid duplicating its third-party contact data in history.
fn history_value(field: &str, value: &Value) -> Value {
    if field == "profile" && !value.is_null() {
        return json!("Datos complementarios del cliente");
    }
    if field == "application" && !value.is_null() {
        return json!("Datos de la solicitud");
    }
    value.clone()
}
