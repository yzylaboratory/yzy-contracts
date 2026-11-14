mod common;

use axum::http::{Method, StatusCode};
use common::*;
use jsonwebtoken::{Algorithm, EncodingKey, Header, encode};
use serde_json::json;
use uuid::Uuid;

const ME: &str = "/api/v1/me";

async fn me_with(app: &TestApp, token: &str) -> (StatusCode, serde_json::Value) {
    app.request(Method::GET, ME, Some(token), None).await
}

#[tokio::test]
async fn health_is_public_and_checks_the_database() {
    let app = TestApp::start().await;
    let (status, body) = app.request(Method::GET, "/api/v1/health", None, None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["status"], "ok");
}

#[tokio::test]
async fn every_private_route_requires_a_token() {
    let app = TestApp::start().await;
    let id = Uuid::new_v4();
    for (method, uri) in [
        (Method::GET, ME.to_owned()),
        (Method::GET, "/api/v1/companies".to_owned()),
        (Method::POST, "/api/v1/companies".to_owned()),
        (Method::GET, "/api/v1/clients".to_owned()),
        (Method::POST, "/api/v1/clients".to_owned()),
        (Method::GET, format!("/api/v1/clients/{id}")),
        (Method::PATCH, format!("/api/v1/clients/{id}")),
        (Method::GET, format!("/api/v1/clients/{id}/operations")),
        (Method::POST, format!("/api/v1/clients/{id}/operations")),
        (
            Method::GET,
            format!("/api/v1/companies/{id}/clients/{id}/operations/{id}"),
        ),
        (
            Method::PATCH,
            format!("/api/v1/companies/{id}/clients/{id}/operations/{id}"),
        ),
        (Method::GET, format!("/api/v1/companies/{id}")),
        (Method::PUT, format!("/api/v1/companies/{id}")),
        (Method::POST, format!("/api/v1/companies/{id}/default")),
        (Method::POST, format!("/api/v1/companies/{id}/archive")),
        (Method::POST, format!("/api/v1/companies/{id}/restore")),
        (Method::POST, "/api/v1/files/upload-url".to_owned()),
        (Method::GET, "/api/v1/contracts".to_owned()),
        (Method::POST, "/api/v1/contracts".to_owned()),
        (Method::GET, format!("/api/v1/contracts/{id}")),
        (Method::PATCH, format!("/api/v1/contracts/{id}")),
        (Method::DELETE, format!("/api/v1/contracts/{id}")),
        (Method::GET, format!("/api/v1/contracts/{id}/download-url")),
        (
            Method::GET,
            format!("/api/v1/contracts/{id}/generation-access"),
        ),
        (Method::GET, "/api/v1/billing".to_owned()),
        (
            Method::PUT,
            format!("/api/v1/billing/invoices/{id}/transfer"),
        ),
        (Method::GET, "/api/v1/admin/billing/accounts".to_owned()),
        (Method::POST, "/api/v1/admin/billing/accounts".to_owned()),
        (Method::PUT, format!("/api/v1/admin/billing/accounts/{id}")),
        (Method::GET, "/api/v1/admin/billing/invoices".to_owned()),
        (Method::GET, "/api/v1/admin/dashboard".to_owned()),
        (
            Method::PUT,
            format!("/api/v1/admin/billing/invoices/{id}/verification"),
        ),
        (Method::POST, format!("/api/v1/contracts/{id}/convert")),
        (Method::GET, format!("/api/v1/conversions/{id}")),
        (Method::GET, format!("/api/v1/templates/{id}")),
        (Method::PUT, format!("/api/v1/templates/{id}")),
        (Method::GET, "/api/v1/generated-documents".to_owned()),
        (Method::GET, "/api/v1/generated-documents/stats".to_owned()),
        (Method::GET, format!("/api/v1/generated-documents/{id}")),
        (Method::PUT, format!("/api/v1/generated-documents/{id}")),
    ] {
        let (status, body) = app.request(method.clone(), &uri, None, None).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED, "{method} {uri}");
        assert_eq!(error_code(&body), "UNAUTHENTICATED");
    }
}

