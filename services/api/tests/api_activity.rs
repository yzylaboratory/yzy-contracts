mod common;

use std::time::Duration;

use axum::{
    body::Body,
    http::{Method, Request, StatusCode, header},
};
use common::{TestApp, TestUser, error_code, test_email, token_for};
use serde_json::{Value, json};
use tower::ServiceExt;
use uuid::Uuid;

const EVENTS: &str = "/api/v1/me/tour-events";
const ACTIVITY: &str = "/api/v1/admin/activity";
const OBSERVATIONS: &str = "/api/v1/me/activity-events";
const ME: &str = "/api/v1/me";

fn event(run_id: Uuid, event: &str, step: &str) -> Value {
    json!({"run_id": run_id, "event": event, "step": step})
}

fn timeline(user_id: Uuid) -> String {
    format!("{ACTIVITY}/{user_id}/events")
}

fn observation(event_id: Uuid, event: &str, screen: &str) -> Value {
    json!({"event_id": event_id, "event": event, "screen": screen})
}

async fn activity_for(app: &TestApp, administrator: TestUser, query: &str) -> Value {
    let (status, body) = app
        .get(administrator, &format!("{ACTIVITY}?query={query}"))
        .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["total"], 1);
    body["items"][0].clone()
}

async fn historical_profile(app: &TestApp, user: TestUser) {
    sqlx::query("INSERT INTO yzy_contracts.profiles (user_id) VALUES ($1)")
        .bind(user.id)
        .execute(&app.admin)
        .await
        .unwrap();
    sqlx::query("INSERT INTO yzy_contracts.access_identities (user_id, email) VALUES ($1, $2)")
        .bind(user.id)
        .bind(test_email(user.id))
        .execute(&app.admin)
        .await
        .unwrap();
}

#[tokio::test]
async fn tour_requires_business_access_and_accepts_only_fixed_event_payloads() {
    let app = TestApp::start().await;
    let pending = app.pending_user().await;
    let administrator = app.superadmin().await;
    let run = Uuid::new_v4();
    let opening = event(run, "opened", "clients");

    let (status, body) = app
        .request(Method::POST, EVENTS, None, Some(opening.clone()))
        .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(error_code(&body), "UNAUTHENTICATED");
    let (status, body) = app.post(pending, EVENTS, opening.clone()).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(error_code(&body), "ACCESS_PENDING");
    let (status, body) = app.post(administrator, EVENTS, opening.clone()).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(error_code(&body), "ACCESS_PENDING");
    app.legacy_company(administrator, "Empresa histórica del tour")
        .await;
    for invalid in [
        json!({"run_id": "invalid", "event": "opened", "step": "clients"}),
        event(Uuid::nil(), "opened", "clients"),
        event(run, "unrecognized", "clients"),
        event(run, "completed", "preview"),
        event(run, "step_viewed", "/clientes/example"),
        json!({"run_id": run, "event": "opened", "step": "clients", "url": "https://example.test/private"}),
        json!({"run_id": run, "event": "opened", "step": "clients", "user_id": pending.id}),
        json!({"run_id": run, "event": "opened"}),
    ] {
        let (status, body) = app.post(administrator, EVENTS, invalid).await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
        assert_eq!(error_code(&body), "VALIDATION_ERROR");
        assert_eq!(body["error"]["message"], "Invalid tour event");
    }
    let (status, body) = app
        .post(
            administrator,
            EVENTS,
            event(run, "opened", &"x".repeat(1024)),
        )
        .await;
    assert_eq!(status, StatusCode::PAYLOAD_TOO_LARGE, "{body}");
    assert_eq!(
        app.post(administrator, EVENTS, opening).await,
        (StatusCode::NO_CONTENT, Value::Null)
    );

    let stored: Vec<(Uuid, Uuid, String, String)> =
        sqlx::query_as("SELECT user_id, run_id, event, step FROM yzy_contracts.tour_events")
            .fetch_all(&app.admin)
            .await
            .unwrap();
    assert_eq!(
        stored,
        vec![(administrator.id, run, "opened".into(), "clients".into())]
    );
}

