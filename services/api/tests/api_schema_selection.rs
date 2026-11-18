//! One binary for PROD and DEV: the schema and the runtime role are chosen at
//! startup, DEV can never read PROD, and DEV admits only its allowlist.

mod common;

use axum::http::StatusCode;
use common::{ADMIN_ID, APP_ROLE_PASSWORD, TestApp, error_code, test_email};
use sqlx::Error as SqlxError;
use uuid::Uuid;
use yzy_contracts_api::infrastructure::{database, schema::DatabaseSchema};

const FIXTURE: &str = include_str!("fixtures/dev-migration-checksums.txt");

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn sqlstate(error: &SqlxError) -> Option<String> {
    error
        .as_database_error()
        .and_then(|database_error| database_error.code())
        .map(|code| code.to_string())
}

#[test]
fn migrations_reproduce_the_recorded_prod_and_dev_checksums() {
    let prod = database::migrator(DatabaseSchema::Production);
    let dev = database::migrator(DatabaseSchema::Development);
    let mut checked = 0;
    for line in FIXTURE
        .lines()
        .filter(|line| !line.starts_with('#') && !line.trim().is_empty())
    {
        let columns: Vec<&str> = line.split('\t').collect();
        assert_eq!(columns.len(), 3, "fixture row: {line}");
        let version: i64 = columns[0].parse().expect("version");
        let prod_migration = prod
            .iter()
            .find(|migration| migration.version == version)
            .unwrap_or_else(|| panic!("PROD is missing migration {version}"));
        assert_eq!(hex(&prod_migration.checksum), columns[1], "PROD {version}");
        let dev_migration = dev
            .iter()
            .find(|migration| migration.version == version)
            .unwrap_or_else(|| panic!("DEV is missing migration {version}"));
        assert_eq!(hex(&dev_migration.checksum), columns[2], "DEV {version}");
        checked += 1;
    }
    assert!(
        checked >= 53,
        "only {checked} recorded migrations were checked"
    );
}

#[test]
fn dev_migrations_name_no_production_object() {
    for migration in database::migrator(DatabaseSchema::Development).iter() {
        let sql = migration.sql.as_str();
        assert!(
            sql.match_indices("yzy_contracts")
                .all(|(index, _)| sql[index..].starts_with("yzy_contracts_dev")),
            "migration {} still names a PROD object",
            migration.version
        );
    }
}

#[tokio::test]
async fn each_schema_keeps_its_own_ledger_with_its_own_checksums() {
    let app = TestApp::start().await;
    for (schema, table) in [
        (DatabaseSchema::Production, "yzy_contracts._sqlx_migrations"),
        (
            DatabaseSchema::Development,
            "yzy_contracts_dev._sqlx_migrations",
        ),
    ] {
        let rows: Vec<(i64, Vec<u8>)> = sqlx::query_as(sqlx::AssertSqlSafe(format!(
            "SELECT version, checksum FROM {table} ORDER BY version"
        )))
        .fetch_all(&app.admin)
        .await
        .expect("read ledger");
        let expected: Vec<(i64, Vec<u8>)> = database::migrator(schema)
            .iter()
            .map(|migration| (migration.version, migration.checksum.to_vec()))
            .collect();
        assert_eq!(rows, expected, "{table}");
    }
}

#[tokio::test]
async fn dev_connection_searches_only_the_dev_schema_with_its_superadmin_setting() {
    let app = TestApp::start_development(&[ADMIN_ID]).await;
    let (role, search_path, superadmin): (String, String, String) = sqlx::query_as(
        "SELECT current_user::text, current_setting('search_path'),
                current_setting('yzy_contracts_dev.superadmin_id')",
    )
    .fetch_one(&app.state.db)
    .await
    .expect("session settings");
    assert_eq!(role, "yzy_contracts_dev_app");
    assert_eq!(search_path, "yzy_contracts_dev");
    assert_eq!(superadmin, ADMIN_ID.to_string());
}

