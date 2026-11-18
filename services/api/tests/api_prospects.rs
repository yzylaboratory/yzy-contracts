mod common;

use axum::http::{Method, StatusCode};
use chrono::{DateTime, Duration, Utc};
use common::{ADMIN_ID, TestApp, error_code};
use serde_json::json;
use uuid::Uuid;

const CHECK: &str = "/api/v1/public/prospect-links/check";
const SUBMIT: &str = "/api/v1/public/prospect-links/submit";

fn links_for(company: Uuid) -> String {
    format!("/api/v1/companies/{company}/prospect-links")
}

fn prospects_for(company: Uuid) -> String {
    format!("/api/v1/companies/{company}/prospects")
}

fn convert(company: Uuid, prospect: Uuid) -> String {
    format!("/api/v1/companies/{company}/prospects/{prospect}/convert")
}

fn submission(token: &str, identity: &str) -> serde_json::Value {
    json!({
        "token": token,
        "name": "Prospecto sintético",
        "identity": identity,
        "phone": "809-555-0100",
        "address": "Calle ficticia"
    })
}

#[tokio::test]
async fn prospect_link_lifecycle_is_single_use_and_converts_into_a_client() {
    let app = TestApp::start().await;
    let owner = app.superadmin().await;
    let company = app.legacy_company(owner, "Empresa sintética").await;

    // A pending (not yet enabled) account cannot create a link.
    let pending = app.pending_user().await;
    let (status, error) = app
        .post(
            pending,
            &links_for(company),
            json!({"identity": "000-0000001-1"}),
        )
        .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{error}");
    assert_eq!(error_code(&error), "ACCESS_PENDING");

    // An unknown token behaves exactly like an invalid one: same 404.
    for bad_token in ["not-a-valid-token", &"0".repeat(64), &"f".repeat(64)] {
        let (status, error) = app
            .request(
                Method::POST,
                CHECK,
                None,
                Some(json!({"token": bad_token, "identity": "000-0000001-1"})),
            )
            .await;
        assert_eq!(status, StatusCode::NOT_FOUND, "{bad_token}: {error}");
        assert_eq!(error_code(&error), "PROSPECT_LINK_NOT_FOUND");
    }

    let (status, link) = app
        .post(
            owner,
            &links_for(company),
            json!({"identity": "000-0000001-1"}),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{link}");
    let expires_at = link["expires_at"]
        .as_str()
        .unwrap()
        .parse::<DateTime<Utc>>()
        .unwrap();
    let remaining = expires_at - Utc::now();
    assert!(remaining > Duration::hours(24) - Duration::minutes(1));
    assert!(remaining <= Duration::hours(24));
    let token = link["token"].as_str().unwrap().to_owned();
    assert_eq!(token.len(), 64);
    assert!(token.bytes().all(|byte| byte.is_ascii_hexdigit()));

    let (status, _) = app
        .request(
            Method::POST,
            CHECK,
            None,
            Some(json!({"token": token, "identity": "000-0000001-1"})),
        )
        .await;
    assert_eq!(status, StatusCode::NO_CONTENT);

    let (status, _) = app
        .request(
            Method::POST,
            SUBMIT,
            None,
            Some(submission(&token, "000-0000002-2")),
        )
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    // Deny-unknown-fields and required fields are enforced before touching the link.
    let mut extra = submission(&token, "000-0000001-1");
    extra["requested_amount_minor"] = json!(10_000);
    assert_eq!(
        app.request(Method::POST, SUBMIT, None, Some(extra)).await.0,
        StatusCode::UNPROCESSABLE_ENTITY
    );
    let mut missing_address = submission(&token, "000-0000001-1");
    missing_address.as_object_mut().unwrap().remove("address");
    assert_eq!(
        app.request(Method::POST, SUBMIT, None, Some(missing_address))
            .await
            .0,
        StatusCode::UNPROCESSABLE_ENTITY
    );

    let mut full_submission = submission(&token, "000-0000001-1");
    full_submission["email"] = json!("prospecto@ejemplo.test");
    full_submission["nationality"] = json!("dominicana");
    full_submission["marital_status"] = json!("soltero");
    full_submission["position"] = json!("técnico");
    let (first, second) = tokio::join!(
        app.request(Method::POST, SUBMIT, None, Some(full_submission.clone())),
        app.request(Method::POST, SUBMIT, None, Some(full_submission)),
    );
    let mut statuses = [first.0, second.0];
    statuses.sort();
    assert_eq!(statuses, [StatusCode::NO_CONTENT, StatusCode::NOT_FOUND]);

    // Single use: the same token can neither be checked nor submitted again.
    assert_eq!(
        app.request(
            Method::POST,
            CHECK,
            None,
            Some(json!({"token": token, "identity": "000-0000001-1"}))
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    let (status, error) = app
        .request(
            Method::POST,
            SUBMIT,
            None,
            Some(submission(&token, "000-0000002-2")),
        )
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND, "{error}");
    assert_eq!(error_code(&error), "PROSPECT_LINK_NOT_FOUND");

    let (status, list) = app.get(owner, &prospects_for(company)).await;
    assert_eq!(status, StatusCode::OK, "{list}");
    let items = list["items"].as_array().unwrap();
    assert_eq!(items.len(), 1);
    let prospect = &items[0];
    assert_eq!(prospect["name"], "PROSPECTO SINTÉTICO");
    assert_eq!(prospect["identity"], "000-0000001-1");
    assert_eq!(prospect["email"], "prospecto@ejemplo.test");
    assert_eq!(prospect["nationality"], "DOMINICANA");
    assert_eq!(prospect["marital_status"], "SOLTERO");
    assert_eq!(prospect["position"], "TÉCNICO");
    let prospect_id = Uuid::parse_str(prospect["id"].as_str().unwrap()).unwrap();

    let (status, converted) = app
        .post(owner, &convert(company, prospect_id), json!({}))
        .await;
    assert_eq!(status, StatusCode::OK, "{converted}");
    let client_id = converted["client_id"].as_str().unwrap();

    let (_, after) = app.get(owner, &prospects_for(company)).await;
    assert_eq!(after["items"], json!([]));

    let (status, client) = app
        .get(owner, &format!("/api/v1/clients/{client_id}"))
        .await;
    assert_eq!(status, StatusCode::OK, "{client}");
    assert_eq!(client["name"], "PROSPECTO SINTÉTICO");
    assert_eq!(client["identity"], "000-0000001-1");
    assert_eq!(client["profile"]["nationality"], "DOMINICANA");
    assert_eq!(client["profile"]["position"], "TÉCNICO");

    // The pending record was removed once converted; converting again 404s.
    let (status, error) = app
        .post(owner, &convert(company, prospect_id), json!({}))
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND, "{error}");
    assert_eq!(error_code(&error), "PROSPECT_NOT_FOUND");

    let private: bool = sqlx::query_scalar(
        "SELECT bool_and(relrowsecurity AND NOT has_table_privilege('anon', oid, 'SELECT')
          AND NOT has_table_privilege('authenticated', oid, 'SELECT')
          AND NOT has_table_privilege('service_role', oid, 'SELECT'))
         FROM pg_class
         WHERE oid IN ('yzy_contracts.prospects'::regclass, 'yzy_contracts.prospect_links'::regclass)",
    )
    .fetch_one(&app.admin)
    .await
    .unwrap();
    assert!(private);
}