#[tokio::test]
async fn hourly_tour_limit_is_atomic_and_allows_retries() {
    let app = TestApp::start().await;
    let actor = app.superadmin().await;
    app.legacy_company(actor, "Empresa histórica del tour")
        .await;
    assert_eq!(app.get(actor, ME).await.0, StatusCode::OK);
    sqlx::query(
        "INSERT INTO yzy_contracts.tour_events (user_id, run_id, event, step)
         SELECT $1, gen_random_uuid(), 'opened', 'clients' FROM generate_series(1, 119)",
    )
    .bind(actor.id)
    .execute(&app.admin)
    .await
    .unwrap();

    let first = event(Uuid::new_v4(), "opened", "company");
    let second = event(Uuid::new_v4(), "opened", "client");
    let (a, b) = tokio::join!(
        app.post(actor, EVENTS, first.clone()),
        app.post(actor, EVENTS, second.clone())
    );
    let (winner, rejected, loser) = if a.0 == StatusCode::NO_CONTENT {
        (first, b, second)
    } else {
        assert_eq!(b.0, StatusCode::NO_CONTENT, "{b:?}");
        (second, a, first)
    };
    assert_eq!(rejected.0, StatusCode::TOO_MANY_REQUESTS, "{rejected:?}");
    assert_eq!(error_code(&rejected.1), "TOUR_RATE_LIMITED");
    assert_eq!(
        app.post(actor, EVENTS, winner).await.0,
        StatusCode::NO_CONTENT
    );
    sqlx::query(
        "UPDATE yzy_contracts.tour_events SET observed_at = now() - interval '61 minutes'
         WHERE user_id = $1 AND run_id = (
             SELECT run_id FROM yzy_contracts.tour_events WHERE user_id = $1 LIMIT 1
         )",
    )
    .bind(actor.id)
    .execute(&app.admin)
    .await
    .unwrap();
    assert_eq!(
        app.post(actor, EVENTS, loser).await.0,
        StatusCode::NO_CONTENT
    );
}

