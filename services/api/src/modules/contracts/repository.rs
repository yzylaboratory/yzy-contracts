use sqlx::{PgPool, Postgres, QueryBuilder, Transaction};
use uuid::Uuid;

use crate::{error::ApiError, modules::auth::AuthUser};

use super::dto::{ContractResponse, ContractSort, ListContractsQuery, SortOrder};

// Read access is private ownership or membership in an active shared company.
// Mutation also requires original authorship.
macro_rules! contract_select {
    () => {
        "SELECT c.id, c.owner_id, c.company_id, c.catalog_key,
                CASE WHEN c.owner_id = $1 OR c.shared_company_ids IS NULL THEN c.shared_company_ids
                     ELSE ARRAY(
                       SELECT company_id FROM unnest(c.shared_company_ids) WITH ORDINALITY AS shared(company_id, position)
                       WHERE has_company_membership($1, company_id) ORDER BY position
                     ) END AS shared_company_ids,
                c.name, c.description, c.original_file_name, c.mime_type,
                c.size_bytes, c.status, t.id AS template_id, j.id AS latest_conversion_id,
                c.created_at, c.updated_at
         FROM contracts c
         LEFT JOIN templates t ON t.contract_id = c.id
         LEFT JOIN LATERAL (
           SELECT id FROM conversion_jobs
           WHERE contract_id = c.id ORDER BY created_at DESC LIMIT 1
         ) j ON true
         WHERE c.deleted_at IS NULL "
    };
}

pub async fn find_for_reader(
    db: &PgPool,
    owner_id: Uuid,
    id: Uuid,
) -> sqlx::Result<Option<ContractResponse>> {
    sqlx::query_as(concat!(
        contract_select!(),
        "AND can_read_contract($1, c.owner_id, c.company_id, c.shared_company_ids, c.catalog_key) AND c.id = $2"
    ))
    .bind(owner_id)
    .bind(id)
    .fetch_optional(db)
    .await
}

pub async fn list_for_reader(
    db: &PgPool,
    owner_id: Uuid,
    query: &ListContractsQuery,
) -> sqlx::Result<(Vec<ContractResponse>, i64)> {
    let pattern = query.q.as_deref().map(like_pattern);

    let mut count = QueryBuilder::<Postgres>::new(
        "SELECT count(*) FROM contracts c WHERE c.deleted_at IS NULL ",
    );
    push_filters(&mut count, owner_id, pattern.as_deref(), query);
    let total: i64 = count.build_query_scalar().fetch_one(db).await?;

    let mut select = QueryBuilder::<Postgres>::new(contract_select!());
    push_filters(&mut select, owner_id, pattern.as_deref(), query);
    // Fragments come from closed enums, never from the request's text.
    select.push(match query.sort {
        ContractSort::Name => " ORDER BY c.name",
        ContractSort::CreatedAt => " ORDER BY c.created_at",
        ContractSort::UpdatedAt => " ORDER BY c.updated_at",
    });
    select.push(match query.order {
        SortOrder::Asc => " ASC, c.id ASC",
        SortOrder::Desc => " DESC, c.id DESC",
    });
    select.push(" LIMIT ").push_bind(query.per_page);
    select
        .push(" OFFSET ")
        .push_bind((query.page - 1).saturating_mul(query.per_page));
    let items = select.build_query_as().fetch_all(db).await?;

    Ok((items, total))
}

fn push_filters(
    builder: &mut QueryBuilder<Postgres>,
    owner_id: Uuid,
    pattern: Option<&str>,
    query: &ListContractsQuery,
) {
    builder
        .push(" AND can_read_contract(")
        .push_bind(owner_id)
        .push(", c.owner_id, c.company_id, c.shared_company_ids, c.catalog_key)");
    if let Some(pattern) = pattern {
        builder
            .push(" AND c.name ILIKE ")
            .push_bind(pattern.to_owned());
    }
    if let Some(status) = query.status {
        builder.push(" AND c.status = ").push_bind(status.as_str());
    }
}