#[tokio::test]
async fn expired_link_is_reported_as_unavailable_like_an_unknown_token() {
    let app = TestApp::start().await;
    let owner = app.superadmin().await;
    let company = app.legacy_company(owner, "Empresa con enlaces").await;
    let (_, link) = app
        .post(
            owner,
            &links_for(company),
            json!({"identity": "000-0000003-3"}),
        )
        .await;
    let token = link["token"].as_str().unwrap().to_owned();

    sqlx::query("UPDATE yzy_contracts.prospect_links SET expires_at = now() - interval '1 second'")
        .execute(&app.admin)
        .await
        .unwrap();

    let (status, error) = app
        .request(
            Method::POST,
            CHECK,
            None,
            Some(json!({"token": token, "identity": "000-0000003-3"})),
        )
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND, "{error}");
    assert_eq!(error_code(&error), "PROSPECT_LINK_NOT_FOUND");

    let (status, error) = app
        .request(
            Method::POST,
            SUBMIT,
            None,
            Some(submission(&token, "000-0000003-3")),
        )
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND, "{error}");
    assert_eq!(error_code(&error), "PROSPECT_LINK_NOT_FOUND");

    // Nothing was recorded for the expired attempt.
    let (_, list) = app.get(owner, &prospects_for(company)).await;
    assert_eq!(list["items"], json!([]));
}