#[tokio::test]
async fn admin_activity_preserves_historical_invitation_access_and_document_aggregates() {
    let app = TestApp::start().await;
    let administrator = app.superadmin().await;
    let historical = app.user().await;
    let pending = app.pending_user().await;
    let company = app
        .legacy_company(historical, "Empresa de invitación histórica")
        .await;
    let invited_id = Uuid::new_v4();
    let invited_email = test_email(invited_id);
    historical_profile(&app, historical).await;
    historical_profile(&app, pending).await;
    sqlx::query("UPDATE yzy_contracts.access_identities SET enabled_at = now() WHERE user_id = $1")
        .bind(historical.id)
        .execute(&app.admin)
        .await
        .unwrap();
    sqlx::query(
        "INSERT INTO yzy_contracts.access_invitations (email, name, company_ids, created_at)
         VALUES ($1, 'Persona Invitada', ARRAY[$2::uuid], '2026-11-10T10:00:00Z')",
    )
    .bind(&invited_email)
    .bind(company)
    .execute(&app.admin)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO yzy_contracts.access_mail (kind, reference, sent_at)
         VALUES ('invitation', $1, '2026-11-10T12:00:00Z')",
    )
    .bind(&invited_email)
    .execute(&app.admin)
    .await
    .unwrap();

    assert_eq!(
        app.request(Method::GET, ACTIVITY, None, None).await.0,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(app.get(pending, ACTIVITY).await.0, StatusCode::FORBIDDEN);
    assert_eq!(app.get(historical, ACTIVITY).await.0, StatusCode::FORBIDDEN);
    for query in ["page=0", "per_page=101"] {
        assert_eq!(
            app.get(administrator, &format!("{ACTIVITY}?{query}"))
                .await
                .0,
            StatusCode::UNPROCESSABLE_ENTITY
        );
    }
    let response = app
        .router
        .clone()
        .oneshot(
            Request::get(ACTIVITY)
                .header(
                    header::AUTHORIZATION,
                    format!("Bearer {}", token_for(administrator.id)),
                )
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response.headers()[header::CACHE_CONTROL],
        "private, no-store"
    );

    let invited = activity_for(&app, administrator, "PERSONA%20INVITADA").await;
    assert_eq!(invited["status"], "invited");
    assert!(invited["id"].is_null());
    assert_eq!(invited["email"], invited_email);
    assert_eq!(invited["invited_at"], "2026-11-10T10:00:00Z");
    assert_eq!(invited["invitation_sent_at"], "2026-11-10T12:00:00Z");
    assert_eq!(invited["invitation_accepted"], false);
    assert!(invited["first_portal_access_at"].is_null());
    assert_eq!(invited["documents_generated"], 0);
    assert_eq!(invited["last_activity"]["event"], "invitation_sent");

    let pending_activity = activity_for(&app, administrator, &pending.id.to_string()).await;
    assert_eq!(pending_activity["status"], "pending");
    assert!(pending_activity["first_portal_access_at"].is_null());
    assert!(pending_activity["last_tour"].is_null());

    sqlx::query(
        "INSERT INTO yzy_contracts.onboarding_completions (user_id, completed_at)
         VALUES ($1, '2026-11-09T12:00:00Z')",
    )
    .bind(historical.id)
    .execute(&app.admin)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO yzy_contracts.portal_access_observations
            (user_id, first_portal_access_at, last_portal_access_at)
         VALUES ($1, '2026-11-07T12:00:00Z', '2026-11-07T14:00:00Z')",
    )
    .bind(historical.id)
    .execute(&app.admin)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO yzy_contracts.generated_documents
            (owner_id, id, contract_id, contract_name, format, filename, markdown,
             imported_from_session, created_at)
         VALUES
            ($1, gen_random_uuid(), gen_random_uuid(), 'Contrato sintético', 'pdf',
             'synthetic.pdf', 'synthetic text', false, '2026-11-08T12:00:00Z'),
            ($1, gen_random_uuid(), gen_random_uuid(), 'Importación sintética', 'pdf',
             'synthetic.pdf', 'synthetic text', true, '2026-11-09T12:00:00Z')",
    )
    .bind(historical.id)
    .execute(&app.admin)
    .await
    .unwrap();
    let prior = activity_for(&app, administrator, &historical.id.to_string()).await;
    assert_eq!(prior["status"], "active");
    assert_eq!(prior["onboarding_completed_at"], "2026-11-09T12:00:00Z");
    assert!(prior["last_tour"].is_null());
    assert_eq!(prior["first_portal_access_at"], "2026-11-07T12:00:00Z");
    assert_eq!(prior["last_portal_access_at"], "2026-11-07T14:00:00Z");
    assert_eq!(prior["documents_generated"], 1);
    assert_eq!(prior["last_document_generated_at"], "2026-11-08T12:00:00Z");
    assert!(!prior.to_string().contains("Contrato sintético"));
    let (_, events) = app.get(administrator, &timeline(historical.id)).await;
    assert_eq!(events["total"], 3);
    assert_eq!(events["items"][0], prior["last_activity"]);
    assert_eq!(events["items"][0]["event"], "document_generated");

    let (_, first_page) = app
        .get(administrator, &format!("{ACTIVITY}?per_page=2"))
        .await;
    assert_eq!(first_page["total"], 3);
    assert_eq!(first_page["items"].as_array().unwrap().len(), 2);
    let (_, empty_page) = app
        .get(administrator, &format!("{ACTIVITY}?page=3&per_page=2"))
        .await;
    assert_eq!(
        empty_page,
        json!({"items": [], "page": 3, "per_page": 2, "total": 3})
    );
}

