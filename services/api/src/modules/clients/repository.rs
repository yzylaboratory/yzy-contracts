use sqlx::{PgPool, types::Json};
use uuid::Uuid;

use crate::error::ApiError;

use super::dto::{
    CaseListItem, CasePage, Client, ClientPage, ClientPatch, ClientTimelineEvent,
    ClientTimelinePage, ListCases, ListClients, ListTimeline, Operation, OperationPatch,
};
use super::history::Snapshot;

pub(super) async fn list_cases(db: &PgPool, query: &ListCases) -> sqlx::Result<CasePage> {
    let (items, total): (Json<Vec<CaseListItem>>, i64) = sqlx::query_as(
        "WITH search AS (
           SELECT translate(lower($2::text), 'áéíóúüñ', 'aeiouun') AS text,
                  NULLIF(regexp_replace(lower($2), '[[:space:]-]+', '', 'g'), '') AS identity
         ), filtered AS NOT MATERIALIZED (
           SELECT o.id, o.client_id, c.name AS client_name, c.identity AS client_identity,
                  o.company_id, co.name AS company_name, o.reference, o.contract_date, o.status,
                  o.vehicle, o.created_at
           FROM yzy_contracts.client_operations o
           JOIN yzy_contracts.clients c ON c.id = o.client_id
           JOIN yzy_contracts.companies co ON co.id = o.company_id
           CROSS JOIN search
           WHERE o.deleted_at IS NULL AND o.company_id = $1 AND (search.text IS NULL
             OR strpos(translate(lower(concat_ws(' ', o.reference, c.name,
                  o.vehicle->>'make', o.vehicle->>'model', o.vehicle->>'plate',
                  o.vehicle->>'registration_number', o.vehicle->>'chassis_number')),
                  'áéíóúüñ', 'aeiouun'), search.text) > 0
             OR strpos(lower(c.identity), lower($2)) > 0
             OR strpos(regexp_replace(lower(c.identity), '[[:space:]-]+', '', 'g'), search.identity) > 0)
         )
         SELECT COALESCE(
                  (SELECT jsonb_agg(to_jsonb(page) ORDER BY created_at DESC, id DESC)
                   FROM (SELECT * FROM filtered ORDER BY created_at DESC, id DESC LIMIT $3 OFFSET $4) page),
                  '[]'::jsonb
                ),
                (SELECT count(*) FROM filtered)",
    )
    .bind(query.company_id)
    .bind(query.q.as_deref().map(str::trim).filter(|q| !q.is_empty()))
    .bind(query.per_page)
    .bind((query.page - 1).saturating_mul(query.per_page))
    .fetch_one(db)
    .await?;
    Ok(CasePage {
        items: items.0,
        total,
        page: query.page,
        per_page: query.per_page,
    })
}

pub(super) async fn list_clients(db: &PgPool, query: &ListClients) -> sqlx::Result<ClientPage> {
    let (items, total): (Json<Vec<Client>>, i64) = sqlx::query_as(
        "WITH filtered AS NOT MATERIALIZED (
           SELECT * FROM yzy_contracts.clients
           WHERE $1::text IS NULL
             OR strpos(translate(lower(name), 'áéíóúüñ', 'aeiouun'),
                       translate(lower($1), 'áéíóúüñ', 'aeiouun')) > 0
             OR strpos(lower(identity), lower($1)) > 0
             OR (NULLIF(regexp_replace($1, '[[:space:]-]+', '', 'g'), '') IS NOT NULL AND
                 strpos(lower(regexp_replace(identity, '[[:space:]-]+', '', 'g')),
                        lower(regexp_replace($1, '[[:space:]-]+', '', 'g'))) > 0)
             OR strpos(lower(phone), lower($1)) > 0
             OR strpos(lower(email), lower($1)) > 0
         )
         SELECT COALESCE(
                  (SELECT jsonb_agg(to_jsonb(page) - 'profile' ORDER BY lower(name), id)
                   FROM (SELECT * FROM filtered ORDER BY lower(name), id LIMIT $2 OFFSET $3) page),
                  '[]'::jsonb
                ),
                (SELECT count(*) FROM filtered)",
    )
    .bind(query.q.as_deref().map(str::trim).filter(|q| !q.is_empty()))
    .bind(query.per_page)
    .bind((query.page - 1).saturating_mul(query.per_page))
    .fetch_one(db)
    .await?;
    Ok(ClientPage {
        items: items.0,
        total,
        page: query.page,
        per_page: query.per_page,
    })
}

