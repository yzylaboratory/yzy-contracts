mod common;

use std::sync::atomic::Ordering;

use axum::http::StatusCode;
use common::*;
use serde_json::{Value, json};
use std::io::{Cursor, Write};
use uuid::Uuid;
use zip::{ZipWriter, write::SimpleFileOptions};

const UPLOAD_URL: &str = "/api/v1/files/upload-url";
const CONTRACTS: &str = "/api/v1/contracts";

fn names(body: &Value) -> Vec<&str> {
    body["items"]
        .as_array()
        .expect("items")
        .iter()
        .filter_map(|item| item["name"].as_str())
        .collect()
}

fn native_docx(text: &str) -> Vec<u8> {
    let mut archive = ZipWriter::new(Cursor::new(Vec::new()));
    archive
        .start_file("[Content_Types].xml", SimpleFileOptions::default())
        .expect("types");
    archive.write_all(b"<Types/>").expect("types");
    archive
        .start_file("word/document.xml", SimpleFileOptions::default())
        .expect("document");
    archive.write_all(format!(
        "<w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"><w:body><w:p><w:r><w:t>{text}</w:t></w:r></w:p></w:body></w:document>"
    ).as_bytes()).expect("document");
    archive.finish().expect("zip").into_inner()
}

#[tokio::test]
async fn upload_url_uses_a_server_generated_key_and_a_temporary_url() {
    let app = TestApp::start().await;
    let user = app.superadmin().await;
    let (status, body) = app
        .post(
            user,
            UPLOAD_URL,
            json!({"file_name": "../secreto/Mi contrato.pdf", "mime_type": PDF_MIME, "size_bytes": 10}),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    assert_eq!(body["method"], "PUT");
    assert_eq!(body["headers"]["content-type"], PDF_MIME);
    let url = body["upload_url"].as_str().expect("url");
    assert!(
        url.contains(&format!("users/{}/uploads/", user.id)),
        "{url}"
    );
    assert!(url.contains("ttl=300"), "{url}");
    assert!(
        !url.contains("contrato"),
        "the key must not contain the file name: {url}"
    );

    let stored_name: String = sqlx::query_scalar(
        "SELECT original_file_name FROM yzy_contracts.file_uploads WHERE owner_id = $1",
    )
    .bind(user.id)
    .fetch_one(&app.admin)
    .await
    .expect("upload row");
    assert_eq!(stored_name, "Mi contrato.pdf");
}

#[tokio::test]
async fn upload_url_rejects_invalid_files() {
    let app = TestApp::start().await;
    let user = app.superadmin().await;
    for (body, expected_status, expected_code) in [
        (
            json!({"file_name": "a.exe", "mime_type": "application/x-msdownload", "size_bytes": 10}),
            StatusCode::UNSUPPORTED_MEDIA_TYPE,
            "UNSUPPORTED_FILE_TYPE",
        ),
        (
            json!({"file_name": "a.docx", "mime_type": PDF_MIME, "size_bytes": 10}),
            StatusCode::UNSUPPORTED_MEDIA_TYPE,
            "UNSUPPORTED_FILE_TYPE",
        ),
        (
            json!({"file_name": "a.pdf", "mime_type": PDF_MIME, "size_bytes": 1025}),
            StatusCode::PAYLOAD_TOO_LARGE,
            "FILE_TOO_LARGE",
        ),
        (
            json!({"file_name": "a.pdf", "mime_type": PDF_MIME, "size_bytes": 0}),
            StatusCode::UNPROCESSABLE_ENTITY,
            "VALIDATION_ERROR",
        ),
        (
            json!({"file_name": "", "mime_type": PDF_MIME, "size_bytes": 10}),
            StatusCode::UNPROCESSABLE_ENTITY,
            "VALIDATION_ERROR",
        ),
    ] {
        let (status, response) = app.post(user, UPLOAD_URL, body.clone()).await;
        assert_eq!(status, expected_status, "{body}: {response}");
        assert_eq!(error_code(&response), expected_code, "{body}");
    }
}

#[tokio::test]
async fn a_docx_upload_is_accepted() {
    let app = TestApp::start().await;
    let user = app.superadmin().await;
    let source = native_docx("{{cliente_nombre}} {{cliente_nombre}}");
    let (status, body) = app
        .post(
            user,
            UPLOAD_URL,
            json!({"file_name": "contrato.docx", "mime_type": DOCX_MIME, "size_bytes": source.len()}),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    let upload_id = body["upload_id"].as_str().expect("upload_id");
    let key: String = sqlx::query_scalar("SELECT object_key FROM yzy_contracts.file_uploads")
        .fetch_one(&app.admin)
        .await
        .expect("key");
    assert!(key.ends_with(".docx"));
    app.storage.put(&key, &source, DOCX_MIME);
    let (status, body) = app
        .post(
            user,
            CONTRACTS,
            json!({"upload_id": upload_id, "name": "Word"}),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    assert_eq!(body["mime_type"], DOCX_MIME);
    assert_eq!(body["status"], "converted");
    assert!(body["latest_conversion_id"].is_null());
    let template_id = body["template_id"].as_str().expect("template id");
    let (status, template) = app
        .get(user, &format!("/api/v1/templates/{template_id}"))
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(template["content_markdown"], "");
    assert_eq!(
        template["native_variables"],
        json!([{"key": "cliente_nombre", "occurrences": 2}])
    );
    let (status, _) = app
        .post(
            user,
            &format!(
                "/api/v1/contracts/{}/convert",
                body["id"].as_str().expect("id")
            ),
            json!({}),
        )
        .await;
    assert_eq!(status, StatusCode::CONFLICT);
    let (status, _) = app
        .put(
            user,
            &format!("/api/v1/templates/{template_id}"),
            json!({"name": "Renombrado", "content_markdown": "changed"}),
        )
        .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    let (status, renamed) = app
        .put(
            user,
            &format!("/api/v1/templates/{template_id}"),
            json!({"name": "Renombrado", "content_markdown": ""}),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{renamed}");
    assert_eq!(renamed["native_variables"], template["native_variables"]);
    assert_eq!(
        app.storage
            .objects
            .lock()
            .expect("storage")
            .get(&key)
            .expect("source")
            .bytes,
        source
    );
}

#[tokio::test]
async fn invalid_native_word_registration_does_not_consume_the_upload() {
    let app = TestApp::start().await;
    let user = app.superadmin().await;
    for (text, code) in [
        ("Contrato", "DOCX_VARIABLES_REQUIRED"),
        ("{{nombre", "INVALID_DOCX_VARIABLES"),
        ("{{Nombre}}", "INVALID_DOCX_VARIABLES"),
    ] {
        let source = native_docx(text);
        let (status, upload) = app
            .post(
                user,
                UPLOAD_URL,
                json!({"file_name":"modelo.docx","mime_type":DOCX_MIME,"size_bytes":source.len()}),
            )
            .await;
        assert_eq!(status, StatusCode::CREATED, "{upload}");
        let upload_id: Uuid = serde_json::from_value(upload["upload_id"].clone()).expect("id");
        let key: String =
            sqlx::query_scalar("SELECT object_key FROM yzy_contracts.file_uploads WHERE id = $1")
                .bind(upload_id)
                .fetch_one(&app.admin)
                .await
                .expect("key");
        app.storage.put(&key, &source, DOCX_MIME);
        let (status, body) = app
            .post(
                user,
                CONTRACTS,
                json!({"upload_id":upload_id,"name":"Prueba"}),
            )
            .await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
        assert_eq!(error_code(&body), code);
        let consumed: bool = sqlx::query_scalar(
            "SELECT consumed_at IS NOT NULL FROM yzy_contracts.file_uploads WHERE id = $1",
        )
        .bind(upload_id)
        .fetch_one(&app.admin)
        .await
        .expect("consumed");
        assert!(!consumed);
    }
}

#[tokio::test]
async fn registration_requires_a_finished_upload_that_matches_the_declaration() {
    let app = TestApp::start().await;
    let user = app.superadmin().await;
    let size = PDF_BYTES.len() as i64;

    let (upload_id, key) = app.reserve_upload(user, size).await;
    let register = json!({"upload_id": upload_id, "name": "Contrato"});

    let (status, body) = app.post(user, CONTRACTS, register.clone()).await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(error_code(&body), "UPLOAD_NOT_COMPLETED");

    app.storage.put(&key, b"%PDF-1", PDF_MIME);
    let (status, body) = app.post(user, CONTRACTS, register.clone()).await;
    assert_eq!(
        status,
        StatusCode::UNPROCESSABLE_ENTITY,
        "wrong size: {body}"
    );
    assert_eq!(error_code(&body), "UPLOAD_MISMATCH");

    app.storage.put(&key, PDF_BYTES, "text/html");
    let (status, _) = app.post(user, CONTRACTS, register.clone()).await;
    assert_eq!(
        status,
        StatusCode::UNPROCESSABLE_ENTITY,
        "wrong content type"
    );

    let not_a_pdf = vec![b'x'; PDF_BYTES.len()];
    app.storage.put(&key, &not_a_pdf, PDF_MIME);
    let (status, _) = app.post(user, CONTRACTS, register.clone()).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "wrong signature");

    app.storage.put(&key, PDF_BYTES, PDF_MIME);
    let (status, body) = app.post(user, CONTRACTS, register.clone()).await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    assert_eq!(body["status"], "uploaded");
    assert_eq!(body["original_file_name"], "contrato.pdf");
    assert_eq!(body["size_bytes"], size);
    assert!(
        body.get("object_key").is_none(),
        "internal path must not leak"
    );

    let (status, body) = app.post(user, CONTRACTS, register).await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(error_code(&body), "UPLOAD_ALREADY_USED");
}

#[tokio::test]
async fn an_expired_upload_cannot_be_registered() {
    let app = TestApp::start().await;
    let user = app.superadmin().await;
    let (upload_id, key) = app.reserve_upload(user, PDF_BYTES.len() as i64).await;
    app.storage.put(&key, PDF_BYTES, PDF_MIME);
    sqlx::query(
        "UPDATE yzy_contracts.file_uploads SET register_before = now() - interval '1 minute'",
    )
    .execute(&app.admin)
    .await
    .expect("expire");
    let (status, body) = app
        .post(
            user,
            CONTRACTS,
            json!({"upload_id": upload_id, "name": "Tarde"}),
        )
        .await;
    assert_eq!(status, StatusCode::GONE, "{body}");
    assert_eq!(error_code(&body), "UPLOAD_EXPIRED");
}

#[tokio::test]
async fn unregistered_uploads_are_swept_after_expiry() {
    let app = TestApp::start().await;
    let user = app.superadmin().await;
    let (_, key) = app.reserve_upload(user, PDF_BYTES.len() as i64).await;
    app.storage.put(&key, PDF_BYTES, PDF_MIME);

    app.worker.sweep().await.expect("sweep");
    assert!(app.storage.contains(&key), "a live upload must survive");

    sqlx::query(
        "UPDATE yzy_contracts.file_uploads SET register_before = now() - interval '1 minute'",
    )
    .execute(&app.admin)
    .await
    .expect("expire");
    app.worker.sweep().await.expect("sweep");
    assert!(!app.storage.contains(&key));
    let left: i64 = sqlx::query_scalar("SELECT count(*) FROM yzy_contracts.file_uploads")
        .fetch_one(&app.admin)
        .await
        .expect("count");
    assert_eq!(left, 0);
}

#[tokio::test]
async fn contract_crud_round_trip() {
    let app = TestApp::start().await;
    let user = app.superadmin().await;
    let created = app.create_contract(user, "Original").await;
    let uri = format!("{CONTRACTS}/{}", created["id"].as_str().expect("id"));

    let (status, body) = app.get(user, &uri).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["name"], "Original");
    assert!(body["template_id"].is_null());

    let (status, body) = app
        .patch(
            user,
            &uri,
            json!({"name": "Renombrado", "description": "Nota"}),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["name"], "Renombrado");
    assert_eq!(body["description"], "Nota");

    let (status, body) = app.patch(user, &uri, json!({"name": "Otra vez"})).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        body["description"], "Nota",
        "an absent field stays unchanged"
    );

    let (status, body) = app.patch(user, &uri, json!({"description": null})).await;
    assert_eq!(status, StatusCode::OK);
    assert!(body["description"].is_null(), "null clears the field");
    assert_eq!(body["name"], "Otra vez");

    let (status, _) = app.patch(user, &uri, json!({})).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    let (status, _) = app.patch(user, &uri, json!({"name": "   "})).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    let (status, _) = app.patch(user, &uri, json!({"object_key": "x"})).await;
    assert_eq!(
        status,
        StatusCode::UNPROCESSABLE_ENTITY,
        "unknown fields are refused"
    );

    let (status, _) = app.get(user, &format!("{CONTRACTS}/not-a-uuid")).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);

    let (status, _) = app.delete(user, &uri).await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let (status, body) = app.get(user, &uri).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(error_code(&body), "CONTRACT_NOT_FOUND");
    let (status, _) = app.delete(user, &uri).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn listing_paginates_searches_filters_and_sorts() {
    let app = TestApp::start().await;
    let user = app.superadmin().await;
    for name in [
        "Arrendamiento",
        "NDA",
        "Servicios",
        "Trabajo 100%",
        "Trabajo parcial",
    ] {
        app.create_contract(user, name).await;
    }

    let (status, body) = app
        .get(
            user,
            &format!("{CONTRACTS}?sort=name&order=asc&per_page=2&page=2"),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(names(&body), ["Servicios", "Trabajo 100%"]);
    assert_eq!(body["total"], 5);
    assert_eq!(body["page"], 2);
    assert_eq!(body["per_page"], 2);

    let (_, body) = app
        .get(
            user,
            &format!("{CONTRACTS}?sort=name&order=desc&per_page=1"),
        )
        .await;
    assert_eq!(names(&body), ["Trabajo parcial"]);

    let (_, body) = app
        .get(user, &format!("{CONTRACTS}?q=trabajo&sort=name&order=asc"))
        .await;
    assert_eq!(names(&body), ["Trabajo 100%", "Trabajo parcial"]);
    assert_eq!(body["total"], 2);

    let (_, body) = app.get(user, &format!("{CONTRACTS}?q=%25")).await;
    assert_eq!(
        names(&body),
        ["Trabajo 100%"],
        "% is a literal, not a wildcard"
    );

    let (_, body) = app
        .get(user, &format!("{CONTRACTS}?status=converted"))
        .await;
    assert_eq!(body["total"], 0);
    let (_, body) = app.get(user, &format!("{CONTRACTS}?status=uploaded")).await;
    assert_eq!(body["total"], 5);

    for query in [
        "per_page=0",
        "per_page=101",
        "page=0",
        "status=nope",
        "sort=object_key",
        "extra=1",
    ] {
        let (status, body) = app.get(user, &format!("{CONTRACTS}?{query}")).await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{query}: {body}");
    }

    let injection = "?q=%27%3B%20DROP%20TABLE%20yzy_contracts.contracts%3B--";
    let (status, body) = app.get(user, &format!("{CONTRACTS}{injection}")).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["total"], 0);
    let (_, body) = app.get(user, CONTRACTS).await;
    assert_eq!(body["total"], 5, "the table must survive");
}

#[tokio::test]
async fn another_account_cannot_reach_contracts_or_uploads() {
    let app = TestApp::start().await;
    let owner = app.superadmin().await;
    let intruder = app.user().await;
    let contract = app.create_contract(owner, "Privado").await;
    let id = contract["id"].as_str().expect("id");
    let uri = format!("{CONTRACTS}/{id}");

    let (status, body) = app.get(intruder, &uri).await;
    assert_eq!(
        status,
        StatusCode::FORBIDDEN,
        "existence must not leak: {body}"
    );
    assert_eq!(error_code(&body), "ACCESS_PENDING");
    let (status, _) = app.patch(intruder, &uri, json!({"name": "Mío"})).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, _) = app.delete(intruder, &uri).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, _) = app.get(intruder, &format!("{uri}/download-url")).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, _) = app
        .post(intruder, &format!("{uri}/convert"), json!({}))
        .await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    let (status, body) = app.get(intruder, CONTRACTS).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(error_code(&body), "ACCESS_PENDING");

    let (upload_id, key) = app.reserve_upload(owner, PDF_BYTES.len() as i64).await;
    app.storage.put(&key, PDF_BYTES, PDF_MIME);
    let (status, body) = app
        .post(
            intruder,
            CONTRACTS,
            json!({"upload_id": upload_id, "name": "Robado"}),
        )
        .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{body}");
    assert_eq!(error_code(&body), "ACCESS_PENDING");

    let (_, body) = app.get(owner, &uri).await;
    assert_eq!(body["name"], "Privado", "the owner's data is untouched");
}