/// The search text is literal: `%` and `_` from the user must not act as wildcards.
fn like_pattern(text: &str) -> String {
    let escaped = text
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_");
    format!("%{escaped}%")
}

#[derive(sqlx::FromRow)]
pub struct StoredContractScope {
    pub catalog_key: Option<String>,
    pub company_id: Option<Uuid>,
    pub shared_company_ids: Option<Vec<Uuid>>,
}

pub async fn scope_for_reader(
    db: &PgPool,
    actor: Uuid,
    contract_id: Uuid,
) -> sqlx::Result<Option<StoredContractScope>> {
    sqlx::query_as(
        "SELECT company_id, shared_company_ids, catalog_key FROM contracts
         WHERE id = $2 AND deleted_at IS NULL
           AND can_read_contract($1, owner_id, company_id, shared_company_ids, catalog_key)",
    )
    .bind(actor)
    .bind(contract_id)
    .fetch_optional(db)
    .await
}

#[derive(Default)]
pub struct ContractScope<'a> {
    pub company_id: Option<Uuid>,
    pub shared_company_ids: Option<&'a [Uuid]>,
}

async fn can_share(
    tx: &mut Transaction<'_, Postgres>,
    scope: &ContractScope<'_>,
) -> Result<bool, ApiError> {
    let companies = scope
        .shared_company_ids
        .unwrap_or(scope.company_id.as_slice());
    if companies.is_empty() {
        return Ok(true);
    }

    // Lock companies in ID order so they cannot be archived before commit.
    let matched: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM (
           SELECT c.id FROM companies c
           WHERE c.id = ANY($1) AND c.archived_at IS NULL
           ORDER BY c.id FOR SHARE OF c
         ) active",
    )
    .bind(companies)
    .fetch_one(&mut **tx)
    .await?;
    Ok(matched == companies.len() as i64)
}

pub struct NewContract<'a> {
    pub author: &'a AuthUser,
    pub upload_id: Uuid,
    pub scope: ContractScope<'a>,
    pub name: &'a str,
    pub description: Option<&'a str>,
    pub original_file_name: &'a str,
    pub mime_type: &'a str,
    pub size_bytes: i64,
    pub object_key: &'a str,
    pub object_etag: &'a str,
    pub native_variables: Option<&'a [crate::modules::templates::NativeVariable]>,
}