#[tokio::test]
async fn portal_activity_accepts_only_fixed_observations_and_deduplicates_per_actor() {
    let app = TestApp::start().await;
    let administrator = app.superadmin().await;
    let pending = app.pending_user().await;
    let id = Uuid::new_v4();
    let redirect = observation(id, "portal_redirect", "administration");
    assert_eq!(
        app.request(Method::POST, OBSERVATIONS, None, Some(redirect.clone()))
            .await
            .0,
        StatusCode::UNAUTHORIZED
    );
    for input in [
        observation(Uuid::nil(), "portal_visit", "dashboard"),
        observation(id, "client_created", "clients"),
        observation(id, "portal_visit", "/clientes/synthetic"),
        observation(id, "not_found", "clients"),
        observation(id, "document_previewed", "generated_documents"),
        json!({"event_id": id, "event": "portal_redirect", "screen": "preaccess", "user_id": pending.id}),
        json!({"event_id": id, "event": "portal_visit", "screen": "dashboard", "occurred_at": "2025-01-01T00:00:00Z"}),
    ] {
        let (status, body) = app.post(administrator, OBSERVATIONS, input).await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
        assert_eq!(body["error"]["message"], "Invalid activity event");
    }
    assert_eq!(
        app.post(
            administrator,
            OBSERVATIONS,
            observation(id, "portal_visit", &"x".repeat(1024))
        )
        .await
        .0,
        StatusCode::PAYLOAD_TOO_LARGE
    );
    let (first, duplicate) = tokio::join!(
        app.post(administrator, OBSERVATIONS, redirect.clone()),
        app.post(administrator, OBSERVATIONS, redirect),
    );
    assert_eq!(first, (StatusCode::NO_CONTENT, Value::Null));
    assert_eq!(duplicate, first);
    assert_eq!(
        app.post(
            administrator,
            OBSERVATIONS,
            observation(id, "portal_visit", "preaccess")
        )
        .await
        .0,
        StatusCode::NO_CONTENT
    );
    assert_eq!(
        app.post(
            pending,
            OBSERVATIONS,
            observation(id, "not_found", "not_found")
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );

    let insurance_id = Uuid::new_v4();
    assert_eq!(
        app.post(
            administrator,
            OBSERVATIONS,
            observation(insurance_id, "portal_visit", "insurance")
        )
        .await
        .0,
        StatusCode::NO_CONTENT
    );

    let route = timeline(administrator.id);
    assert_eq!(
        app.request(Method::GET, &route, None, None).await.0,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(app.get(pending, &route).await.0, StatusCode::FORBIDDEN);
    assert_eq!(
        app.get(administrator, &timeline(Uuid::new_v4())).await.0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        app.get(administrator, &format!("{route}?per_page=101"))
            .await
            .0,
        StatusCode::UNPROCESSABLE_ENTITY
    );
    let response = app
        .router
        .clone()
        .oneshot(
            Request::get(&route)
                .header(
                    header::AUTHORIZATION,
                    format!("Bearer {}", token_for(administrator.id)),
                )
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response.headers()[header::CACHE_CONTROL],
        "private, no-store"
    );
    let (_, page) = app.get(administrator, &route).await;
    assert_eq!(page["total"], 2);
    assert_eq!(page["page"], 1);
    assert_eq!(page["per_page"], 25);
    assert_eq!(page["items"][0]["event"], "portal_visit");
    assert_eq!(page["items"][0]["screen"], "insurance");
    let record = &page["items"][1];
    assert_eq!(record.as_object().unwrap().len(), 5);
    assert_eq!(record["event"], "portal_redirect");
    assert_eq!(record["screen"], "administration");
    assert_eq!(record["result"], "observed");
    assert!(record["occurred_at"].is_string());
    assert!(record["step"].is_null());
}

#[tokio::test]
async fn timeline_pages_have_stable_ties_and_latest_event_matches_the_summary() {
    let app = TestApp::start().await;
    let administrator = app.superadmin().await;
    let user = app.user().await;
    historical_profile(&app, user).await;
    sqlx::query(
        "INSERT INTO yzy_contracts.portal_access_observations
            (user_id, first_portal_access_at, last_portal_access_at)
         VALUES ($1, '2026-11-01T12:00:00Z', '2026-11-02T12:00:00Z')",
    )
    .bind(user.id)
    .execute(&app.admin)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO yzy_contracts.tour_events (user_id, run_id, event, step, observed_at)
         VALUES ($1, $2, 'opened', 'clients', '2026-11-01T12:00:00Z'),
                ($1, $2, 'step_viewed', 'preview', '2026-11-02T12:00:00Z'),
                ($1, $2, 'completed', 'done', '2026-11-02T12:00:00Z')",
    )
    .bind(user.id)
    .bind(Uuid::new_v4())
    .execute(&app.admin)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO yzy_contracts.portal_activity_events
            (user_id, client_event_id, event, screen, result)
         VALUES ($1, gen_random_uuid(), 'document_previewed', 'document_generate', 'observed')",
    )
    .bind(user.id)
    .execute(&app.admin)
    .await
    .unwrap();
    let route = timeline(user.id);
    let (_, page) = app.get(administrator, &route).await;
    let expected = page["items"].as_array().unwrap();
    assert_eq!(expected.len(), 6);
    assert_eq!(expected[0]["event"], "document_previewed");
    assert_eq!(expected[1]["event"], "portal_access");
    assert_eq!(expected[2]["event"], "tour_completed");
    assert_eq!(expected[2]["step"], "done");
    assert_eq!(expected[3]["step"], "preview");
    let summary = activity_for(&app, administrator, &user.id.to_string()).await;
    assert_eq!(summary["last_activity"], expected[0]);
    let mut actual = Vec::new();
    for page in 1..=4 {
        let (status, body) = app
            .get(administrator, &format!("{route}?page={page}&per_page=2"))
            .await;
        assert_eq!(status, StatusCode::OK, "{body}");
        assert_eq!(body["total"], 6);
        assert_eq!(body["page"], page);
        assert_eq!(body["per_page"], 2);
        actual.extend_from_slice(body["items"].as_array().unwrap());
    }
    assert_eq!(&actual, expected);
}

