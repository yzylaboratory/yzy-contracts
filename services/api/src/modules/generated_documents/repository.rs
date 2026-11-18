use chrono::{DateTime, Utc};
use sqlx::{PgConnection, PgPool, types::Json};
use uuid::Uuid;

use super::dto::{
    DocumentFormat, DocumentFormats, DocumentMetadata, DocumentMonth, DocumentPage, DocumentStats,
    ListDocuments, Period, SaveDocument, StoredArtifact, StoredDocument,
};
use crate::modules::files::validation::FileKind;

pub async fn insert(
    db: &PgPool,
    owner: Uuid,
    id: Uuid,
    body: &SaveDocument,
    legacy: Option<(&str, DateTime<Utc>)>,
    artifact: Option<(FileKind, &[u8])>,
) -> sqlx::Result<Option<DocumentMetadata>> {
    let mut tx = db.begin().await?;
    let saved = insert_in_transaction(&mut tx, owner, id, body, legacy, artifact, None).await?;
    tx.commit().await?;
    Ok(saved)
}

pub(super) async fn insert_in_transaction(
    connection: &mut PgConnection,
    owner: Uuid,
    id: Uuid,
    body: &SaveDocument,
    legacy: Option<(&str, DateTime<Utc>)>,
    artifact: Option<(FileKind, &[u8])>,
    case_fingerprint: Option<&[u8]>,
) -> sqlx::Result<Option<DocumentMetadata>> {
    // Fresh documents inherit access to their source and company.
    let saved: Option<DocumentMetadata> = sqlx::query_as(
        "INSERT INTO generated_documents
            (owner_id, id, contract_id, contract_name, format, filename, markdown,
             email, imported_from_session, created_at, artifact, company, operation_id, operation_company_id, document_type, case_request_fingerprint)
         SELECT $1, $2, $3, source.name, $4, $5, $6, $7, $8::text IS NOT NULL, COALESCE($9, now()), $10, $13, $15, CASE WHEN $15 IS NOT NULL THEN $14 END, $16, $17
         FROM (
           SELECT CASE WHEN $8::text IS NOT NULL THEN $8 ELSE (
             SELECT name FROM contracts
             WHERE id = $3 AND deleted_at IS NULL
               AND can_read_contract($1, owner_id, company_id, shared_company_ids, catalog_key)
               AND (catalog_key IS NULL OR $14 IS NOT NULL)
               AND (company_id IS NULL OR company_id = $14)
               AND (shared_company_ids IS NULL OR $14 = ANY(shared_company_ids))
               AND ($11::text IS NULL OR mime_type = $11
                 OR ($11 = 'application/pdf' AND mime_type = $12))
           ) END AS name
         ) source
         WHERE source.name IS NOT NULL
           AND ($14::uuid IS NULL OR has_company_membership($1, $14))
           AND ($15::uuid IS NULL OR (
             can_use_client_contract($1, $3, $14)
             AND EXISTS (
               SELECT 1 FROM client_operations o
               WHERE o.id = $15 AND o.company_id = $14
                 AND (o.contract_id IS NULL OR can_use_client_contract($1, o.contract_id, $14))
             )
           ))
         ON CONFLICT DO NOTHING
         RETURNING id, contract_id, contract_name, format, filename, created_at, artifact IS NOT NULL AS has_artifact, company, operation_id, document_type",
    )
    .bind(owner)
    .bind(id)
    .bind(body.contract_id)
    .bind(body.format.as_str())
    .bind(&body.filename)
    .bind(&body.markdown)
    .bind(body.email.as_ref().map(Json))
    .bind(legacy.map(|(name, _)| name))
    .bind(legacy.map(|(_, created_at)| created_at))
    .bind(artifact.map(|(_, bytes)| bytes))
    .bind(artifact.map(|(kind, _)| kind.mime_type()))
    .bind(FileKind::Docx.mime_type())
    .bind(body.company.as_ref().map(Json))
    .bind(body.company.as_ref().map(|company| company.id))
    .bind(body.operation_id)
    .bind(&body.document_type)
    .bind(case_fingerprint)
    .fetch_optional(&mut *connection)
    .await?;
    // A regenerated case document replaces the earlier copy of the same
    // template, type and format in that case.
    if let Some(saved) = &saved
        && saved.operation_id.is_some()
    {
        sqlx::query(
            "DELETE FROM generated_documents
             WHERE operation_id = $1 AND operation_company_id = $2
               AND contract_id = $3 AND format = $4 AND id <> $5
               AND document_type IS NOT DISTINCT FROM $6",
        )
        .bind(saved.operation_id)
        .bind(body.company.as_ref().map(|company| company.id))
        .bind(body.contract_id)
        .bind(body.format.as_str())
        .bind(saved.id)
        .bind(&body.document_type)
        .execute(&mut *connection)
        .await?;
    }
    Ok(saved)
}