#[tokio::test]
async fn new_people_wait_for_access_and_the_superadmin_sees_all_companies() {
    let app = TestApp::start().await;
    let historical_user = app.user().await;
    let other_company = app.legacy_company(historical_user, "Otra empresa").await;
    let (status, body) = me_with(&app, &token_for(historical_user.id)).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["role"], "member");
    assert_eq!(body["access"], "pending");
    assert_eq!(body["companies"], json!([]));

    let user = app.superadmin().await;
    let (status, body) = me_with(&app, &token_for(user.id)).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["id"], user.id.to_string());
    assert_eq!(body["email"], common::test_email(user.id));
    assert_eq!(body["role"], "superadmin");
    assert_eq!(body["access"], "active");
    assert!(
        body["companies"]
            .as_array()
            .unwrap()
            .iter()
            .any(|company| company["id"] == json!(other_company))
    );

    let enrolled: String =
        sqlx::query_scalar("SELECT account_status FROM yzy_contracts.profiles WHERE user_id = $1")
            .bind(user.id)
            .fetch_one(&app.admin)
            .await
            .expect("profile");
    assert_eq!(enrolled, "active");
}

#[tokio::test]
async fn invalid_tokens_are_rejected() {
    let app = TestApp::start().await;
    let user = app.user().await;
    let valid = TokenSpec::valid(user.id);

    let cases = [
        (
            "expired",
            TokenSpec {
                exp_offset_secs: -3600,
                ..valid.clone()
            },
        ),
        (
            "wrong issuer",
            TokenSpec {
                iss: "https://attacker.test/auth/v1".to_owned(),
                ..valid.clone()
            },
        ),
        (
            "wrong audience",
            TokenSpec {
                aud: "other".to_owned(),
                ..valid.clone()
            },
        ),
        (
            "anon role",
            TokenSpec {
                role: "anon".to_owned(),
                ..valid.clone()
            },
        ),
        (
            "service role",
            TokenSpec {
                role: "service_role".to_owned(),
                ..valid.clone()
            },
        ),
        (
            "signed by another key",
            TokenSpec {
                key_pem: UNTRUSTED_KEY,
                ..valid.clone()
            },
        ),
        (
            "unknown kid",
            TokenSpec {
                kid: Some("unknown".to_owned()),
                ..valid.clone()
            },
        ),
        (
            "missing kid",
            TokenSpec {
                kid: None,
                ..valid.clone()
            },
        ),
        (
            "subject is not a UUID",
            TokenSpec {
                sub: "not-a-uuid".to_owned(),
                ..valid.clone()
            },
        ),
    ];
    for (name, spec) in cases {
        let (status, body) = me_with(&app, &spec.sign()).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED, "{name}: {body}");
        assert_eq!(error_code(&body), "UNAUTHENTICATED", "{name}");
    }

    let (status, _) = me_with(&app, "not.a.token").await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn symmetric_tokens_are_rejected() {
    let app = TestApp::start().await;
    let user = app.user().await;
    let mut header = Header::new(Algorithm::HS256);
    header.kid = Some(KID.to_owned());
    let token = encode(
        &header,
        &json!({"sub": user.id, "iss": ISSUER, "aud": AUDIENCE, "role": "authenticated", "exp": 4_000_000_000u64}),
        &EncodingKey::from_secret(b"guessed-secret"),
    )
    .expect("sign");
    let (status, _) = me_with(&app, &token).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn a_signed_token_for_a_user_missing_from_auth_is_rejected() {
    let app = TestApp::start().await;
    let (status, body) = me_with(&app, &token_for(common::ADMIN_ID)).await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{body}");
}

#[tokio::test]
async fn a_deleted_contracts_account_loses_access_but_keeps_its_login() {
    let app = TestApp::start().await;
    let user = app.superadmin().await;
    let (status, _) = me_with(&app, &token_for(user.id)).await;
    assert_eq!(status, StatusCode::OK);

    sqlx::query(
        "UPDATE yzy_contracts.profiles SET account_status = 'deleted', deleted_at = now()
         WHERE user_id = $1",
    )
    .bind(user.id)
    .execute(&app.admin)
    .await
    .expect("tombstone");

    let (status, body) = me_with(&app, &token_for(user.id)).await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{body}");
    assert_eq!(error_code(&body), "ACCOUNT_DELETED");
}

#[tokio::test]
async fn an_unreachable_jwks_fails_closed() {
    let app = TestApp::start().await;
    let user = app.user().await;
    app.jwks.reset().await;
    let (status, body) = me_with(&app, &token_for(user.id)).await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE, "{body}");
    assert_eq!(error_code(&body), "AUTH_UNAVAILABLE");
}

