mod common;

use axum::http::{Method, StatusCode};
use common::{PDF_BYTES, PDF_MIME, TestApp, TestUser, TokenSpec, error_code, token_for};
use serde_json::{Value, json};
use uuid::Uuid;

const ME: &str = "/api/v1/me";
const ONBOARDING: &str = "/api/v1/me/onboarding-completion";
const REQUESTS: &str = "/api/v1/admin/requests";
const COMPANIES: &str = "/api/v1/companies";
const CONTRACTS: &str = "/api/v1/contracts";

async fn company(app: &TestApp, administrator: TestUser, name: &str) -> Value {
    let (status, profile) = app
        .post(
            administrator,
            COMPANIES,
            json!({"name": name, "values": {"empresa_razon_social": name}}),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{profile}");
    profile["id"].clone()
}

#[tokio::test]
async fn superadministrator_paginates_filtered_users() {
    let app = TestApp::start().await;
    let administrator = app.superadmin().await;
    let first = app.pending_user().await;
    let second = app.pending_user().await;
    let excluded = app.pending_user().await;
    for user in [first, second, excluded] {
        assert_eq!(app.get(user, ME).await.0, StatusCode::OK);
    }
    sqlx::query(
        "UPDATE yzy_contracts.access_identities SET name = 'Paginacion prueba'
         WHERE user_id = ANY($1)",
    )
    .bind([first.id, second.id])
    .execute(&app.admin)
    .await
    .unwrap();

    let users = "/api/v1/admin/users";
    let (status, legacy) = app.get(administrator, users).await;
    assert_eq!(status, StatusCode::OK, "{legacy}");
    assert_eq!(legacy["per_page"], 250);
    assert_eq!(legacy["items"].as_array().unwrap().len(), 3);

    let filter = format!("{users}?query=paginacion&status=pending&per_page=1");
    let mut seen = Vec::new();
    for page in 1..=3 {
        let (status, result) = app
            .get(administrator, &format!("{filter}&page={page}"))
            .await;
        assert_eq!(status, StatusCode::OK, "{result}");
        assert_eq!(result["total"], 2);
        assert_eq!(result["page"], page);
        assert_eq!(result["per_page"], 1);
        let items = result["items"].as_array().unwrap();
        assert_eq!(items.len(), usize::from(page < 3));
        seen.extend(items.iter().map(|item| item["id"].clone()));
    }
    assert!(seen.contains(&json!(first.id)));
    assert!(seen.contains(&json!(second.id)));

    for invalid in ["page=0", "per_page=0", "per_page=251"] {
        assert_eq!(
            app.get(administrator, &format!("{users}?{invalid}"))
                .await
                .0,
            StatusCode::UNPROCESSABLE_ENTITY
        );
    }
}

#[tokio::test]
async fn people_waiting_for_access_cannot_complete_onboarding() {
    let app = TestApp::start().await;
    let administrator = app.superadmin().await;
    let historical_member = app.user().await;
    let token = token_for(administrator.id);
    let complete = || app.request(Method::POST, ONBOARDING, Some(&token), None);

    let (status, body) = app.request(Method::POST, ONBOARDING, None, None).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(error_code(&body), "UNAUTHENTICATED");
    let (status, body) = app
        .request(
            Method::POST,
            ONBOARDING,
            Some(&token_for(historical_member.id)),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(error_code(&body), "ACCESS_PENDING");
    assert_eq!(
        app.get(administrator, ME).await.1["onboarding_pending"],
        false
    );

    let (first, second) = tokio::join!(complete(), complete());
    assert_eq!(first, (StatusCode::NO_CONTENT, Value::Null));
    assert_eq!(second, (StatusCode::NO_CONTENT, Value::Null));
    let completions = || {
        sqlx::query_as::<_, (Uuid, chrono::DateTime<chrono::Utc>)>(
            "SELECT user_id, completed_at FROM yzy_contracts.onboarding_completions",
        )
        .fetch_all(&app.admin)
    };
    let completed = completions().await.unwrap();
    assert_eq!(completed.len(), 1);
    assert_eq!(completed[0].0, administrator.id);
    assert_eq!(complete().await, (StatusCode::NO_CONTENT, Value::Null));
    assert_eq!(completions().await.unwrap(), completed);

    sqlx::query(
        "UPDATE yzy_contracts.profiles SET account_status = 'deleted', deleted_at = now()
         WHERE user_id = $1",
    )
    .bind(administrator.id)
    .execute(&app.admin)
    .await
    .unwrap();
    let (status, body) = complete().await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(error_code(&body), "ACCOUNT_DELETED");
}

#[tokio::test]
async fn onboarding_migration_backfills_only_profiles_with_active_membership() {
    let app = TestApp::start().await;
    let existing = app.user().await;
    let pending = app.pending_user().await;
    let archived = app.pending_user().await;
    let deleted = app.user().await;
    let _not_enrolled = app.user().await;
    let archived_company = app.legacy_company(archived, "Entidad archivada").await;

    for user in [existing, pending, archived, deleted] {
        sqlx::query("INSERT INTO yzy_contracts.profiles (user_id) VALUES ($1)")
            .bind(user.id)
            .execute(&app.admin)
            .await
            .unwrap();
    }
    let mut tx = app.admin.begin().await.unwrap();
    sqlx::query("UPDATE yzy_contracts.companies SET archived_at = now() WHERE id = $1")
        .bind(archived_company)
        .execute(&mut *tx)
        .await
        .unwrap();
    sqlx::query(
        "UPDATE yzy_contracts.profiles SET account_status = 'deleted', deleted_at = now()
         WHERE user_id = $1",
    )
    .bind(deleted.id)
    .execute(&mut *tx)
    .await
    .unwrap();
    // The harness clones an already migrated database. Recreate the pre-migration
    // state around these fixtures, then execute the real migration.
    sqlx::query("DROP TABLE yzy_contracts.onboarding_completions")
        .execute(&mut *tx)
        .await
        .unwrap();
    sqlx::raw_sql(include_str!(
        "../../../supabase/migrations/20261111140428_onboarding_completions.sql"
    ))
    .execute(&mut *tx)
    .await
    .unwrap();
    tx.commit().await.unwrap();

    let backfilled: Vec<Uuid> =
        sqlx::query_scalar("SELECT user_id FROM yzy_contracts.onboarding_completions")
            .fetch_all(&app.admin)
            .await
            .unwrap();
    assert_eq!(backfilled, vec![existing.id]);
    let allowed_grants: Vec<(String, String)> = sqlx::query_as(
        "SELECT grantee::text, privilege_type::text FROM information_schema.role_table_grants
         WHERE table_schema = 'yzy_contracts' AND table_name = 'onboarding_completions'
           AND grantee IN ('anon', 'authenticated', 'service_role', 'yzy_contracts_app')
         ORDER BY grantee, privilege_type",
    )
    .fetch_all(&app.admin)
    .await
    .unwrap();
    assert_eq!(
        allowed_grants,
        vec![
            ("yzy_contracts_app".to_owned(), "INSERT".to_owned()),
            ("yzy_contracts_app".to_owned(), "SELECT".to_owned()),
        ]
    );
}

#[tokio::test]
async fn superadministrator_enables_and_disables_people_without_assigning_companies() {
    let app = TestApp::start().await;
    let administrator = app.superadmin().await;
    let person = app.pending_user().await;
    let other = company(&app, administrator, "Empresa sin asignar").await;
    let access = format!("/api/v1/admin/users/{}/access", person.id);

    let (status, identity) = app.get(person, ME).await;
    assert_eq!(status, StatusCode::OK, "{identity}");
    assert_eq!(identity["role"], "member");
    assert_eq!(identity["access"], "pending");
    assert_eq!(identity["companies"], json!([]));
    for route in [CONTRACTS, REQUESTS] {
        let (status, result) = app.get(person, route).await;
        assert_eq!(status, StatusCode::FORBIDDEN, "{route}: {result}");
        assert_eq!(error_code(&result), "ACCESS_PENDING");
    }

    let (status, requests) = app.get(administrator, REQUESTS).await;
    assert_eq!(status, StatusCode::OK, "{requests}");
    assert!(
        requests["items"]
            .as_array()
            .unwrap()
            .iter()
            .any(|item| item["id"] == json!(person.id) && item["status"] == "pending")
    );

    let (status, user) = app
        .put(administrator, &access, json!({"enabled": true}))
        .await;
    assert_eq!(status, StatusCode::OK, "{user}");
    assert_eq!(user["status"], "active");
    let (status, identity) = app.get(person, ME).await;
    assert_eq!(status, StatusCode::OK, "{identity}");
    assert_eq!(identity["role"], "member");
    assert_eq!(identity["access"], "active");
    assert_eq!(identity["can_manage_billing"], false);
    assert!(
        identity["companies"]
            .as_array()
            .unwrap()
            .iter()
            .any(|item| item["id"] == other)
    );
    assert_eq!(app.get(person, CONTRACTS).await.0, StatusCode::OK);
    let (status, result) = app.get(person, REQUESTS).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(error_code(&result), "ADMIN_REQUIRED");
    let (status, result) = app
        .post(person, COMPANIES, json!({"name": "Nueva", "values": {}}))
        .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{result}");
    let membership_count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM yzy_contracts.company_memberships WHERE user_id = $1",
    )
    .bind(person.id)
    .fetch_one(&app.admin)
    .await
    .unwrap();
    assert_eq!(membership_count, 0);

    let (status, user) = app
        .put(administrator, &access, json!({"enabled": false}))
        .await;
    assert_eq!(status, StatusCode::OK, "{user}");
    assert_eq!(user["status"], "suspended");
    assert_eq!(app.get(person, ME).await.1["access"], "pending");
    let (status, result) = app.get(person, CONTRACTS).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(error_code(&result), "ACCESS_PENDING");

    let own = format!("/api/v1/admin/users/{}/access", administrator.id);
    let (status, _) = app
        .put(administrator, &own, json!({"enabled": false}))
        .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    let unknown = format!("/api/v1/admin/users/{}/access", Uuid::new_v4());
    let (status, result) = app
        .put(administrator, &unknown, json!({"enabled": true}))
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND, "{result}");
    let (status, _) = app.put(person, &access, json!({"enabled": true})).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn configured_admin_requires_confirmed_account_email() {
    let app = TestApp::start().await;
    let administrator = app.superadmin().await;
    let mut token = TokenSpec::valid(administrator.id);
    token.email = "otra@ejemplo.test".to_owned();
    let (status, result) = app
        .request(Method::GET, REQUESTS, Some(&token.sign()), None)
        .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(error_code(&result), "ADMIN_REQUIRED");
}

#[tokio::test]
async fn invitation_and_company_assignment_endpoints_are_unavailable() {
    let app = TestApp::start().await;
    let administrator = app.superadmin().await;
    let person = app.pending_user().await;
    let assignment = format!("/api/v1/admin/users/{}/companies", person.id);
    let invitation = json!({
        "email": common::test_email(person.id),
        "name": "Persona sintética",
        "company_ids": []
    });

    for (method, path, body) in [
        (
            Method::POST,
            "/api/v1/admin/invitations",
            invitation.clone(),
        ),
        (
            Method::POST,
            "/api/v1/admin/invitations/preview",
            json!({"rows": [invitation]}),
        ),
        (
            Method::POST,
            "/api/v1/admin/invitations/commit",
            json!({"rows": [invitation]}),
        ),
        (Method::PUT, assignment.as_str(), json!({"company_ids": []})),
    ] {
        let (status, result) = app
            .request(method, path, Some(&token_for(administrator.id)), Some(body))
            .await;
        assert_eq!(status, StatusCode::NOT_FOUND, "{path}: {result}");
        assert_eq!(error_code(&result), "NOT_FOUND");
    }
    let invitation_count: i64 =
        sqlx::query_scalar("SELECT count(*) FROM yzy_contracts.access_invitations")
            .fetch_one(&app.admin)
            .await
            .unwrap();
    assert_eq!(invitation_count, 0);
}

#[tokio::test]
async fn shared_contracts_validate_companies_and_remain_available_to_the_superadministrator() {
    let app = TestApp::start().await;
    let administrator = app.superadmin().await;
    let historical_member = app.user().await;
    let first = company(&app, administrator, "Empresa Uno").await;
    let second = app.legacy_company(historical_member, "Empresa Dos").await;

    let (upload_id, key) = app
        .reserve_upload(administrator, PDF_BYTES.len() as i64)
        .await;
    app.storage.put(&key, PDF_BYTES, PDF_MIME);
    let input = |ids: Value| {
        json!({
            "upload_id": upload_id,
            "name": "Modelo compartido",
            "shared_company_ids": ids
        })
    };
    for ids in [json!([]), Value::Null, json!([first, first])] {
        let (status, error) = app.post(administrator, CONTRACTS, input(ids)).await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{error}");
    }
    let mut both = input(json!([first, second]));
    both["company_id"] = Value::Null;
    assert_eq!(
        app.post(administrator, CONTRACTS, both).await.0,
        StatusCode::UNPROCESSABLE_ENTITY
    );
    let (status, error) = app
        .post(
            administrator,
            CONTRACTS,
            input(json!([first, Uuid::new_v4()])),
        )
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND, "{error}");
    assert_eq!(error_code(&error), "COMPANY_NOT_FOUND");

    let (status, contract) = app
        .post(administrator, CONTRACTS, input(json!([second, first])))
        .await;
    assert_eq!(status, StatusCode::CREATED, "{contract}");
    assert_eq!(contract["shared_company_ids"], json!([second, first]));
    assert!(contract["company_id"].is_null());
    let detail = format!("{CONTRACTS}/{}", contract["id"].as_str().unwrap());
    let download = format!("{detail}/download-url");
    let render = format!("{detail}/render-pdf");
    let convert = format!("{detail}/convert");
    let (_, renamed) = app
        .patch(administrator, &detail, json!({"name": "Modelo renombrado"}))
        .await;
    assert_eq!(renamed["shared_company_ids"], json!([second, first]));
    let (status, job) = app.post(administrator, &convert, json!({})).await;
    assert_eq!(status, StatusCode::ACCEPTED, "{job}");
    app.mock_extractor_success("# Modelo sintético").await;
    assert!(app.worker.process_next_job().await.expect("conversion"));
    let job_url = format!("/api/v1/conversions/{}", job["id"].as_str().unwrap());
    let (_, converted) = app.get(administrator, &detail).await;
    let template = format!(
        "/api/v1/templates/{}",
        converted["template_id"].as_str().unwrap()
    );
    for url in [&detail, &download, &job_url, &template] {
        assert_eq!(app.get(administrator, url).await.0, StatusCode::OK, "{url}");
        assert_eq!(
            app.get(historical_member, url).await.0,
            StatusCode::FORBIDDEN,
            "{url}"
        );
    }
    assert_eq!(
        app.post(administrator, &render, json!({})).await.0,
        StatusCode::UNSUPPORTED_MEDIA_TYPE
    );

    let archive = format!("{COMPANIES}/{second}/archive");
    assert_eq!(
        app.post(administrator, &archive, json!({})).await.0,
        StatusCode::OK
    );
    assert_eq!(app.get(administrator, &download).await.0, StatusCode::OK);
    let (status, single) = app
        .patch(administrator, &detail, json!({"company_id": first}))
        .await;
    assert_eq!(status, StatusCode::OK, "{single}");
    assert_eq!(single["company_id"], first);
    assert!(single["shared_company_ids"].is_null());
    let (status, private) = app
        .patch(administrator, &detail, json!({"company_id": null}))
        .await;
    assert_eq!(status, StatusCode::OK, "{private}");
    assert!(private["company_id"].is_null());
    assert!(private["shared_company_ids"].is_null());
}