#[tokio::test]
async fn observation_limit_preserves_idempotence() {
    let app = TestApp::start().await;
    let user = app.superadmin().await;
    let input = observation(Uuid::new_v4(), "portal_visit", "preaccess");
    assert_eq!(
        app.post(user, OBSERVATIONS, input.clone()).await.0,
        StatusCode::NO_CONTENT
    );
    sqlx::query(
        "INSERT INTO yzy_contracts.portal_activity_events (user_id, client_event_id, event, screen, result)
         SELECT $1, gen_random_uuid(), 'portal_visit', 'preaccess', 'observed'
         FROM generate_series(1, 239)",
    ).bind(user.id).execute(&app.admin).await.unwrap();
    let (status, error) = app
        .post(
            user,
            OBSERVATIONS,
            observation(Uuid::new_v4(), "portal_visit", "preaccess"),
        )
        .await;
    assert_eq!(status, StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(error_code(&error), "ACTIVITY_RATE_LIMITED");
    assert_eq!(
        app.post(user, OBSERVATIONS, input.clone()).await.0,
        StatusCode::NO_CONTENT
    );
}

#[tokio::test]
async fn server_observes_allowed_outcomes_without_changing_the_response() {
    let app = TestApp::start().await;
    let user = app.superadmin().await;
    let pending = app.pending_user().await;
    let company = app.legacy_company(user, "Empresa sintética").await;
    let clients = "/api/v1/clients";
    let input = json!({"name": "Cliente sintético", "identity": "000-0000000-0"});
    let (status, saved) = app.post(user, clients, input.clone()).await;
    assert_eq!(status, StatusCode::CREATED, "{saved}");
    let client = format!("{clients}/{}", saved["id"].as_str().unwrap());
    assert_eq!(
        app.patch(user, &client, json!({"name": null})).await.0,
        StatusCode::UNPROCESSABLE_ENTITY
    );
    assert_eq!(app.get(user, &client).await.0, StatusCode::OK);
    assert_eq!(
        app.post(pending, clients, input.clone()).await.0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        app.request(Method::POST, clients, None, Some(input.clone()))
            .await
            .0,
        StatusCode::UNAUTHORIZED
    );

    let contract = app.create_contract(user, "Modelo sintético").await;
    let contract_id = contract["id"].as_str().unwrap();
    let access = format!("/api/v1/contracts/{contract_id}/generation-access");
    assert_eq!(app.get(user, &access).await.0, StatusCode::NO_CONTENT);
    assert_eq!(app.get(pending, &access).await.0, StatusCode::FORBIDDEN);
    let render = format!("/api/v1/contracts/{contract_id}/render-pdf");
    assert_eq!(
        app.post(pending, &render, json!({})).await.0,
        StatusCode::FORBIDDEN
    );
    let document = format!("/api/v1/generated-documents/{}", Uuid::new_v4());
    let payload = json!({"contract_id": contract_id, "format": "pdf", "filename": "synthetic.pdf", "markdown": "Synthetic text"});
    assert_eq!(
        app.put(user, &document, payload.clone()).await.0,
        StatusCode::CREATED
    );
    assert_eq!(app.put(user, &document, payload).await.0, StatusCode::OK);
    assert_eq!(
        app.put(pending, &document, json!({})).await.0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        app.put(pending, &format!("{document}/artifact"), json!({}))
            .await
            .0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        app.patch(
            user,
            &format!("/api/v1/contracts/{contract_id}"),
            json!({"company_id": company})
        )
        .await
        .0,
        StatusCode::OK
    );
    let operations = format!("{client}/operations");
    let (status, operation) = app
        .post(
            user,
            &operations,
            json!({"company_id": company, "contract_id": contract_id, "vehicle": {"registration_number": "REG-SINT"}}),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{operation}");
    let operation_id = operation["id"].as_str().unwrap();
    let client_id = saved["id"].as_str().unwrap();
    let operation_detail =
        format!("/api/v1/companies/{company}/clients/{client_id}/operations/{operation_id}");
    assert_eq!(
        app.patch(
            user,
            &operation_detail,
            json!({"vehicle": {"registration_number": "REG-SINT-EDITADO"}})
        )
        .await
        .0,
        StatusCode::OK
    );

    let expected = vec![
        (user.id, "client_created", "clients", "success"),
        (user.id, "client_updated", "client_record", "failed"),
        (user.id, "operation_created", "client_record", "success"),
        (user.id, "operation_updated", "client_record", "success"),
    ];
    let rows =
        tokio::time::timeout(Duration::from_secs(3), async {
            loop {
                let rows: Vec<(Uuid, String, String, String)> = sqlx::query_as(
                "SELECT user_id, event, screen, result FROM yzy_contracts.portal_activity_events
                 WHERE client_event_id IS NULL",
            ).fetch_all(&app.admin).await.unwrap();
                if rows.len() >= expected.len() {
                    break rows;
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .expect("the activity writes finish");
    let mut expected = expected
        .into_iter()
        .map(|(user, event, screen, result)| {
            (user, event.to_owned(), screen.to_owned(), result.to_owned())
        })
        .collect::<Vec<_>>();
    expected.sort();
    let mut rows = rows;
    rows.sort();
    assert_eq!(rows, expected);

    let (_, page) = app.get(user, &timeline(user.id)).await;
    assert_eq!(page["total"], 5);
    let serialized = page.to_string();
    for private in [
        contract_id,
        operation_id,
        saved["id"].as_str().unwrap(),
        "synthetic.pdf",
        "Cliente sintético",
        "Synthetic text",
    ] {
        assert!(!serialized.contains(private));
    }
    sqlx::query("DROP TABLE yzy_contracts.portal_activity_events")
        .execute(&app.admin)
        .await
        .unwrap();
    assert_eq!(
        app.post(user, clients, json!({"name": "Otro cliente sintético"}))
            .await
            .0,
        StatusCode::CREATED
    );
}

#[tokio::test]
async fn telemetry_is_private_and_an_observation_failure_does_not_block_me() {
    let app = TestApp::start().await;
    let user = app.superadmin().await;
    app.legacy_company(user, "Empresa del historial").await;
    let private: bool = sqlx::query_scalar(
        "SELECT bool_and(NOT has_table_privilege(role_name, table_name, 'SELECT,INSERT,UPDATE,DELETE')
                         AND NOT has_any_column_privilege(role_name, table_name, 'SELECT,INSERT,UPDATE'))
         FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) AS roles(role_name),
              unnest(ARRAY['yzy_contracts.tour_events', 'yzy_contracts.portal_access_observations',
                           'yzy_contracts.portal_activity_events']) AS tables(table_name)",
    )
    .fetch_one(&app.admin)
    .await
    .unwrap();
    assert!(private);
    let app_can_update_only_last_access: bool = sqlx::query_scalar(
        "SELECT has_column_privilege('yzy_contracts_app', 'yzy_contracts.portal_access_observations',
                                     'last_portal_access_at', 'UPDATE')
           AND NOT has_column_privilege('yzy_contracts_app', 'yzy_contracts.portal_access_observations',
                                         'first_portal_access_at', 'UPDATE')
           AND NOT has_table_privilege('yzy_contracts_app', 'yzy_contracts.tour_events', 'UPDATE,DELETE')
           AND NOT has_table_privilege('yzy_contracts_app', 'yzy_contracts.portal_activity_events', 'UPDATE,DELETE')
           AND NOT has_column_privilege('yzy_contracts_app', 'yzy_contracts.portal_activity_events',
                                         'occurred_at', 'INSERT')
           AND NOT has_table_privilege('yzy_contracts_app', 'auth.users', 'SELECT')",
    )
    .fetch_one(&app.admin)
    .await
    .unwrap();
    assert!(app_can_update_only_last_access);
    let policies_enabled: bool = sqlx::query_scalar(
        "SELECT count(*) = 3 AND bool_and(relrowsecurity) FROM pg_class
         WHERE oid IN ('yzy_contracts.tour_events'::regclass,
                       'yzy_contracts.portal_access_observations'::regclass,
                       'yzy_contracts.portal_activity_events'::regclass)",
    )
    .fetch_one(&app.admin)
    .await
    .unwrap();
    assert!(policies_enabled);

    sqlx::query("DROP TABLE yzy_contracts.portal_access_observations")
        .execute(&app.admin)
        .await
        .unwrap();
    let (status, body) = app.get(user, ME).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["access"], "active");
}
