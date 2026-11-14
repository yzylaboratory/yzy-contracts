mod common;

use std::time::Duration;

use axum::http::StatusCode;
use common::*;
use serde_json::{Value, json};
use uuid::Uuid;
use wiremock::{
    Mock, ResponseTemplate,
    matchers::{header, method, path},
};

async fn contract_and_job(app: &TestApp, user: TestUser) -> (String, Value) {
    let contract = app.create_contract(user, "Contrato").await;
    let id = contract["id"].as_str().expect("id").to_owned();
    let (status, job) = app
        .post(user, &format!("/api/v1/contracts/{id}/convert"), json!({}))
        .await;
    assert_eq!(status, StatusCode::ACCEPTED, "{job}");
    (id, job)
}

async fn job_state(app: &TestApp, user: TestUser, job: &Value) -> Value {
    let (status, body) = app
        .get(
            user,
            &format!(
                "/api/v1/conversions/{}",
                job["id"].as_str().expect("job id")
            ),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    body
}

async fn contract_status(app: &TestApp, user: TestUser, id: &str) -> String {
    let (_, body) = app.get(user, &format!("/api/v1/contracts/{id}")).await;
    body["status"].as_str().expect("status").to_owned()
}

#[tokio::test]
async fn the_full_flow_produces_an_editable_template() {
    let app = TestApp::start().await;
    let user = app.superadmin().await;
    let markdown = "# Contrato\n\n## Primera. Objeto\n\n1. Cláusula\n\n| a | b |\n|---|---|\n";
    // Only a request with the service token gets a result.
    Mock::given(method("POST"))
        .and(path(EXTRACT_PATH))
        .and(header("x-internal-api-key", EXTRACTOR_KEY))
        .respond_with(extract_response(
            markdown,
            Some(3),
            json!([{"code": "OCR_APPLIED", "message": "Review the OCR text."}]),
        ))
        .expect(1)
        .mount(&app.extractor)
        .await;

    let (id, job) = contract_and_job(&app, user).await;
    assert_eq!(job["status"], "pending");
    assert_eq!(contract_status(&app, user, &id).await, "converting");

    assert!(app.worker.process_next_job().await.expect("work"));

    let finished = job_state(&app, user, &job).await;
    assert_eq!(finished["status"], "completed");
    assert_eq!(finished["attempts"], 1);
    assert_eq!(finished["page_count"], 3);
    assert_eq!(finished["warnings"][0]["code"], "OCR_APPLIED");
    assert_eq!(contract_status(&app, user, &id).await, "converted");

    let requests = app.extractor.received_requests().await.expect("requests");
    let sent: Value = requests[0].body_json().expect("json");
    assert_eq!(sent["document"]["content_type"], PDF_MIME);
    assert_eq!(sent["document"]["filename"], "contrato.pdf");
    assert_eq!(sent["job_id"], job["id"]);
    assert_eq!(sent["options"]["ocr_mode"], "auto");
    assert_eq!(sent["options"]["ocr_languages"], json!(["es", "en"]));
    assert!(
        sent["document"]["download_url"]
            .as_str()
            .expect("url")
            .contains("op=get")
    );

    let template_uri = format!(
        "/api/v1/templates/{}",
        finished["template_id"].as_str().expect("template id")
    );
    let (status, template) = app.get(user, &template_uri).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        template["content_markdown"], markdown,
        "stored byte for byte"
    );
    assert_eq!(template["contract_id"], id);
    assert_eq!(template["name"], "Contrato");

    let edited = "# Contrato\n\n## Primera. Objeto editado\n";
    let (status, updated) = app
        .put(
            user,
            &template_uri,
            json!({"name": "Plantilla", "content_markdown": edited}),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{updated}");
    assert_eq!(updated["content_markdown"], edited);

    let (_, reread) = app.get(user, &template_uri).await;
    assert_eq!(reread["content_markdown"], edited, "the edit persists");
    assert_eq!(reread["name"], "Plantilla");
    assert_eq!(reread["contract_id"], id, "the contract link is kept");

    let intruder = app.user().await;
    let (status, body) = app.get(intruder, &template_uri).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(error_code(&body), "ACCESS_PENDING");
    let (status, _) = app
        .put(
            intruder,
            &template_uri,
            json!({"name": "x", "content_markdown": "robado"}),
        )
        .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, body) = app
        .get(
            intruder,
            &format!("/api/v1/conversions/{}", job["id"].as_str().expect("id")),
        )
        .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(error_code(&body), "ACCESS_PENDING");
    let (_, reread) = app.get(user, &template_uri).await;
    assert_eq!(
        reread["content_markdown"], edited,
        "the intruder changed nothing"
    );

    // Converting again would overwrite the user's edits.
    let (status, body) = app
        .post(user, &format!("/api/v1/contracts/{id}/convert"), json!({}))
        .await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(error_code(&body), "CONTRACT_ALREADY_CONVERTED");
}