#[tokio::test]
async fn dev_role_cannot_read_the_production_schema() {
    let app = TestApp::start_development(&[ADMIN_ID]).await;
    let error = sqlx::query_scalar::<_, i64>("SELECT count(*) FROM yzy_contracts.profiles")
        .fetch_one(&app.state.db)
        .await
        .expect_err("DEV must not read PROD");
    assert_eq!(sqlstate(&error).as_deref(), Some("42501"));
    // Unqualified names resolve in DEV only.
    let visible: i64 = sqlx::query_scalar("SELECT count(*) FROM profiles")
        .fetch_one(&app.state.db)
        .await
        .expect("DEV profiles");
    assert_eq!(visible, 0);
}

#[tokio::test]
async fn startup_refuses_a_role_that_does_not_match_the_schema() {
    let prod = TestApp::start().await;
    let mut dev_config = (*prod.state.config).clone();
    dev_config.database_schema = DatabaseSchema::Development;
    let error = database::connect_with_options(
        prod.server_options()
            .username("yzy_contracts_app")
            .password(APP_ROLE_PASSWORD),
        &dev_config,
    )
    .await
    .expect_err("DEV schema with the PROD role must fail");
    assert!(
        format!("{error:#}").contains("requires database role yzy_contracts_dev_app"),
        "{error:#}"
    );

    let dev = TestApp::start_development(&[ADMIN_ID]).await;
    let mut prod_config = (*dev.state.config).clone();
    prod_config.database_schema = DatabaseSchema::Production;
    let error = database::connect_with_options(
        dev.server_options()
            .username("yzy_contracts_dev_app")
            .password(APP_ROLE_PASSWORD),
        &prod_config,
    )
    .await
    .expect_err("PROD schema with the DEV role must fail");
    assert!(
        format!("{error:#}").contains("requires database role yzy_contracts_app"),
        "{error:#}"
    );
}

#[tokio::test]
async fn dev_allowlist_keeps_third_parties_out_of_every_route_before_any_profile_exists() {
    let allowed = Uuid::new_v4();
    let outsider = Uuid::new_v4();
    let app = TestApp::start_development(&[ADMIN_ID, allowed]).await;
    let allowed_user = app.auth_user(allowed, &test_email(allowed)).await;
    let outsider_user = app.auth_user(outsider, &test_email(outsider)).await;

    let (status, _) = app.get(allowed_user, "/api/v1/me").await;
    assert_eq!(status, StatusCode::OK, "an allowlisted person reaches /me");
    let profiles: i64 =
        sqlx::query_scalar("SELECT count(*) FROM yzy_contracts_dev.profiles WHERE user_id = $1")
            .bind(allowed)
            .fetch_one(&app.admin)
            .await
            .expect("count");
    assert_eq!(profiles, 1, "the allowlisted profile is created in DEV");

    for uri in ["/api/v1/me", "/api/v1/contracts"] {
        let (status, body) = app.get(outsider_user, uri).await;
        assert_eq!(status, StatusCode::FORBIDDEN, "{uri}");
        assert_eq!(error_code(&body), "ACCESS_NOT_ALLOWED", "{uri}");
    }
    let dev_rows: i64 = sqlx::query_scalar(
        "SELECT (SELECT count(*) FROM yzy_contracts_dev.profiles WHERE user_id = $1)
              + (SELECT count(*) FROM yzy_contracts_dev.access_identities WHERE user_id = $1)",
    )
    .bind(outsider)
    .fetch_one(&app.admin)
    .await
    .expect("count");
    assert_eq!(dev_rows, 0, "no row is created for a third party");
    let prod_rows: i64 =
        sqlx::query_scalar("SELECT count(*) FROM yzy_contracts.profiles WHERE user_id = $1")
            .bind(outsider)
            .fetch_one(&app.admin)
            .await
            .expect("count");
    assert_eq!(prod_rows, 0, "and nothing is written to PROD either");
}