#[tokio::test]
async fn converting_a_prospect_never_overwrites_an_existing_client() {
    let app = TestApp::start().await;
    let owner = app.superadmin().await;
    let company = app.legacy_company(owner, "Empresa duplicada").await;
    let (status, existing) = app
        .post(
            owner,
            "/api/v1/clients",
            json!({"name": "Cliente existente", "identity": "000-0000009-9"}),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{existing}");

    let (_, link) = app
        .post(
            owner,
            &links_for(company),
            json!({"identity": "000-0000009-9"}),
        )
        .await;
    let token = link["token"].as_str().unwrap().to_owned();
    let (status, _) = app
        .request(
            Method::POST,
            SUBMIT,
            None,
            Some(submission(&token, "000 0000009 9")),
        )
        .await;
    assert_eq!(status, StatusCode::NO_CONTENT);

    let (_, list) = app.get(owner, &prospects_for(company)).await;
    let prospect_id = Uuid::parse_str(list["items"][0]["id"].as_str().unwrap()).unwrap();
    let (status, error) = app
        .post(owner, &convert(company, prospect_id), json!({}))
        .await;
    assert_eq!(status, StatusCode::CONFLICT, "{error}");
    assert_eq!(error_code(&error), "CLIENT_IDENTITY_CONFLICT");

    // Still pending: the conflict rolled back the whole conversion.
    let (_, still_pending) = app.get(owner, &prospects_for(company)).await;
    assert_eq!(still_pending["items"].as_array().unwrap().len(), 1);
    let existing_detail = format!("/api/v1/clients/{}", existing["id"].as_str().unwrap());
    let (_, unchanged) = app.get(owner, &existing_detail).await;
    assert_eq!(unchanged["name"], "CLIENTE EXISTENTE");
    assert_eq!(unchanged, existing);
}

#[tokio::test]
async fn prospects_and_conversion_are_isolated_per_company() {
    let app = TestApp::start().await;
    let owner = app.superadmin().await;
    let company_a = app.legacy_company(owner, "Empresa A").await;
    let company_b = app.legacy_company(owner, "Empresa B").await;

    let (_, link) = app
        .post(
            owner,
            &links_for(company_a),
            json!({"identity": "000-0000004-4"}),
        )
        .await;
    let token = link["token"].as_str().unwrap().to_owned();
    let (status, _) = app
        .request(
            Method::POST,
            SUBMIT,
            None,
            Some(submission(&token, "000-0000004-4")),
        )
        .await;
    assert_eq!(status, StatusCode::NO_CONTENT);

    // Company B sees nothing: the prospect belongs to company A.
    let (_, empty) = app.get(owner, &prospects_for(company_b)).await;
    assert_eq!(empty["items"], json!([]));
    let (_, list_a) = app.get(owner, &prospects_for(company_a)).await;
    let prospect_id = Uuid::parse_str(list_a["items"][0]["id"].as_str().unwrap()).unwrap();

    // Converting through the wrong company's path 404s; the record survives.
    let (status, error) = app
        .post(owner, &convert(company_b, prospect_id), json!({}))
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND, "{error}");
    assert_eq!(error_code(&error), "PROSPECT_NOT_FOUND");
    let (_, still_there) = app.get(owner, &prospects_for(company_a)).await;
    assert_eq!(still_there["items"].as_array().unwrap().len(), 1);

    let (status, converted) = app
        .post(owner, &convert(company_a, prospect_id), json!({}))
        .await;
    assert_eq!(status, StatusCode::OK, "{converted}");

    // A nonexistent company behaves the same as an inaccessible one.
    let (status, error) = app
        .post(
            owner,
            &links_for(Uuid::new_v4()),
            json!({"identity": "000-0000004-4"}),
        )
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND, "{error}");
    assert_eq!(error_code(&error), "COMPANY_NOT_FOUND");
}