#[tokio::test]
async fn template_updates_are_validated() {
    let app = TestApp::start().await;
    let user = app.superadmin().await;
    app.mock_extractor_success("# Contrato").await;
    let (_, job) = contract_and_job(&app, user).await;
    app.worker.process_next_job().await.expect("work");
    let finished = job_state(&app, user, &job).await;
    let uri = format!(
        "/api/v1/templates/{}",
        finished["template_id"].as_str().expect("template id")
    );

    let (status, body) = app
        .put(
            user,
            &uri,
            json!({"name": "x", "content_markdown": "a".repeat(TEMPLATE_MAX_BYTES + 1)}),
        )
        .await;
    assert_eq!(status, StatusCode::PAYLOAD_TOO_LARGE, "{body}");
    assert_eq!(error_code(&body), "PAYLOAD_TOO_LARGE");

    let (status, _) = app
        .put(user, &uri, json!({"name": "", "content_markdown": "ok"}))
        .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    let (status, _) = app
        .put(
            user,
            &uri,
            json!({"name": "x", "content_markdown": "a\u{0}b"}),
        )
        .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    let (status, _) = app.put(user, &uri, json!({"name": "x"})).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
}

#[tokio::test]
async fn repeated_requests_do_not_create_duplicate_jobs() {
    let app = TestApp::start().await;
    let user = app.superadmin().await;
    let contract = app.create_contract(user, "Contrato").await;
    let uri = format!(
        "/api/v1/contracts/{}/convert",
        contract["id"].as_str().expect("id")
    );

    let (first, second, third) = tokio::join!(
        app.post(user, &uri, json!({})),
        app.post(user, &uri, json!({})),
        app.post(user, &uri, json!({})),
    );
    for (status, body) in [&first, &second, &third] {
        assert_eq!(*status, StatusCode::ACCEPTED, "{body}");
    }
    assert_eq!(first.1["id"], second.1["id"]);
    assert_eq!(first.1["id"], third.1["id"]);

    let jobs: i64 = sqlx::query_scalar("SELECT count(*) FROM yzy_contracts.conversion_jobs")
        .fetch_one(&app.admin)
        .await
        .expect("count");
    assert_eq!(jobs, 1);
}

#[tokio::test]
async fn two_workers_never_process_the_same_job() {
    let app = TestApp::start().await;
    let user = app.superadmin().await;
    Mock::given(method("POST"))
        .and(path(EXTRACT_PATH))
        .respond_with(move |request: &wiremock::Request| {
            extract_response("# C", Some(1), json!([]))(request)
                .set_delay(Duration::from_millis(200))
        })
        .expect(1)
        .mount(&app.extractor)
        .await;
    contract_and_job(&app, user).await;

    let other = app.another_worker();
    let (first, second) = tokio::join!(app.worker.process_next_job(), other.process_next_job());
    let processed = [first.expect("first"), second.expect("second")];
    assert_eq!(
        processed.iter().filter(|worked| **worked).count(),
        1,
        "exactly one worker takes the job"
    );
}

