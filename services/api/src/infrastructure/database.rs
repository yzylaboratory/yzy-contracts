use std::time::Duration;

use anyhow::Context;
use sqlx::{
    PgPool,
    migrate::Migrator,
    postgres::{PgConnectOptions, PgPoolOptions},
};

use crate::config::Config;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);

pub async fn connect(config: &Config) -> anyhow::Result<PgPool> {
    let options: PgConnectOptions = config
        .database_url
        .parse()
        .context("DATABASE_URL is not a valid PostgreSQL URL")?;
    let superadmin_id = config
        .superadmin_id
        .map(|id| id.to_string())
        .unwrap_or_default();
    PgPoolOptions::new()
        .max_connections(config.database_max_connections)
        .acquire_timeout(CONNECT_TIMEOUT)
        .after_connect(move |connection, _| {
            let superadmin_id = superadmin_id.clone();
            Box::pin(async move {
                sqlx::query("SELECT set_config('yzy_contracts.superadmin_id', $1, false)")
                    .bind(superadmin_id)
                    .execute(connection)
                    .await?;
                Ok(())
            })
        })
        .connect_with(options.application_name("yzy-contracts-api"))
        .await
        .context("could not connect to PostgreSQL")
}

/// Embedded so that the deployed image carries exactly the migrations it was
/// built with. The ledger lives in the product schema, not in `public`.
pub fn migrator() -> Migrator {
    let mut migrator = sqlx::migrate!("../../supabase/migrations");
    migrator.dangerous_set_table_name("yzy_contracts._sqlx_migrations");
    migrator
}

pub async fn run_migrations(
    database_url: &str,
    superadmin_id: Option<uuid::Uuid>,
) -> anyhow::Result<()> {
    let options: PgConnectOptions = database_url
        .parse()
        .context("the migration URL is not a valid PostgreSQL URL")?;
    let superadmin = superadmin_id.map(|id| id.to_string()).unwrap_or_default();
    let pool = PgPoolOptions::new()
        .max_connections(1)
        .acquire_timeout(CONNECT_TIMEOUT)
        .connect_with(options.options([("yzy_contracts.superadmin_id", superadmin)]))
        .await
        .context("could not connect to PostgreSQL to migrate")?;
    let mut connection = pool.acquire().await?;
    let mut migrator = migrator();
    accept_previous_checksums(&mut migrator, &mut connection).await?;
    migrator
        .run(&mut *connection)
        .await
        .context("could not apply migrations")?;
    Ok(())
}

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