/// Returns `None` if the upload was consumed or expired since it was inspected.
pub async fn insert_consuming_upload(
    db: &PgPool,
    contract: NewContract<'_>,
) -> Result<Option<Uuid>, ApiError> {
    let mut tx: Transaction<'_, Postgres> = db.begin().await?;
    if !can_share(&mut tx, &contract.scope).await? {
        return Err(ApiError::CompanyNotFound);
    }
    let owner = contract.author.id;
    let consumed = sqlx::query(
        "UPDATE file_uploads SET consumed_at = now()
         WHERE id = $1 AND owner_id = $2 AND consumed_at IS NULL AND register_before > now()",
    )
    .bind(contract.upload_id)
    .bind(owner)
    .execute(&mut *tx)
    .await?;
    if consumed.rows_affected() != 1 {
        return Ok(None);
    }
    let id: Uuid = sqlx::query_scalar(
        "INSERT INTO contracts
           (owner_id, upload_id, name, description, original_file_name, mime_type,
            size_bytes, object_key, object_etag, company_id, shared_company_ids)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING id",
    )
    .bind(owner)
    .bind(contract.upload_id)
    .bind(contract.name)
    .bind(contract.description)
    .bind(contract.original_file_name)
    .bind(contract.mime_type)
    .bind(contract.size_bytes)
    .bind(contract.object_key)
    .bind(contract.object_etag)
    .bind(contract.scope.company_id)
    .bind(contract.scope.shared_company_ids)
    .fetch_one(&mut *tx)
    .await?;
    if let Some(variables) = contract.native_variables {
        sqlx::query(
            "INSERT INTO templates (contract_id, owner_id, name, content_markdown, native_variables)
             VALUES ($1, $2, $3, '', $4)",
        )
        .bind(id)
        .bind(owner)
        .bind(contract.name)
        .bind(sqlx::types::Json(variables))
        .execute(&mut *tx)
        .await?;
        sqlx::query("UPDATE contracts SET status = 'converted' WHERE id = $1")
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await?;
    Ok(Some(id))
}

pub async fn update_for_owner(
    db: &PgPool,
    author: &AuthUser,
    id: Uuid,
    name: Option<&str>,
    description: Option<Option<&str>>,
    scope: Option<ContractScope<'_>>,
) -> Result<bool, ApiError> {
    let mut tx = db.begin().await?;
    if let Some(scope) = &scope
        && !can_share(&mut tx, scope).await?
    {
        return Ok(false);
    }
    let result = sqlx::query(
        "UPDATE contracts
         SET name = COALESCE($3, name),
             description = CASE WHEN $4 THEN $5 ELSE description END,
             company_id = CASE WHEN $6 THEN $7 ELSE company_id END,
             shared_company_ids = CASE WHEN $6 THEN $8 ELSE shared_company_ids END
         WHERE owner_id = $1 AND id = $2 AND deleted_at IS NULL AND catalog_key IS NULL
           AND can_read_contract($1, owner_id, company_id, shared_company_ids, catalog_key)",
    )
    .bind(author.id)
    .bind(id)
    .bind(name)
    .bind(description.is_some())
    .bind(description.flatten())
    .bind(scope.is_some())
    .bind(scope.as_ref().and_then(|scope| scope.company_id))
    .bind(scope.as_ref().and_then(|scope| scope.shared_company_ids))
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(result.rows_affected() == 1)
}

/// Removes the template and conversion history now and hides the contract. The
/// worker deletes the R2 object and then the remaining row. A job in flight
/// finds its row gone and discards the result.
pub async fn soft_delete_for_owner(db: &PgPool, owner_id: Uuid, id: Uuid) -> sqlx::Result<bool> {
    let mut tx = db.begin().await?;
    let locked: Option<Uuid> = sqlx::query_scalar(
        "SELECT id FROM contracts
         WHERE owner_id = $1 AND id = $2 AND deleted_at IS NULL AND catalog_key IS NULL
           AND can_read_contract($1, owner_id, company_id, shared_company_ids, catalog_key)
         FOR UPDATE",
    )
    .bind(owner_id)
    .bind(id)
    .fetch_optional(&mut *tx)
    .await?;
    if locked.is_none() {
        return Ok(false);
    }
    sqlx::query("DELETE FROM conversion_jobs WHERE owner_id = $1 AND contract_id = $2")
        .bind(owner_id)
        .bind(id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM templates WHERE owner_id = $1 AND contract_id = $2")
        .bind(owner_id)
        .bind(id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("UPDATE contracts SET deleted_at = now() WHERE owner_id = $1 AND id = $2")
        .bind(owner_id)
        .bind(id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(true)
}

#[derive(Debug, sqlx::FromRow)]
pub struct StoredObject {
    pub object_key: String,
    pub original_file_name: String,
    pub mime_type: String,
}

pub async fn stored_object_for_reader(
    db: &PgPool,
    owner_id: Uuid,
    id: Uuid,
) -> sqlx::Result<Option<StoredObject>> {
    sqlx::query_as(
        "SELECT object_key, original_file_name, mime_type FROM contracts
         WHERE id = $2 AND deleted_at IS NULL
           AND can_read_contract($1, owner_id, company_id, shared_company_ids, catalog_key)",
    )
    .bind(owner_id)
    .bind(id)
    .fetch_optional(db)
    .await
}

#[cfg(test)]
mod tests {
    use super::like_pattern;

    #[test]
    fn search_wildcards_are_escaped() {
        assert_eq!(like_pattern("100%_a\\"), "%100\\%\\_a\\\\%");
    }
}
