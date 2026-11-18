use std::time::Duration;

use anyhow::{Context, bail};
use sqlx::{
    AssertSqlSafe, PgPool, SqlSafeStr,
    migrate::{Migration, Migrator},
    postgres::{PgConnectOptions, PgPoolOptions},
};

use super::schema::{DatabaseSchema, development_sql};
use crate::config::Config;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);

/// Connects as the runtime role. Every connection searches only the selected
/// schema, so queries stay unqualified and cannot reach the other product schema.
pub async fn connect(config: &Config) -> anyhow::Result<PgPool> {
    let options: PgConnectOptions = config
        .database_url
        .parse()
        .context("DATABASE_URL is not a valid PostgreSQL URL")?;
    connect_with_options(options, config).await
}

pub async fn connect_with_options(
    options: PgConnectOptions,
    config: &Config,
) -> anyhow::Result<PgPool> {
    let schema = config.database_schema;
    let superadmin_id = config
        .superadmin_id
        .map(|id| id.to_string())
        .unwrap_or_default();
    let pool = PgPoolOptions::new()
        .max_connections(config.database_max_connections)
        .acquire_timeout(CONNECT_TIMEOUT)
        .after_connect(move |connection, _| {
            let superadmin_id = superadmin_id.clone();
            Box::pin(async move {
                // No `public` fallback: the search path is the selected schema alone.
                sqlx::query(
                    "SELECT set_config('search_path', $1, false),
                            set_config($2, $3, false)",
                )
                .bind(schema.name())
                .bind(schema.superadmin_setting())
                .bind(superadmin_id)
                .execute(connection)
                .await?;
                Ok(())
            })
        })
        .connect_with(options.application_name("yzy-contracts-api"))
        .await
        .context("could not connect to PostgreSQL")?;
    verify_schema_access(&pool, schema).await?;
    Ok(pool)
}

/// Refuses to serve when the role and the schema disagree, when the schema is
/// missing, or when a DEV role can read PROD.
async fn verify_schema_access(pool: &PgPool, schema: DatabaseSchema) -> anyhow::Result<()> {
    let (role, schema_exists, other_readable): (String, bool, bool) = sqlx::query_as(
        "SELECT current_user::text,
                to_regnamespace($1) IS NOT NULL,
                COALESCE(to_regnamespace($2) IS NOT NULL
                  AND has_schema_privilege($2, 'USAGE'), false)",
    )
    .bind(schema.name())
    .bind(schema.other_name())
    .fetch_one(pool)
    .await
    .context("could not verify the database role and schema")?;
    if role != schema.role() {
        bail!(
            "CONTRACTS_DATABASE_SCHEMA={} requires database role {}, but the connection uses {role}",
            schema.name(),
            schema.role()
        );
    }
    if !schema_exists {
        bail!("schema {} does not exist in this database", schema.name());
    }
    if schema == DatabaseSchema::Development && other_readable {
        bail!(
            "role {role} can read the production schema {}; DEV must not have access to it",
            schema.other_name()
        );
    }
    Ok(())
}

/// Migrations embedded from the same source for both schemas. PROD keeps the
/// embedded SQL and checksums untouched. DEV applies the DEV rename to each
/// migration and records it in its own ledger.
pub fn migrator(schema: DatabaseSchema) -> Migrator {
    let mut migrator = sqlx::migrate!("../../supabase/migrations");
    if schema == DatabaseSchema::Development {
        let migrations = migrator
            .migrations
            .iter()
            .map(|migration| {
                Migration::new(
                    migration.version,
                    migration.description.clone(),
                    migration.migration_type,
                    // Built from the embedded migrations, never from request data.
                    AssertSqlSafe(development_sql(migration.sql.as_str())).into_sql_str(),
                    migration.no_tx,
                )
            })
            .collect();
        migrator = Migrator::with_migrations(migrations);
    }
    migrator.dangerous_set_table_name(schema.ledger_table());
    migrator
}

pub async fn run_migrations(
    database_url: &str,
    schema: DatabaseSchema,
    superadmin_id: Option<uuid::Uuid>,
) -> anyhow::Result<()> {
    let options: PgConnectOptions = database_url
        .parse()
        .context("the migration URL is not a valid PostgreSQL URL")?;
    let superadmin = superadmin_id.map(|id| id.to_string()).unwrap_or_default();
    let pool = PgPoolOptions::new()
        .max_connections(1)
        .acquire_timeout(CONNECT_TIMEOUT)
        .connect_with(options.options([(schema.superadmin_setting(), superadmin)]))
        .await
        .context("could not connect to PostgreSQL to migrate")?;
    let mut connection = pool.acquire().await?;
    let mut migrator = migrator(schema);
    if schema == DatabaseSchema::Production {
        accept_previous_checksums(&mut migrator, &mut connection).await?;
    }
    migrator
        .run(&mut *connection)
        .await
        .context("could not apply migrations")?;
    Ok(())
}

/// Only PROD has pre-publication ledger rows. Accept exactly their checksums.
async fn accept_previous_checksums(
    migrator: &mut Migrator,
    connection: &mut sqlx::PgConnection,
) -> Result<(), sqlx::Error> {
    let previous: Vec<(i64, Vec<u8>)> = sqlx::query_as(
        "SELECT version, checksum FROM yzy_contracts._sqlx_migrations
         WHERE (version = 20261108000001 AND encode(checksum, 'hex') =
             '2b45537ac4c985da0c96aa529c6dcfe1240753fa3f8f606522d76c050e7a20808e5576678c437997b5ec1062487127e6')
            OR (version = 20261113032819 AND encode(checksum, 'hex') =
             '149717f16db91bfdf3585e36f70ebd20961a836b4427daa1cbfc0cd8a19ab27bd15ed8354a03112b10be5c4928279868')",
    )
    .fetch_all(&mut *connection)
    .await
    .or_else(|error| match error.as_database_error().and_then(|error| error.code()).as_deref() {
        Some("42P01" | "3F000") => Ok(Vec::new()),
        _ => Err(error),
    })?;

    // Keep SQLx validation enabled and accept only the exact checksums of the
    // two pre-publication migrations already applied to existing databases.
    for (version, checksum) in previous {
        if let Some(migration) = migrator
            .migrations
            .to_mut()
            .iter_mut()
            .find(|m| m.version == version)
        {
            migration.checksum = checksum.into();
        }
    }
    Ok(())
}