#[tokio::test]
async fn pending_jobs_survive_a_restart() {
    let app = TestApp::start().await;
    let user = app.superadmin().await;
    app.mock_extractor_success("# C").await;
    let (_, job) = contract_and_job(&app, user).await;

    // A process that starts later finds the job in PostgreSQL.
    let after_restart = app.another_worker();
    assert!(after_restart.process_next_job().await.expect("work"));
    assert_eq!(job_state(&app, user, &job).await["status"], "completed");
}

#[tokio::test]
async fn a_dead_workers_job_is_recovered_when_its_lease_expires() {
    let app = TestApp::start().await;
    let user = app.superadmin().await;
    let (_, job) = contract_and_job(&app, user).await;

    // Simulates a worker that claimed the job and died.
    sqlx::query(
        "UPDATE yzy_contracts.conversion_jobs
         SET status = 'processing', attempts = 1, locked_by = 'dead-worker',
             locked_until = now() + interval '10 minutes'",
    )
    .execute(&app.admin)
    .await
    .expect("claim");
    assert_eq!(job_state(&app, user, &job).await["status"], "processing");

    app.mock_extractor_success("# C").await;
    assert!(
        !app.worker.process_next_job().await.expect("work"),
        "a live lease must be respected"
    );

    app.expire_leases().await;
    assert!(app.worker.process_next_job().await.expect("work"));
    let finished = job_state(&app, user, &job).await;
    assert_eq!(finished["status"], "completed");
    assert_eq!(finished["attempts"], 2);
}

#[tokio::test]
async fn a_job_whose_worker_keeps_dying_eventually_fails() {
    let app = TestApp::start().await;
    let user = app.superadmin().await;
    let (id, job) = contract_and_job(&app, user).await;
    sqlx::query(
        "UPDATE yzy_contracts.conversion_jobs
         SET status = 'processing', attempts = max_attempts, locked_by = 'dead-worker',
             locked_until = now() - interval '1 second'",
    )
    .execute(&app.admin)
    .await
    .expect("exhaust");

    assert!(!app.worker.process_next_job().await.expect("work"));
    let finished = job_state(&app, user, &job).await;
    assert_eq!(finished["status"], "failed");
    assert_eq!(finished["error_code"], "WORKER_LEASE_EXPIRED");
    assert_eq!(contract_status(&app, user, &id).await, "conversion_failed");
}

#[tokio::test]
async fn transient_failures_retry_with_backoff_up_to_the_limit_and_can_be_requested_again() {
    let app = TestApp::start().await;
    let user = app.superadmin().await;
    app.mock_extractor_status(
        503,
        json!({"error": {"code": "BUSY", "message": "secret detail"}}),
    )
    .await;
    let (id, job) = contract_and_job(&app, user).await;

    app.worker.process_next_job().await.expect("work");
    let state = job_state(&app, user, &job).await;
    assert_eq!(state["status"], "pending");
    assert_eq!(state["attempts"], 1);
    assert_eq!(state["error_code"], "EXTRACTOR_UNAVAILABLE");
    assert!(
        !state["error_message"]
            .as_str()
            .expect("message")
            .contains("secret"),
        "remote detail must not reach the user"
    );
    assert!(
        !app.worker.process_next_job().await.expect("work"),
        "the backoff must be respected"
    );

    app.make_jobs_due().await;
    app.worker.process_next_job().await.expect("work");
    assert_eq!(job_state(&app, user, &job).await["attempts"], 2);

    app.make_jobs_due().await;
    app.worker.process_next_job().await.expect("work");
    let state = job_state(&app, user, &job).await;
    assert_eq!(state["status"], "failed");
    assert_eq!(state["attempts"], 3);
    assert_eq!(contract_status(&app, user, &id).await, "conversion_failed");

    app.make_jobs_due().await;
    assert!(
        !app.worker.process_next_job().await.expect("work"),
        "no fourth attempt"
    );

    // The user may try again once the failure is final.
    app.extractor.reset().await;
    app.mock_extractor_success("# Recuperado").await;
    let (status, retried) = app
        .post(user, &format!("/api/v1/contracts/{id}/convert"), json!({}))
        .await;
    assert_eq!(status, StatusCode::ACCEPTED);
    assert_ne!(retried["id"], job["id"]);
    app.worker.process_next_job().await.expect("work");
    assert_eq!(job_state(&app, user, &retried).await["status"], "completed");
}