#[tokio::test]
async fn unknown_routes_use_the_shared_error_format() {
    let app = TestApp::start().await;
    let (status, body) = app.request(Method::GET, "/api/v1/nope", None, None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(error_code(&body), "NOT_FOUND");
}

#[tokio::test]
async fn openapi_documents_every_endpoint_with_bearer_auth_and_tags() {
    let app = TestApp::start().await;
    let (status, doc) = app
        .request(Method::GET, "/api-docs/openapi.json", None, None)
        .await;
    assert_eq!(status, StatusCode::OK);

    for path in [
        "/api/v1/health",
        "/api/v1/me",
        "/api/v1/me/onboarding-completion",
        "/api/v1/me/tour-events",
        "/api/v1/me/activity-events",
        "/api/v1/admin/activity",
        "/api/v1/admin/activity/{user_id}/events",
        "/api/v1/admin/requests",
        "/api/v1/admin/users",
        "/api/v1/admin/companies",
        "/api/v1/companies",
        "/api/v1/companies/{id}",
        "/api/v1/companies/{id}/default",
        "/api/v1/companies/{id}/archive",
        "/api/v1/companies/{id}/restore",
        "/api/v1/clients",
        "/api/v1/clients/{client_id}",
        "/api/v1/clients/{client_id}/operations",
        "/api/v1/companies/{company_id}/clients/{client_id}/operations/{operation_id}",
        "/api/v1/clients/{client_id}/timeline",
        "/api/v1/files/upload-url",
        "/api/v1/contracts",
        "/api/v1/contracts/{id}",
        "/api/v1/contracts/{id}/convert",
        "/api/v1/contracts/{id}/download-url",
        "/api/v1/contracts/{id}/generation-access",
        "/api/v1/billing",
        "/api/v1/billing/invoices/{id}/transfer",
        "/api/v1/admin/billing/accounts",
        "/api/v1/admin/billing/accounts/{id}",
        "/api/v1/admin/billing/bank-account",
        "/api/v1/admin/billing/invoices",
        "/api/v1/admin/billing/invoices/{id}/verification",
        "/api/v1/conversions/{id}",
        "/api/v1/templates/{id}",
        "/api/v1/generated-documents",
        "/api/v1/generated-documents/{id}",
        "/api/v1/generated-documents/stats",
    ] {
        assert!(doc["paths"][path].is_object(), "{path} is undocumented");
    }
    assert_eq!(
        doc["components"]["securitySchemes"]["bearer_auth"]["scheme"],
        "bearer"
    );
    assert!(doc["paths"]["/api/v1/contracts"]["get"]["security"].is_array());
    assert!(doc["paths"]["/api/v1/companies"]["get"]["security"].is_array());
    assert!(doc["paths"]["/api/v1/clients/{client_id}/timeline"]["get"]["security"].is_array());
    assert!(doc["paths"]["/api/v1/companies/{company_id}/clients"].is_null());
    assert!(doc["components"]["schemas"]["Client"]["properties"]["company_id"].is_null());
    assert_eq!(
        doc["components"]["schemas"]["OperationWrite"]["properties"]["company_id"]["format"],
        "uuid"
    );
    assert!(
        doc["components"]["schemas"]["OperationWrite"]["required"]
            .as_array()
            .is_some_and(|fields| fields.iter().any(|field| field == "company_id"))
    );
    assert!(doc["paths"]["/api/v1/me/tour-events"]["post"]["security"].is_array());
    assert!(doc["paths"]["/api/v1/me/activity-events"]["post"]["security"].is_array());
    assert!(doc["paths"]["/api/v1/admin/activity"]["get"]["security"].is_array());
    assert!(doc["paths"]["/api/v1/admin/activity/{user_id}/events"]["get"]["security"].is_array());
    assert!(doc["paths"]["/api/v1/health"]["get"]["security"].is_null());
    let tags: Vec<&str> = doc["tags"]
        .as_array()
        .expect("tags")
        .iter()
        .filter_map(|tag| tag["name"].as_str())
        .collect();
    assert_eq!(
        tags,
        [
            "System",
            "Users",
            "Administration",
            "Clients",
            "Companies",
            "Files",
            "Contracts",
            "Conversions",
            "Templates",
            "Generated documents",
            "Billing"
        ]
    );
}

#[tokio::test]
async fn swagger_ui_is_served() {
    let app = TestApp::start().await;
    let response = {
        use axum::{body::Body, http::Request};
        use tower::ServiceExt;
        app.router
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/swagger-ui/")
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response")
    };
    assert_eq!(response.status(), StatusCode::OK);
}

#[test]
fn committed_spec_matches_the_code() {
    let generated = yzy_contracts_api::app::openapi().to_yaml().expect("yaml");
    let committed = include_str!("../../../specs/openapi/portal-api.yaml");
    assert_eq!(
        committed, generated,
        "specs/openapi/portal-api.yaml is stale. Regenerate it: cargo run -- openapi > ../../specs/openapi/portal-api.yaml"
    );
}