pub async fn find(db: &PgPool, owner: Uuid, id: Uuid) -> sqlx::Result<Option<StoredDocument>> {
    sqlx::query_as(
        "SELECT id, contract_id, contract_name, format, filename, created_at, artifact IS NOT NULL AS has_artifact,
                markdown, email, imported_from_session, company, operation_id, document_type
         FROM generated_documents WHERE id = $2
           AND (owner_id = $1 OR operation_company_id IS NOT NULL OR company->>'id' IS NOT NULL)",
    )
    .bind(owner)
    .bind(id)
    .fetch_optional(db)
    .await
}

pub(super) async fn find_for_owner(
    db: &PgPool,
    owner: Uuid,
    id: Uuid,
) -> sqlx::Result<Option<StoredDocument>> {
    sqlx::query_as(
        "SELECT id, contract_id, contract_name, format, filename, created_at, artifact IS NOT NULL AS has_artifact,
                markdown, email, imported_from_session, company, operation_id, document_type
         FROM generated_documents WHERE owner_id = $1 AND id = $2",
    )
    .bind(owner)
    .bind(id)
    .fetch_optional(db)
    .await
}

#[derive(sqlx::FromRow)]
pub(super) struct StoredCaseRequest {
    #[sqlx(flatten)]
    pub metadata: DocumentMetadata,
    #[sqlx(rename = "case_request_fingerprint")]
    pub fingerprint: Option<Vec<u8>>,
}

pub(super) async fn find_case_request(
    db: &PgPool,
    owner: Uuid,
    id: Uuid,
) -> sqlx::Result<Option<StoredCaseRequest>> {
    sqlx::query_as(
        "SELECT id, contract_id, contract_name, format, filename, created_at,
                artifact IS NOT NULL AS has_artifact, company, operation_id, document_type,
                case_request_fingerprint
         FROM generated_documents WHERE owner_id = $1 AND id = $2",
    )
    .bind(owner)
    .bind(id)
    .fetch_optional(db)
    .await
}

pub(super) async fn id_is_used(db: &PgPool, id: Uuid) -> sqlx::Result<bool> {
    sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM generated_documents WHERE id = $1)")
        .bind(id)
        .fetch_one(db)
        .await
}

pub(super) async fn artifact_matches(
    db: &PgPool,
    owner: Uuid,
    id: Uuid,
    bytes: &[u8],
) -> sqlx::Result<bool> {
    let same = sqlx::query_scalar::<_, bool>(
        "SELECT artifact = $3 FROM generated_documents
         WHERE owner_id = $1 AND id = $2
           AND artifact IS NOT NULL",
    )
    .bind(owner)
    .bind(id)
    .bind(bytes)
    .fetch_optional(db)
    .await?;
    Ok(same.unwrap_or(false))
}

pub(super) async fn find_artifact(
    db: &PgPool,
    owner: Uuid,
    id: Uuid,
) -> sqlx::Result<Option<StoredArtifact>> {
    sqlx::query_as(
        "SELECT filename, format, email->>'attachment_format' AS attachment_format, artifact
         FROM generated_documents
         WHERE id = $2 AND (owner_id = $1 OR operation_company_id IS NOT NULL OR company->>'id' IS NOT NULL)
           AND artifact IS NOT NULL",
    )
    .bind(owner)
    .bind(id)
    .fetch_optional(db)
    .await
}

#[derive(sqlx::FromRow)]
struct PageRow {
    items: Json<Vec<DocumentMetadata>>,
    total: i64,
}