#[tokio::test]
async fn permanent_extractor_errors_fail_without_retrying() {
    for (status, remote_code, expected) in [
        (422, "CORRUPT_DOCUMENT", "CORRUPT_DOCUMENT"),
        (422, "CONVERSION_FAILED", "CORRUPT_DOCUMENT"),
        (422, "EMPTY_DOCUMENT", "EMPTY_EXTRACTION"),
        (422, "EMPTY_EXTRACTION", "EMPTY_EXTRACTION"),
        (422, "UNSUPPORTED_DOCUMENT_FORMAT", "UNSUPPORTED_DOCUMENT"),
        (
            422,
            "PASSWORD_PROTECTED_DOCUMENT",
            "PASSWORD_PROTECTED_DOCUMENT",
        ),
        (413, "DOCUMENT_TOO_LARGE", "DOCUMENT_TOO_LARGE"),
        (404, "DOCUMENT_NOT_FOUND", "SOURCE_MISSING"),
        (400, "FORBIDDEN_DOWNLOAD_URL", "EXTRACTOR_REJECTED"),
        (400, "SOMETHING_ELSE", "EXTRACTOR_REJECTED"),
    ] {
        let app = TestApp::start().await;
        let user = app.superadmin().await;
        app.mock_extractor_status(
            status,
            json!({"error": {"code": remote_code, "message": "x"}}),
        )
        .await;
        let (id, job) = contract_and_job(&app, user).await;
        app.worker.process_next_job().await.expect("work");
        let state = job_state(&app, user, &job).await;
        assert_eq!(state["status"], "failed", "{remote_code}");
        assert_eq!(state["attempts"], 1, "{remote_code}");
        assert_eq!(state["error_code"], expected);
        assert_eq!(contract_status(&app, user, &id).await, "conversion_failed");
    }
}

#[tokio::test]
async fn failures_unrelated_to_the_document_are_retried() {
    for (status, remote_code, expected) in [
        (401, "UNAUTHORIZED", "EXTRACTOR_UNAVAILABLE"),
        (403, "STORAGE_ACCESS_DENIED", "EXTRACTOR_UNAVAILABLE"),
        (410, "PRESIGNED_URL_EXPIRED", "EXTRACTOR_UNAVAILABLE"),
        (
            429,
            "TOO_MANY_CONCURRENT_EXTRACTIONS",
            "EXTRACTOR_UNAVAILABLE",
        ),
        (500, "INTERNAL_SERVER_ERROR", "EXTRACTOR_UNAVAILABLE"),
        (502, "DOWNLOAD_FAILED", "EXTRACTOR_UNAVAILABLE"),
        (504, "DOWNLOAD_TIMEOUT", "EXTRACTOR_TIMEOUT"),
        (504, "EXTRACTION_TIMEOUT", "EXTRACTOR_TIMEOUT"),
    ] {
        let app = TestApp::start().await;
        let user = app.superadmin().await;
        app.mock_extractor_status(
            status,
            json!({"error": {"code": remote_code, "message": "x"}}),
        )
        .await;
        let (_, job) = contract_and_job(&app, user).await;
        app.worker.process_next_job().await.expect("work");
        let state = job_state(&app, user, &job).await;
        assert_eq!(state["status"], "pending", "{remote_code}");
        assert_eq!(state["error_code"], expected, "{remote_code}");
    }
}