pub(super) async fn create_client(
    db: &PgPool,
    actor: Uuid,
    body: ClientPatch,
) -> Result<Client, ApiError> {
    let mut tx = db.begin().await?;
    let saved: Client = sqlx::query_as(
        "INSERT INTO yzy_contracts.clients (name, identity, address, phone, email, income_source, profile)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *",
    )
    .bind(body.name)
    .bind(body.identity.flatten())
    .bind(body.address.flatten())
    .bind(body.phone.flatten())
    .bind(body.email.flatten())
    .bind(body.income_source.flatten())
    .bind(body.profile.flatten().map(Json))
    .fetch_one(&mut *tx)
    .await
    .map_err(client_write_error)?;
    Snapshot::from(&saved)
        .record_creation(&mut tx, actor)
        .await?;
    tx.commit().await?;
    Ok(saved)
}

pub(super) async fn find_client(db: &PgPool, client: Uuid) -> sqlx::Result<Option<Client>> {
    sqlx::query_as(
        "SELECT * FROM yzy_contracts.clients WHERE id = yzy_contracts.resolve_client_id($1)",
    )
    .bind(client)
    .fetch_optional(db)
    .await
}

pub(super) async fn delete_client(db: &PgPool, client: Uuid) -> Result<(), ApiError> {
    let deleted: bool = sqlx::query_scalar("SELECT yzy_contracts.delete_client($1)")
        .bind(client)
        .fetch_one(db)
        .await
        .map_err(|error| {
            if error
                .as_database_error()
                .is_some_and(|error| error.code() == Some("23503".into()))
            {
                return ApiError::ClientInUse;
            }
            ApiError::from(error)
        })?;
    if deleted {
        Ok(())
    } else {
        Err(ApiError::ClientNotFound)
    }
}

fn client_write_error(error: sqlx::Error) -> ApiError {
    if error
        .as_database_error()
        .and_then(|error| error.constraint())
        == Some("clients_global_identity_idx")
    {
        return ApiError::ClientIdentityConflict;
    }
    error.into()
}

