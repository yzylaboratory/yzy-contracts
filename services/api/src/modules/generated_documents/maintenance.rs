use std::{collections::BTreeSet, io::Read};

use anyhow::{Context, ensure};
use base64::{Engine, engine::general_purpose::STANDARD};
use chrono::{DateTime, Utc};
use serde::Deserialize;
use serde_json::Value;
use uuid::Uuid;
use validator::Validate;

use crate::{
    config::Config,
    error::ApiError,
    infrastructure::database,
    modules::{
        billing, clients,
        contracts::native_word,
        files::validation::{FileKind, artifact_max_bytes},
    },
};

use super::{
    dto::{ArtifactMetadata, DocumentFormat, SaveDocument},
    repository, validate,
};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Bundle {
    operation_id: Uuid,
    company_id: Uuid,
    reference: String,
    operation_updated_at: DateTime<Utc>,
    client_updated_at: DateTime<Utc>,
    company_updated_at: DateTime<Utc>,
    vehicle: Value,
    documents: Vec<Replacement>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Replacement {
    old_id: Uuid,
    source_updated_at: DateTime<Utc>,
    template_updated_at: DateTime<Utc>,
    metadata: ArtifactMetadata,
    artifact: String,
}

/// Support operation available only to an operator with access to the API container.
pub async fn replace_words(config: &Config, apply: bool) -> anyhow::Result<()> {
    let bundle: Bundle = serde_json::from_reader(std::io::stdin().lock().take(32 * 1024 * 1024))
        .context("invalid replacement bundle")?;
    let actor = config
        .superadmin_id
        .context("superadmin is not configured")?;
    let expected_ids: BTreeSet<_> = bundle.documents.iter().map(|item| item.old_id).collect();
    ensure!(
        !expected_ids.is_empty() && expected_ids.len() == bundle.documents.len(),
        "expected distinct original Word documents"
    );

    let db = database::connect(config).await?;
    let mut tx = db.begin().await?;
    sqlx::query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE")
        .execute(&mut *tx)
        .await?;
    let matches_case: bool = sqlx::query_scalar(
        "SELECT EXISTS (
           SELECT 1 FROM client_operations o
           JOIN companies c ON c.id = o.company_id
           JOIN clients cl ON cl.id = o.client_id
           WHERE o.id = $1 AND c.id = $2 AND o.reference = $3 AND o.deleted_at IS NULL
             AND o.updated_at = $4 AND cl.updated_at = $5 AND c.updated_at = $6
             AND o.vehicle - 'source_document' = $7::jsonb - 'source_document'
             AND (o.vehicle->>'source_document' IS NULL OR o.vehicle = $7::jsonb)
         )",
    )
    .bind(bundle.operation_id)
    .bind(bundle.company_id)
    .bind(&bundle.reference)
    .bind(bundle.operation_updated_at)
    .bind(bundle.client_updated_at)
    .bind(bundle.company_updated_at)
    .bind(&bundle.vehicle)
    .fetch_one(&mut *tx)
    .await?;
    ensure!(
        matches_case && bundle.vehicle["source_document"] == "bill_of_lading",
        "case data changed or the bundle does not describe the verified bill of lading"
    );

    let originals: Vec<Uuid> = sqlx::query_scalar(
        "SELECT id FROM generated_documents
         WHERE operation_id = $1 AND operation_company_id = $2 AND format = 'docx'",
    )
    .bind(bundle.operation_id)
    .bind(bundle.company_id)
    .fetch_all(&mut *tx)
    .await?;
    ensure!(
        originals.into_iter().collect::<BTreeSet<_>>() == expected_ids,
        "saved Word documents changed"
    );

    // This also validates that the loan application can be generated with the corrected case data.
    clients::correct_case_vehicle(
        &mut tx,
        actor,
        bundle.company_id,
        bundle.operation_id,
        bundle.vehicle,
    )
    .await?;

    let mut new_ids = Vec::new();
    for replacement in bundle.documents {
        let body = SaveDocument::from(replacement.metadata);
        body.validate().context("invalid document metadata")?;
        validate(&body, config.template_max_bytes, false)?;
        let kind = body
            .document_type
            .as_deref()
            .context("missing document type")?;
        let company = body.company.as_ref().context("missing company profile")?;
        company.validate()?;
        ensure!(
            body.format == DocumentFormat::Docx
                && body.operation_id == Some(bundle.operation_id)
                && company.id == bundle.company_id,
            "unexpected document scope"
        );
        let artifact = STANDARD
            .decode(replacement.artifact)
            .context("invalid Word encoding")?;
        ensure!(
            artifact.len() <= artifact_max_bytes(config.upload_max_bytes),
            "Word exceeds the size limit"
        );
        ensure!(
            matches!(
                native_word::read_variables(&artifact),
                Err(ApiError::DocxVariablesRequired)
            ),
            "Word is invalid or contains unresolved fields for {kind}"
        );
        let matches_original: bool = sqlx::query_scalar(
            "SELECT EXISTS (
               SELECT 1 FROM generated_documents d
               JOIN contracts c ON c.id = d.contract_id
               JOIN templates t ON t.contract_id = c.id
               WHERE d.id = $1 AND d.contract_id = $2 AND d.document_type = $3
                 AND c.updated_at = $4 AND t.updated_at = $5 AND c.deleted_at IS NULL
             )",
        )
        .bind(replacement.old_id)
        .bind(body.contract_id)
        .bind(kind)
        .bind(replacement.source_updated_at)
        .bind(replacement.template_updated_at)
        .fetch_one(&mut *tx)
        .await?;
        ensure!(
            matches_original,
            "saved document or template changed for {kind}"
        );
        billing::require_generation_access(
            &db,
            actor,
            body.contract_id,
            Some(bundle.company_id),
            Some(bundle.operation_id),
        )
        .await?;
        let id = Uuid::new_v4();
        let saved = repository::insert_in_transaction(
            &mut tx,
            actor,
            id,
            &body,
            None,
            Some((FileKind::Docx, &artifact)),
        )
        .await?;
        ensure!(saved.is_some(), "could not replace {kind}");
        new_ids.push(id);
    }
    if apply {
        tx.commit().await?;
    } else {
        tx.rollback().await?;
    }
    println!(
        "{} {} Word documents and verified the loan application",
        if apply { "Replaced" } else { "Validated" },
        new_ids.len()
    );
    Ok(())
}