#[tokio::test]
async fn extractor_timeouts_are_retried() {
    let app = TestApp::start_with_extractor_timeout(Duration::from_millis(200)).await;
    let user = app.superadmin().await;
    Mock::given(method("POST"))
        .and(path(EXTRACT_PATH))
        .respond_with(move |request: &wiremock::Request| {
            extract_response("# C", Some(1), json!([]))(request).set_delay(Duration::from_secs(3))
        })
        .mount(&app.extractor)
        .await;
    let (_, job) = contract_and_job(&app, user).await;
    app.worker.process_next_job().await.expect("work");
    let state = job_state(&app, user, &job).await;
    assert_eq!(state["status"], "pending");
    assert_eq!(state["error_code"], "EXTRACTOR_TIMEOUT");
}

#[tokio::test]
async fn an_unreachable_extractor_is_retried() {
    let app = TestApp::start().await;
    let user = app.superadmin().await;
    let (_, job) = contract_and_job(&app, user).await;
    app.extractor.reset().await;
    let unreachable = {
        let mut config = app.state.config.extractor.clone();
        config.url = "http://127.0.0.1:9".to_owned();
        yzy_contracts_api::workers::conversion::ConversionWorker::new(
            app.state.clone(),
            yzy_contracts_api::infrastructure::extractor::ExtractorClient::new(&config)
                .expect("client"),
        )
    };
    unreachable.process_next_job().await.expect("work");
    let state = job_state(&app, user, &job).await;
    assert_eq!(state["status"], "pending");
    assert_eq!(state["error_code"], "EXTRACTOR_UNAVAILABLE");
}

#[tokio::test]
async fn invalid_extractor_output_fails_the_job() {
    for (markdown, expected) in [
        (Some("   ".to_owned()), "EMPTY_EXTRACTION"),
        (
            Some("a".repeat(TEMPLATE_MAX_BYTES + 1)),
            "MARKDOWN_TOO_LARGE",
        ),
        (None, "INVALID_EXTRACTOR_OUTPUT"),
    ] {
        let app = TestApp::start().await;
        let user = app.superadmin().await;
        match markdown {
            Some(markdown) => {
                app.mock_extractor_output(&markdown, Some(1), json!([]))
                    .await
            }
            None => {
                app.mock_extractor_status(200, json!({"unexpected": true}))
                    .await
            }
        }
        let (_, job) = contract_and_job(&app, user).await;
        app.worker.process_next_job().await.expect("work");
        let state = job_state(&app, user, &job).await;
        assert_eq!(state["status"], "failed", "{expected}");
        assert_eq!(state["error_code"], expected);
    }
}

#[tokio::test]
async fn an_answer_for_a_different_job_is_refused() {
    let app = TestApp::start().await;
    let user = app.superadmin().await;
    Mock::given(method("POST"))
        .and(path(EXTRACT_PATH))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "job_id": Uuid::new_v4(),
            "status": "completed",
            "document": {"page_count": 1},
            "extraction": {"markdown": "# Otro contrato", "warnings": []},
        })))
        .mount(&app.extractor)
        .await;
    let (_, job) = contract_and_job(&app, user).await;
    app.worker.process_next_job().await.expect("work");
    let state = job_state(&app, user, &job).await;
    assert_eq!(state["status"], "failed");
    assert_eq!(state["error_code"], "INVALID_EXTRACTOR_OUTPUT");
}

#[tokio::test]
async fn a_docx_without_page_count_is_stored() {
    let app = TestApp::start().await;
    let user = app.superadmin().await;
    app.mock_extractor_output("# Word", None, json!([])).await;
    let (_, job) = contract_and_job(&app, user).await;
    app.worker.process_next_job().await.expect("work");
    let state = job_state(&app, user, &job).await;
    assert_eq!(state["status"], "completed");
    assert!(state["page_count"].is_null());
}