pub(super) async fn list_timeline(
    db: &PgPool,
    client: Uuid,
    query: &ListTimeline,
) -> sqlx::Result<Option<ClientTimelinePage>> {
    let row: Option<(Json<Vec<ClientTimelineEvent>>, i64)> = sqlx::query_as(
        "WITH client AS MATERIALIZED (
           SELECT id, created_at, updated_at FROM yzy_contracts.clients
           WHERE id = yzy_contracts.resolve_client_id($1)
         ), operations AS MATERIALIZED (
           SELECT o.id, o.company_id, o.created_at, o.updated_at,
                  COALESCE(NULLIF(btrim(o.reference), ''), NULLIF(concat_ws(' · ',
                    NULLIF(concat_ws(' ', NULLIF(btrim(o.vehicle->>'make'), ''),
                                          NULLIF(btrim(o.vehicle->>'model'), '')), ''),
                    COALESCE(NULLIF(btrim(o.vehicle->>'plate'), ''),
                             NULLIF(btrim(o.vehicle->>'registration_number'), ''))
                  ), '')) AS label
           FROM yzy_contracts.client_operations o
           JOIN client c ON c.id = o.client_id
           WHERE o.deleted_at IS NULL AND ($4::uuid IS NULL OR o.id = $4)
         ), recorded AS (
           SELECT h.id, h.operation_id, h.kind, h.occurred_at, h.operation_label, h.actor_name, h.changes
           FROM yzy_contracts.client_case_history h
           JOIN client c ON c.id = h.client_id
           WHERE ($4 IS NULL AND h.operation_id IS NULL)
              OR EXISTS (SELECT 1 FROM operations o WHERE o.id = h.operation_id)
         ), events AS (
           SELECT id, kind, occurred_at, operation_label, NULL::text AS document_name, actor_name, changes
           FROM recorded
           UNION ALL
           SELECT id, 'client_created', created_at, NULL, NULL, NULL, '[]'::jsonb
           FROM client WHERE $4 IS NULL AND NOT EXISTS (SELECT 1 FROM recorded WHERE kind = 'client_created')
           UNION ALL
           SELECT c.id, 'client_updated', c.updated_at, NULL, NULL, NULL, '[]'::jsonb
           FROM client c WHERE $4 IS NULL AND c.updated_at > c.created_at AND NOT EXISTS (
             SELECT 1 FROM recorded WHERE kind = 'client_updated' AND occurred_at = c.updated_at
           )
           UNION ALL
           SELECT o.id, 'operation_created', o.created_at, o.label, NULL, NULL, '[]'::jsonb
           FROM operations o WHERE NOT EXISTS (
             SELECT 1 FROM recorded WHERE operation_id = o.id AND kind = 'operation_created'
           )
           UNION ALL
           SELECT o.id, 'operation_updated', o.updated_at, o.label, NULL, NULL, '[]'::jsonb
           FROM operations o WHERE o.updated_at > o.created_at AND NOT EXISTS (
             SELECT 1 FROM recorded WHERE operation_id = o.id AND kind = 'operation_updated'
               AND occurred_at = o.updated_at
           )
           UNION ALL
           SELECT d.id, 'document_generated', d.created_at, o.label, d.contract_name,
                  COALESCE(NULLIF(btrim(i.name), ''), yzy_contracts.confirmed_identity_email(d.owner_id), d.owner_id::text),
                  '[]'::jsonb
           FROM operations o
           JOIN yzy_contracts.generated_documents d
             ON d.operation_company_id = o.company_id AND d.operation_id = o.id
           LEFT JOIN yzy_contracts.access_identities i ON i.user_id = d.owner_id
           WHERE NOT d.imported_from_session
         )
         SELECT COALESCE(
                  (SELECT jsonb_agg(to_jsonb(page) ORDER BY occurred_at DESC, kind, id DESC)
                   FROM (SELECT * FROM events ORDER BY occurred_at DESC, kind, id DESC
                         LIMIT $2 OFFSET $3) page),
                  '[]'::jsonb
                ),
                (SELECT count(*) FROM events)
         FROM client
         WHERE $4 IS NULL OR EXISTS (SELECT 1 FROM operations)",
    )
    .bind(client)
    .bind(query.per_page)
    .bind((query.page - 1).saturating_mul(query.per_page))
    .bind(query.operation_id)
    .fetch_optional(db)
    .await?;
    Ok(row.map(|(items, total)| ClientTimelinePage {
        items: items.0,
        total,
        page: query.page,
        per_page: query.per_page,
    }))
}

pub(super) async fn update_client(
    db: &PgPool,
    actor: Uuid,
    client: Uuid,
    body: ClientPatch,
) -> Result<Option<Client>, ApiError> {
    let mut tx = db.begin().await?;
    let previous: Option<Client> = sqlx::query_as(
        "SELECT * FROM yzy_contracts.clients
         WHERE id = yzy_contracts.resolve_client_id($1)
         FOR UPDATE",
    )
    .bind(client)
    .fetch_optional(&mut *tx)
    .await?;
    let Some(previous) = previous else {
        return Ok(None);
    };
    let saved: Option<Client> = sqlx::query_as(
        "UPDATE yzy_contracts.clients SET name = COALESCE($2, name),
           identity = CASE WHEN $3 THEN $4 ELSE identity END,
           address = CASE WHEN $5 THEN $6 ELSE address END,
           phone = CASE WHEN $7 THEN $8 ELSE phone END,
           email = CASE WHEN $9 THEN $10 ELSE email END,
           income_source = CASE WHEN $11 THEN $12 ELSE income_source END,
           profile = CASE WHEN $13 THEN $14 ELSE profile END,
           updated_at = statement_timestamp()
         WHERE id = yzy_contracts.resolve_client_id($1)
         RETURNING *",
    )
    .bind(previous.id)
    .bind(body.name)
    .bind(body.identity.is_some())
    .bind(body.identity.flatten())
    .bind(body.address.is_some())
    .bind(body.address.flatten())
    .bind(body.phone.is_some())
    .bind(body.phone.flatten())
    .bind(body.email.is_some())
    .bind(body.email.flatten())
    .bind(body.income_source.is_some())
    .bind(body.income_source.flatten())
    .bind(body.profile.is_some())
    .bind(body.profile.flatten().map(Json))
    .fetch_optional(&mut *tx)
    .await
    .map_err(client_write_error)?;
    let Some(saved) = saved else {
        return Ok(None);
    };
    if !Snapshot::from(&saved)
        .record_update(&mut tx, actor, &Snapshot::from(&previous))
        .await?
    {
        tx.rollback().await?;
        return Ok(Some(previous));
    }
    tx.commit().await?;
    Ok(Some(saved))
}