#[tokio::test]
async fn dev_prospect_submission_stays_in_the_dev_schema() {
    let app = TestApp::start_development(&[ADMIN_ID]).await;
    let owner = app.superadmin().await;
    let company: Uuid = sqlx::query_scalar(
        "INSERT INTO yzy_contracts_dev.companies (owner_id, name, variable_values)
         VALUES ($1, 'Empresa DEV sintética', $2) RETURNING id",
    )
    .bind(owner.id)
    .bind(sqlx::types::Json(
        json!({"empresa_razon_social": "Empresa DEV sintética"}),
    ))
    .fetch_one(&app.admin)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO yzy_contracts_dev.company_memberships (user_id, company_id) VALUES ($1, $2)",
    )
    .bind(owner.id)
    .bind(company)
    .execute(&app.admin)
    .await
    .unwrap();

    let (status, link) = app
        .post(
            owner,
            &links_for(company),
            json!({"identity": "000-0000008-8"}),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{link}");
    let token = link["token"].as_str().unwrap();
    let (status, _) = app
        .request(
            Method::POST,
            SUBMIT,
            None,
            Some(submission(token, "000-0000008-8")),
        )
        .await;
    assert_eq!(status, StatusCode::NO_CONTENT);

    let (status, list) = app.get(owner, &prospects_for(company)).await;
    assert_eq!(status, StatusCode::OK, "{list}");
    assert_eq!(list["items"][0]["identity"], "000-0000008-8");
    let prod_count: i64 = sqlx::query_scalar("SELECT count(*) FROM yzy_contracts.prospects")
        .fetch_one(&app.admin)
        .await
        .unwrap();
    assert_eq!(prod_count, 0);
}

#[tokio::test]
async fn prospect_link_rejects_a_different_identity_and_limits_failed_checks() {
    let app = TestApp::start().await;
    let owner = app.superadmin().await;
    let company = app.legacy_company(owner, "Empresa sintética").await;
    let route = links_for(company);
    assert_eq!(
        app.post(owner, &route, json!({})).await.0,
        StatusCode::UNPROCESSABLE_ENTITY
    );
    let (status, link) = app
        .post(owner, &route, json!({"identity":"00000000011"}))
        .await;
    assert_eq!(status, StatusCode::CREATED);
    for _ in 0..5 {
        let (status, _) = app
            .request(
                Method::POST,
                CHECK,
                None,
                Some(json!({"token":link["token"],"identity":"000-0000002-2"})),
            )
            .await;
        assert_eq!(status, StatusCode::NOT_FOUND);
    }
    let (status, _) = app
        .request(
            Method::POST,
            CHECK,
            None,
            Some(json!({"token":link["token"],"identity":"000-0000001-1"})),
        )
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (_, list) = app.get(owner, &prospects_for(company)).await;
    assert_eq!(list["items"], json!([]));
}