#[tokio::test]
async fn a_file_replaced_after_registration_is_not_converted() {
    let app = TestApp::start().await;
    let user = app.superadmin().await;
    app.mock_extractor_success("# C").await;
    let (_, job) = contract_and_job(&app, user).await;
    let key: String = sqlx::query_scalar("SELECT object_key FROM yzy_contracts.contracts")
        .fetch_one(&app.admin)
        .await
        .expect("key");
    app.storage.put(&key, PDF_BYTES, PDF_MIME);

    app.worker.process_next_job().await.expect("work");
    let state = job_state(&app, user, &job).await;
    assert_eq!(state["status"], "failed");
    assert_eq!(state["error_code"], "SOURCE_CHANGED");
    assert!(
        app.extractor
            .received_requests()
            .await
            .expect("requests")
            .is_empty()
    );
}

#[tokio::test]
async fn deleting_a_contract_during_conversion_discards_the_result() {
    let app = TestApp::start().await;
    let user = app.superadmin().await;
    Mock::given(method("POST"))
        .and(path(EXTRACT_PATH))
        .respond_with(move |request: &wiremock::Request| {
            extract_response("# C", Some(1), json!([]))(request)
                .set_delay(Duration::from_millis(400))
        })
        .mount(&app.extractor)
        .await;
    let (id, _) = contract_and_job(&app, user).await;

    let (worked, deletion) = tokio::join!(app.worker.process_next_job(), async {
        tokio::time::sleep(Duration::from_millis(100)).await;
        app.delete(user, &format!("/api/v1/contracts/{id}")).await
    });
    assert!(worked.expect("work"));
    assert_eq!(deletion.0, StatusCode::NO_CONTENT);

    let templates: i64 = sqlx::query_scalar("SELECT count(*) FROM yzy_contracts.templates")
        .fetch_one(&app.admin)
        .await
        .expect("count");
    assert_eq!(templates, 0, "no template may outlive its contract");
}

#[tokio::test]
async fn a_worker_that_lost_its_lease_cannot_overwrite_the_new_owner() {
    use yzy_contracts_api::modules::conversions::repository::{self, ClaimedJob};

    let app = TestApp::start().await;
    let user = app.superadmin().await;
    let (_, job) = contract_and_job(&app, user).await;
    let claimed: ClaimedJob =
        repository::claim_next(&app.admin, "old-worker", Duration::from_secs(60))
            .await
            .expect("claim")
            .expect("job");
    app.expire_leases().await;
    let reclaimed = repository::claim_next(&app.admin, "new-worker", Duration::from_secs(60))
        .await
        .expect("claim")
        .expect("job");
    assert_eq!(reclaimed.id, claimed.id);

    let stored = repository::complete(
        &app.admin,
        &claimed,
        "old-worker",
        "T",
        "# viejo",
        None,
        json!([]),
    )
    .await
    .expect("complete");
    assert!(!stored, "the stale worker must be refused");
    repository::mark_failed(&app.admin, &claimed, "old-worker", "X", "x")
        .await
        .expect("mark");
    assert_eq!(job_state(&app, user, &job).await["status"], "processing");

    let stored = repository::complete(
        &app.admin,
        &reclaimed,
        "new-worker",
        "T",
        "# nuevo",
        None,
        json!([]),
    )
    .await
    .expect("complete");
    assert!(stored);
    assert_eq!(job_state(&app, user, &job).await["status"], "completed");
}