pub(super) async fn list_operations(
    db: &PgPool,
    client: Uuid,
) -> sqlx::Result<Option<Vec<Operation>>> {
    let row: Option<Json<Vec<Operation>>> = sqlx::query_scalar(
        "SELECT COALESCE(
           (SELECT jsonb_agg(to_jsonb(o) ORDER BY o.created_at DESC, o.id DESC)
            FROM yzy_contracts.client_operations o WHERE o.client_id = c.id AND o.deleted_at IS NULL),
           '[]'::jsonb
         )
         FROM yzy_contracts.clients c WHERE c.id = yzy_contracts.resolve_client_id($1)",
    )
    .bind(client)
    .fetch_optional(db)
    .await?;
    Ok(row.map(|row| row.0))
}

pub(super) async fn active_company(db: &PgPool, company: Uuid) -> sqlx::Result<bool> {
    sqlx::query_scalar(
        "SELECT EXISTS (
            SELECT 1 FROM yzy_contracts.companies WHERE id = $1 AND archived_at IS NULL
        )",
    )
    .bind(company)
    .fetch_one(db)
    .await
}

pub(super) async fn create_operation(
    db: &PgPool,
    actor: Uuid,
    company: Uuid,
    client: Uuid,
    mut body: OperationPatch,
) -> Result<Option<Operation>, ApiError> {
    let signature = body
        .signature_date
        .as_ref()
        .and_then(|date| date.as_ref())
        .map(|date| date.0);
    if let Some(Some(financing)) = &mut body.financing {
        let requested_amount = body
            .application
            .as_ref()
            .and_then(|application| application.as_ref())
            .and_then(|application| application.requested_amount_minor);
        financing.calculate_monthly(signature, requested_amount)?;
        financing.schedule_extraordinary(signature, None, None)?;
    }
    let mut tx = db.begin().await?;
    let saved: Option<Operation> = sqlx::query_as(
        "INSERT INTO yzy_contracts.client_operations
            (company_id, client_id, contract_id, reference, contract_date, vehicle, financing, application, signature_date, status, insurance_installment_minor, insurance_paid)
         SELECT $2, yzy_contracts.resolve_client_id($3), $4, $5, $6, $7, $8, $9, $10, COALESCE($11, 'solicitud'), $12, COALESCE($13, false)
         WHERE yzy_contracts.has_company_membership($1, $2)
           AND ($4::uuid IS NULL OR yzy_contracts.can_use_client_contract($1, $4, $2))
           AND EXISTS (SELECT 1 FROM yzy_contracts.clients WHERE id = yzy_contracts.resolve_client_id($3))
         RETURNING *",
    )
    .bind(actor)
    .bind(company)
    .bind(client)
    .bind(body.contract_id.flatten())
    .bind(body.reference.flatten())
    .bind(body.contract_date.flatten().map(|date| date.0))
    .bind(body.vehicle.map(Json))
    .bind(body.financing.flatten().map(Json))
    .bind(body.application.flatten().map(Json))
    .bind(body.signature_date.flatten().map(|date| date.0))
    .bind(body.status)
    .bind(body.insurance_installment_minor.flatten())
    .bind(body.insurance_paid)
    .fetch_optional(&mut *tx)
    .await
    .map_err(operation_write_error)?;
    if let Some(operation) = &saved {
        Snapshot::from(operation)
            .record_creation(&mut tx, actor)
            .await?;
    }
    tx.commit().await?;
    Ok(saved)
}