#[tokio::test]
async fn owners_get_a_temporary_download_url() {
    let app = TestApp::start().await;
    let user = app.superadmin().await;
    let contract = app.create_contract(user, "Descarga").await;
    let (status, body) = app
        .get(
            user,
            &format!(
                "{CONTRACTS}/{}/download-url",
                contract["id"].as_str().expect("id")
            ),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let url = body["url"].as_str().expect("url");
    assert!(url.contains("op=get"), "{url}");
    assert!(url.contains("ttl=120"), "{url}");
}

#[tokio::test]
async fn deletion_removes_the_template_jobs_and_finally_the_file() {
    let app = TestApp::start().await;
    let user = app.superadmin().await;
    let contract = app.create_contract(user, "A borrar").await;
    let id = contract["id"].as_str().expect("id");
    let contract_id = Uuid::parse_str(id).expect("uuid");
    let key: String =
        sqlx::query_scalar("SELECT object_key FROM yzy_contracts.contracts WHERE id = $1")
            .bind(contract_id)
            .fetch_one(&app.admin)
            .await
            .expect("key");

    app.mock_extractor_success("# Contrato").await;
    let (_, job) = app
        .post(user, &format!("{CONTRACTS}/{id}/convert"), json!({}))
        .await;
    app.worker.process_next_job().await.expect("work");
    let (_, converted) = app.get(user, &format!("{CONTRACTS}/{id}")).await;
    let template_uri = format!(
        "/api/v1/templates/{}",
        converted["template_id"].as_str().expect("template")
    );

    let (status, _) = app.delete(user, &format!("{CONTRACTS}/{id}")).await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let (status, _) = app.get(user, &template_uri).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, _) = app
        .get(
            user,
            &format!("/api/v1/conversions/{}", job["id"].as_str().expect("job")),
        )
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert!(
        app.storage.contains(&key),
        "the file goes on the worker's sweep"
    );

    // A storage outage keeps the row, so the file cannot be orphaned.
    app.storage.unavailable.store(true, Ordering::SeqCst);
    app.worker.sweep().await.expect("sweep");
    let rows: i64 = sqlx::query_scalar("SELECT count(*) FROM yzy_contracts.contracts")
        .fetch_one(&app.admin)
        .await
        .expect("count");
    assert_eq!(rows, 1);

    app.storage.unavailable.store(false, Ordering::SeqCst);
    app.worker.sweep().await.expect("sweep");
    assert!(!app.storage.contains(&key));
    for table in ["contracts", "templates", "conversion_jobs", "file_uploads"] {
        let rows: i64 = sqlx::query_scalar(sqlx::AssertSqlSafe(format!(
            "SELECT count(*) FROM yzy_contracts.{table}"
        )))
        .fetch_one(&app.admin)
        .await
        .expect("count");
        assert_eq!(rows, 0, "{table}");
    }
}