#[tokio::test]
async fn the_database_enforces_job_invariants() {
    let app = TestApp::start().await;
    let user = app.superadmin().await;
    let (id, _) = contract_and_job(&app, user).await;
    let contract_id = Uuid::parse_str(&id).expect("uuid");

    let duplicate = sqlx::query(
        "INSERT INTO yzy_contracts.conversion_jobs (contract_id, owner_id, max_attempts)
         VALUES ($1, $2, 3)",
    )
    .bind(contract_id)
    .bind(user.id)
    .execute(&app.admin)
    .await;
    assert!(duplicate.is_err(), "a second active job must be refused");

    for statement in [
        "UPDATE yzy_contracts.conversion_jobs SET status = 'cancelled'",
        "UPDATE yzy_contracts.conversion_jobs SET status = 'processing'",
        "UPDATE yzy_contracts.conversion_jobs SET status = 'completed', completed_at = now()",
        "UPDATE yzy_contracts.conversion_jobs SET status = 'failed'",
        "UPDATE yzy_contracts.contracts SET status = 'unknown'",
    ] {
        let result = sqlx::query(statement).execute(&app.admin).await;
        assert!(result.is_err(), "{statement} must violate a constraint");
    }

    let intruder = app.user().await;
    let other_owner = sqlx::query(
        "INSERT INTO yzy_contracts.templates (contract_id, owner_id, name, content_markdown)
         VALUES ($1, $2, 'x', 'x')",
    )
    .bind(contract_id)
    .bind(intruder.id)
    .execute(&app.admin)
    .await;
    assert!(
        other_owner.is_err(),
        "a template cannot belong to another user"
    );
}

#[tokio::test]
async fn the_data_api_roles_cannot_read_or_write_product_tables() {
    let app = TestApp::start().await;
    let user = app.superadmin().await;
    app.create_contract(user, "Privado").await;

    for role in ["anon", "authenticated"] {
        for table in [
            "file_uploads",
            "contracts",
            "templates",
            "conversion_jobs",
            "generated_documents",
            "companies",
            "_sqlx_migrations",
        ] {
            let mut tx = app.admin.begin().await.expect("tx");
            sqlx::query(sqlx::AssertSqlSafe(format!("SET LOCAL ROLE {role}")))
                .execute(&mut *tx)
                .await
                .expect("set role");
            let read = sqlx::query(sqlx::AssertSqlSafe(format!(
                "SELECT * FROM yzy_contracts.{table}"
            )))
            .fetch_all(&mut *tx)
            .await;
            assert!(read.is_err(), "{role} must not read {table}");
            tx.rollback().await.expect("rollback");
        }
    }

    let enabled: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'yzy_contracts' AND c.relrowsecurity
           AND c.relname IN ('file_uploads', 'contracts', 'templates', 'conversion_jobs',
                             'generated_documents', 'companies', '_sqlx_migrations')",
    )
    .fetch_one(&app.admin)
    .await
    .expect("rls");
    assert_eq!(enabled, 7, "RLS must be enabled on every table");
}

#[tokio::test]
async fn the_app_role_has_only_the_privileges_it_needs() {
    let app = TestApp::start().await;
    let db = &app.state.db;
    for statement in [
        "CREATE TABLE yzy_contracts.intruder (id int)",
        "DROP TABLE yzy_contracts.contracts",
        "ALTER TABLE yzy_contracts.contracts DISABLE ROW LEVEL SECURITY",
        "SELECT * FROM auth.users",
        "DELETE FROM yzy_contracts.profiles",
        "UPDATE yzy_contracts.profiles SET account_status = 'active'",
        "DELETE FROM yzy_contracts.companies",
        "UPDATE yzy_contracts.companies SET owner_id = owner_id",
    ] {
        let result = sqlx::query(statement).execute(db).await;
        assert!(result.is_err(), "the app role must not run: {statement}");
    }
}

#[tokio::test]
async fn the_schema_keeps_the_rules_of_the_infra_script() {
    let app = TestApp::start().await;
    let cascades: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM pg_constraint
         WHERE connamespace = 'yzy_contracts'::regnamespace AND contype = 'f' AND confdeltype = 'c'",
    )
    .fetch_one(&app.admin)
    .await
    .expect("cascades");
    assert_eq!(
        cascades, 0,
        "re-running yzy-infra's script would abort on a cascade"
    );

    let public_tables: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name IN ('_sqlx_migrations', 'contracts', 'companies')",
    )
    .fetch_one(&app.admin)
    .await
    .expect("public");
    assert_eq!(public_tables, 0, "public stays reserved");
}