fn operation_write_error(error: sqlx::Error) -> ApiError {
    match error
        .as_database_error()
        .and_then(|error| error.constraint())
    {
        Some("generated_case_reference_immutable") => ApiError::CaseReferenceConflict(
            "La referencia automática del expediente no se puede cambiar.",
        ),
        Some("generated_case_reference_reserved") => {
            ApiError::CaseReferenceConflict("La referencia ya está reservada para otro expediente.")
        }
        _ => error.into(),
    }
}

pub(super) async fn find_operation(
    db: &PgPool,
    company: Uuid,
    client: Uuid,
    operation: Uuid,
) -> sqlx::Result<Option<Operation>> {
    sqlx::query_as(
        "SELECT * FROM yzy_contracts.client_operations
         WHERE company_id = $1 AND client_id = yzy_contracts.resolve_client_id($2) AND id = $3
           AND deleted_at IS NULL",
    )
    .bind(company)
    .bind(client)
    .bind(operation)
    .fetch_optional(db)
    .await
}

pub(super) async fn find_case(db: &PgPool, id: Uuid) -> sqlx::Result<Option<Operation>> {
    sqlx::query_as(
        "SELECT * FROM yzy_contracts.client_operations WHERE id = $1 AND deleted_at IS NULL",
    )
    .bind(id)
    .fetch_optional(db)
    .await
}

pub(super) async fn update_operation(
    db: &PgPool,
    actor: Uuid,
    company: Uuid,
    client: Uuid,
    operation: Uuid,
    mut body: OperationPatch,
) -> Result<Option<Operation>, ApiError> {
    let mut tx = db.begin().await?;
    let previous: Option<Operation> = sqlx::query_as(
        "SELECT * FROM yzy_contracts.client_operations
         WHERE company_id = $2 AND client_id = yzy_contracts.resolve_client_id($3) AND id = $4
           AND deleted_at IS NULL AND yzy_contracts.has_company_membership($1, $2)
         FOR UPDATE",
    )
    .bind(actor)
    .bind(company)
    .bind(client)
    .bind(operation)
    .fetch_optional(&mut *tx)
    .await?;
    let Some(previous) = previous else {
        return Ok(None);
    };
    let previous_snapshot = Snapshot::from(&previous);
    let signature = body
        .signature_date
        .as_ref()
        .map_or(previous.signature_date, |date| {
            date.as_ref().map(|date| date.0)
        });
    let previous_amount = previous
        .application
        .as_ref()
        .and_then(|application| application.requested_amount_minor);
    let requested_amount = body
        .application
        .as_ref()
        .map_or(previous_amount, |application| {
            application
                .as_ref()
                .and_then(|application| application.requested_amount_minor)
        });
    let previous_plan = previous.financing.as_ref();
    let extraordinary_amounts = body.extraordinary_payment_amounts_minor.as_deref();
    if body.financing.is_none()
        && (extraordinary_amounts.is_some()
            || previous_plan.is_some_and(|plan| {
                (signature != previous.signature_date
                    && (plan.monthly_plan.is_some() || plan.extraordinary_from_signature))
                    || (requested_amount != previous_amount && plan.monthly_plan.is_some())
            }))
    {
        body.financing = Some(previous.financing.clone());
    }
    if let Some(Some(financing)) = &mut body.financing {
        financing.calculate_monthly(signature, requested_amount)?;
        financing.schedule_extraordinary(signature, extraordinary_amounts, previous_plan)?;
    } else if extraordinary_amounts.is_some() {
        return Err(ApiError::Validation(
            "Guarda el plan de pagos antes de guardar los abonos extraordinarios.".to_owned(),
        ));
    }
    let saved: Option<Operation> = sqlx::query_as(
        "UPDATE yzy_contracts.client_operations SET contract_id = CASE WHEN $13 THEN $5 ELSE contract_id END,
           reference = CASE WHEN $6 THEN $7 ELSE reference END,
           contract_date = CASE WHEN $8 THEN $9 ELSE contract_date END,
           vehicle = COALESCE($10, vehicle),
           financing = CASE WHEN $11 THEN $12 ELSE financing END,
           application = CASE WHEN $14 THEN $15 ELSE application END,
           signature_date = CASE WHEN $16 THEN $17 ELSE signature_date END,
           status = CASE WHEN $18 THEN $19 ELSE status END,
           insurance_installment_minor = CASE WHEN $20 THEN $21 ELSE insurance_installment_minor END,
           insurance_paid = CASE WHEN $22 THEN $23 ELSE insurance_paid END,
           updated_at = statement_timestamp()
         WHERE company_id = $2 AND client_id = yzy_contracts.resolve_client_id($3) AND id = $4
           AND deleted_at IS NULL AND yzy_contracts.has_company_membership($1, $2)
           AND ($5::uuid IS NULL OR yzy_contracts.can_use_client_contract($1, $5, $2))
         RETURNING *",
    )
    .bind(actor)
    .bind(company)
    .bind(client)
    .bind(operation)
    .bind(body.contract_id.flatten())
    .bind(body.reference.is_some())
    .bind(body.reference.flatten())
    .bind(body.contract_date.is_some())
    .bind(body.contract_date.flatten().map(|date| date.0))
    .bind(body.vehicle.map(Json))
    .bind(body.financing.is_some())
    .bind(body.financing.flatten().map(Json))
    .bind(body.contract_id.is_some())
    .bind(body.application.is_some())
    .bind(body.application.flatten().map(Json))
    .bind(body.signature_date.is_some())
    .bind(body.signature_date.flatten().map(|date| date.0))
    .bind(body.status.is_some())
    .bind(body.status)
    .bind(body.insurance_installment_minor.is_some())
    .bind(body.insurance_installment_minor.flatten())
    .bind(body.insurance_paid.is_some())
    .bind(body.insurance_paid)
    .fetch_optional(&mut *tx)
    .await
    .map_err(operation_write_error)?;
    let Some(saved) = saved else {
        return Ok(None);
    };
    if !Snapshot::from(&saved)
        .record_update(&mut tx, actor, &previous_snapshot)
        .await?
    {
        tx.rollback().await?;
        return Ok(Some(previous));
    }
    tx.commit().await?;
    Ok(Some(saved))
}