#[tokio::test]
async fn catalog_contract_is_reused_for_new_companies_without_exposing_private_contracts() {
    let app = TestApp::start().await;
    let admin = app.superadmin().await;
    let reader = app.pending_user().await;
    let first = app.legacy_company(admin, "Empresa inicial").await;
    let source = app.create_contract(admin, "Modelo sintético").await;
    let private = app.create_contract(admin, "Privado sintético").await;
    let catalog_id = source["id"].as_str().unwrap();
    sqlx::query(
        "UPDATE yzy_contracts.contracts SET catalog_key = 'venta_condicional' WHERE id = $1",
    )
    .bind(Uuid::parse_str(catalog_id).unwrap())
    .execute(&app.admin)
    .await
    .unwrap();

    let uri = format!("{CONTRACTS}/{catalog_id}");
    assert_eq!(app.get(reader, &uri).await.0, StatusCode::FORBIDDEN);
    let access = format!("/api/v1/admin/users/{}/access", reader.id);
    assert_eq!(
        app.put(admin, &access, json!({"enabled":true})).await.0,
        StatusCode::OK
    );
    let listed = app.get(reader, CONTRACTS).await.1;
    assert_eq!(listed["total"], 1);
    assert_eq!(listed["items"][0]["catalog_key"], "venta_condicional");
    assert_eq!(listed["items"][0]["id"], source["id"]);
    assert_eq!(
        app.get(
            reader,
            &format!("{CONTRACTS}/{}", private["id"].as_str().unwrap())
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        app.get(reader, &format!("{uri}/download-url")).await.0,
        StatusCode::OK
    );

    let (status, created) = app
        .post(
            admin,
            "/api/v1/companies",
            json!({
                "name":"Empresa nueva","values":{"empresa_razon_social":"Empresa nueva"}
            }),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{created}");
    let next = created["id"].as_str().unwrap();
    let generation = format!("{uri}/generation-access");
    for company in [first.to_string(), next.to_owned()] {
        assert_eq!(
            app.get(reader, &format!("{generation}?company_id={company}"))
                .await
                .0,
            StatusCode::NO_CONTENT
        );
    }
    assert_eq!(
        app.get(reader, &generation).await.0,
        StatusCode::UNPROCESSABLE_ENTITY
    );
    assert_eq!(
        app.get(reader, CONTRACTS).await.1["items"][0]["id"],
        source["id"]
    );
    assert_eq!(
        app.patch(admin, &uri, json!({"company_id":first})).await.0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(app.delete(admin, &uri).await.0, StatusCode::NOT_FOUND);
}