pub async fn list(db: &PgPool, owner: Uuid, query: &ListDocuments) -> sqlx::Result<DocumentPage> {
    // The two subqueries share a snapshot. Only the requested page of metadata
    // is serialized, even when the filtered count spans many documents.
    // The original insurance sale template predates catalog keys. Suppress it
    // only when its replacement is available for the same case and format.
    let row: PageRow = sqlx::query_as(
        "WITH clock AS (
           SELECT (now() AT TIME ZONE 'America/Santo_Domingo')::date AS today
         ), bounds AS (
           SELECT (CASE $4::text
                     WHEN 'week' THEN today - 6
                     WHEN 'month' THEN today - 29
                     WHEN 'year' THEN date_trunc('year', today::timestamp)::date
                   END)::timestamp AT TIME ZONE 'America/Santo_Domingo' AS first_day,
                  (today + 1)::timestamp AT TIME ZONE 'America/Santo_Domingo' AS next_day
           FROM clock
         ), filtered AS NOT MATERIALIZED (
           SELECT id, contract_id, contract_name, format, filename, created_at, artifact IS NOT NULL AS has_artifact, company, operation_id, document_type
           FROM generated_documents AS d, bounds
           WHERE (owner_id = $1 OR operation_company_id IS NOT NULL OR company->>'id' IS NOT NULL)
             AND ($2::text IS NULL
               OR strpos(translate(lower(contract_name), 'áéíóúüñ', 'aeiouun'),
                         translate(lower($2), 'áéíóúüñ', 'aeiouun')) > 0
               OR strpos(contract_id::text, lower($2)) > 0)
             AND ($3::text IS NULL OR format = $3)
             AND (first_day IS NULL OR (created_at >= first_day AND created_at < next_day))
             AND ($7::uuid IS NULL OR operation_id = $7)
             AND NOT (
               (d.document_type IS NOT DISTINCT FROM 'venta_condicional_seguro'
                OR d.contract_id = '8046c129-4b5f-5345-b744-6f6d0ec4b27a'::uuid)
               AND EXISTS (
                 SELECT 1 FROM generated_documents AS current_sale
                 WHERE current_sale.operation_company_id = d.operation_company_id
                   AND current_sale.operation_id = d.operation_id
                   AND current_sale.document_type = 'acto_seguro'
                   AND current_sale.format = d.format
                   AND current_sale.artifact IS NOT NULL
               )
             )
         )
         SELECT (SELECT count(*) FROM filtered) AS total,
                COALESCE(
                  (SELECT jsonb_agg(to_jsonb(page) ORDER BY created_at DESC, id DESC)
                   FROM (SELECT * FROM filtered ORDER BY created_at DESC, id DESC
                         LIMIT $5 OFFSET $6) page),
                  '[]'::jsonb
                ) AS items",
    )
    .bind(owner)
    .bind(query.q.as_deref().map(str::trim).filter(|q| !q.is_empty()))
    .bind(query.format.map(DocumentFormat::as_str))
    .bind(query.period.map(Period::as_str))
    .bind(query.per_page)
    .bind((query.page - 1).saturating_mul(query.per_page))
    .bind(query.operation_id)
    .fetch_one(db)
    .await?;
    Ok(DocumentPage {
        items: row.items.0,
        total: row.total,
        page: query.page,
        per_page: query.per_page,
    })
}

#[derive(sqlx::FromRow)]
struct StatsRow {
    total: i64,
    pdf: i64,
    docx: i64,
    email: i64,
    months: Json<Vec<DocumentMonth>>,
}

pub async fn stats(db: &PgPool, owner: Uuid) -> sqlx::Result<DocumentStats> {
    let row: StatsRow = sqlx::query_as(
        "WITH clock AS (
           SELECT date_trunc('month', now() AT TIME ZONE 'America/Santo_Domingo') AS month
         ), visible AS NOT MATERIALIZED (
           SELECT format, created_at FROM generated_documents
           WHERE (owner_id = $1 OR operation_company_id IS NOT NULL OR company->>'id' IS NOT NULL)
         ), totals AS (
           SELECT count(*) AS total,
                  count(*) FILTER (WHERE format = 'pdf') AS pdf,
                  count(*) FILTER (WHERE format = 'docx') AS docx,
                  count(*) FILTER (WHERE format = 'email') AS email
           FROM visible
         ), monthly AS (
           SELECT date_trunc('month', created_at AT TIME ZONE 'America/Santo_Domingo') AS month,
                  count(*) AS total
           FROM visible, clock
           WHERE created_at >= ((clock.month - interval '5 months') AT TIME ZONE 'America/Santo_Domingo')
             AND created_at < ((clock.month + interval '1 month') AT TIME ZONE 'America/Santo_Domingo')
           GROUP BY 1
         ), buckets AS (
           SELECT generate_series(month - interval '5 months', month, interval '1 month') AS month
           FROM clock
         )
         SELECT totals.*,
                (SELECT jsonb_agg(jsonb_build_object('month', to_char(buckets.month, 'YYYY-MM'),
                             'total', COALESCE(monthly.total, 0)) ORDER BY buckets.month)
                 FROM buckets LEFT JOIN monthly USING (month)) AS months
         FROM totals",
    )
    .bind(owner)
    .fetch_one(db)
    .await?;
    let months = row.months.0;
    Ok(DocumentStats {
        total: row.total,
        current_month_total: months.last().map_or(0, |month| month.total),
        months,
        formats: DocumentFormats {
            pdf: row.pdf,
            docx: row.docx,
            email: row.email,
        },
    })
}