pub(super) async fn operation_source_allowed(
    db: &PgPool,
    actor: Uuid,
    company: Uuid,
    operation: Uuid,
) -> sqlx::Result<bool> {
    sqlx::query_scalar(
        "SELECT EXISTS (
           SELECT 1 FROM yzy_contracts.client_operations o
           WHERE o.company_id = $2 AND o.id = $3 AND o.deleted_at IS NULL
             AND yzy_contracts.has_company_membership($1, $2)
             AND (o.contract_id IS NULL OR yzy_contracts.can_use_client_contract($1, o.contract_id, $2))
         )",
    )
    .bind(actor)
    .bind(company)
    .bind(operation)
    .fetch_one(db)
    .await
}

pub(super) async fn contract_allowed(
    db: &PgPool,
    actor: Uuid,
    company: Uuid,
    contract: Uuid,
) -> sqlx::Result<bool> {
    sqlx::query_scalar("SELECT yzy_contracts.can_use_client_contract($1, $2, $3)")
        .bind(actor)
        .bind(contract)
        .bind(company)
        .fetch_one(db)
        .await
}

/// Marks a case file as deleted. Only the company's billing manager (or the
/// superadministrator) may do it; the row and its documents stay for audit.
pub(super) async fn delete_operation(
    db: &PgPool,
    actor: Uuid,
    superadmin: bool,
    company: Uuid,
    client: Uuid,
    operation: Uuid,
) -> sqlx::Result<bool> {
    let deleted = sqlx::query(
        "UPDATE yzy_contracts.client_operations
         SET deleted_at = statement_timestamp(), deleted_by = $1
         WHERE company_id = $3 AND client_id = yzy_contracts.resolve_client_id($4) AND id = $5
           AND deleted_at IS NULL
           AND ($2 OR $3 IN (SELECT yzy_contracts.billing_companies_for($1)))",
    )
    .bind(actor)
    .bind(superadmin)
    .bind(company)
    .bind(client)
    .bind(operation)
    .execute(db)
    .await?;
    Ok(deleted.rows_affected() == 1)
}
