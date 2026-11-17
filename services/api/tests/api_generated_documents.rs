mod common;

use axum::{
    body::Body,
    http::{Method, Request, StatusCode, header},
};
use chrono::{DateTime, Duration, Utc};
use common::{
    DOCX_MIME, EXTRACTOR_KEY, PDF_BYTES, PDF_MIME, TEMPLATE_MAX_BYTES, TestApp, TestUser,
    error_code, token_for,
};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use tower::ServiceExt;
use uuid::Uuid;
use wiremock::{
    Mock, ResponseTemplate,
    matchers::{body_bytes, header as match_header, method, path},
};

const DOCUMENTS: &str = "/api/v1/generated-documents";
const STATS: &str = "/api/v1/generated-documents/stats";
const COMPANIES: &str = "/api/v1/companies";
const DOCX_BYTES: &[u8] = b"PK\x03\x04 synthetic test input";

async fn binary_request(
    app: &TestApp,
    user: TestUser,
    method: Method,
    route: &str,
    mime: &str,
    bytes: Vec<u8>,
) -> (StatusCode, axum::http::HeaderMap, Vec<u8>) {
    let response = app
        .router
        .clone()
        .oneshot(
            Request::builder()
                .method(method)
                .uri(route)
                .header(
                    header::AUTHORIZATION,
                    format!("Bearer {}", token_for(user.id)),
                )
                .header(header::CONTENT_TYPE, mime)
                .body(Body::from(bytes))
                .unwrap(),
        )
        .await
        .unwrap();
    let (parts, body) = response.into_parts();
    (
        parts.status,
        parts.headers,
        body.collect().await.unwrap().to_bytes().to_vec(),
    )
}

async fn put_artifact(
    app: &TestApp,
    user: TestUser,
    route: &str,
    metadata: &Value,
    mime: &str,
    artifact: &[u8],
) -> (StatusCode, Value) {
    let boundary = "test-artifact-boundary";
    let mut body = format!(
        "--{boundary}\r\nContent-Disposition: form-data; name=\"metadata\"\r\n\r\n{metadata}\r\n\
         --{boundary}\r\nContent-Disposition: form-data; name=\"artifact\"; filename=\"test\"\r\n\
         Content-Type: {mime}\r\n\r\n",
    )
    .into_bytes();
    body.extend_from_slice(artifact);
    body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());
    let (status, _, bytes) = binary_request(
        app,
        user,
        Method::PUT,
        route,
        &format!("multipart/form-data; boundary={boundary}"),
        body,
    )
    .await;
    (
        status,
        serde_json::from_slice(&bytes).expect("JSON response"),
    )
}

#[tokio::test]
async fn company_snapshot_stays_with_the_export_and_enforces_ownership_and_replay() {
    let app = TestApp::start().await;
    let owner = app.superadmin().await;
    let other = app.user().await;
    let contract = app.create_contract(owner, "Modelo sintético").await;
    let company_input = |name: &str| {
        json!({
            "name": name,
            "values": {"empresa_razon_social": "Entidad sintética", "empresa_rnc": "000000000"}
        })
    };
    let company = json!({"id": app.legacy_company(owner, "Empresa inicial").await, "name": "Empresa inicial"});
    let company_path = format!("{COMPANIES}/{}", company["id"].as_str().unwrap());
    let id = Uuid::new_v4();
    let detail = format!("{DOCUMENTS}/{id}");
    let artifact = format!("{detail}/artifact");
    let mut payload = pdf(&contract["id"]);
    payload["markdown"] = json!("");
    payload["company"] = json!({
        "id": Uuid::new_v4(),
        "name": "Otra cuenta",
        "values": {"empresa_nombre": "Entidad en el documento"}
    });
    let (status, error) = put_artifact(&app, owner, &artifact, &payload, PDF_MIME, PDF_BYTES).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(error_code(&error), "COMPANY_NOT_FOUND");

    payload["company"]["id"] = company["id"].clone();
    payload["company"]["values"]["cliente_nombre"] = json!("Campo ajeno");
    let (status, error) = put_artifact(&app, owner, &artifact, &payload, PDF_MIME, PDF_BYTES).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(error_code(&error), "VALIDATION_ERROR");

    let snapshot = json!({
        "id": company["id"],
        "name": company["name"],
        "values": {
            "empresa_nombre": "Razón social ajustada en este documento",
            "empresa_rnc": "999999999"
        }
    });
    payload["company"] = snapshot.clone();
    let (status, saved) = put_artifact(&app, owner, &artifact, &payload, PDF_MIME, PDF_BYTES).await;
    assert_eq!(status, StatusCode::CREATED, "{saved}");
    assert_eq!(saved["company"], snapshot);

    let (status, _) = app
        .put(owner, &company_path, company_input("Empresa renombrada"))
        .await;
    assert_eq!(status, StatusCode::OK);
    let (status, _) = app
        .post(owner, &format!("{company_path}/archive"), json!({}))
        .await;
    assert_eq!(status, StatusCode::OK);
    let (status, replay) =
        put_artifact(&app, owner, &artifact, &payload, PDF_MIME, PDF_BYTES).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(replay["company"], snapshot);
    let (_, history) = app.get(owner, DOCUMENTS).await;
    assert_eq!(history["items"][0]["company"], snapshot);
    let (_, document) = app.get(owner, &detail).await;
    assert_eq!(document["company"], snapshot);
    let (status, error) = app.get(other, &detail).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(error_code(&error), "ACCESS_PENDING");
    let (status, _, bytes) =
        binary_request(&app, owner, Method::GET, &artifact, PDF_MIME, Vec::new()).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(bytes, PDF_BYTES);

    payload["company"]["values"]["empresa_rnc"] = json!("111111111");
    let (status, error) = put_artifact(&app, owner, &artifact, &payload, PDF_MIME, PDF_BYTES).await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(error_code(&error), "GENERATED_DOCUMENT_CONFLICT");
    let alternative = app.legacy_company(owner, "Otra empresa propia").await;
    payload["company"] = snapshot;
    payload["company"]["id"] = json!(alternative);
    let (status, error) = put_artifact(&app, owner, &artifact, &payload, PDF_MIME, PDF_BYTES).await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(error_code(&error), "GENERATED_DOCUMENT_CONFLICT");
}

#[tokio::test]
async fn shared_templates_use_active_companies_and_historical_company_snapshots_remain_readable() {
    let app = TestApp::start().await;
    let author = app.user().await;
    let reader = app.superadmin().await;
    let first = app.legacy_company(author, "Empresa compartida Uno").await;
    let second = app.legacy_company(author, "Empresa compartida Dos").await;
    let unrelated = app
        .legacy_company(author, "Empresa fuera del alcance")
        .await;
    let contract = app.create_contract(reader, "Modelo sintético").await;
    let source = format!("/api/v1/contracts/{}", contract["id"].as_str().unwrap());
    let (status, shared) = app
        .patch(
            reader,
            &source,
            json!({"shared_company_ids": [first, second]}),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{shared}");

    let detail = format!("{DOCUMENTS}/{}", Uuid::new_v4());
    let artifact = format!("{detail}/artifact");
    let mut payload = pdf(&contract["id"]);
    payload["markdown"] = json!("");
    let (status, error) =
        put_artifact(&app, reader, &artifact, &payload, PDF_MIME, PDF_BYTES).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{error}");
    payload["company"] = json!({"id": unrelated, "name": "Empresa", "values": {}});
    let (status, error) =
        put_artifact(&app, reader, &artifact, &payload, PDF_MIME, PDF_BYTES).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{error}");
    assert_eq!(error_code(&error), "VALIDATION_ERROR");
    payload["company"]["id"] = json!(second);
    let (status, saved) =
        put_artifact(&app, reader, &artifact, &payload, PDF_MIME, PDF_BYTES).await;
    assert_eq!(status, StatusCode::CREATED, "{saved}");
    assert_eq!(saved["company"]["id"], json!(second));
    let document_id: Uuid = serde_json::from_value(saved["id"].clone()).unwrap();
    sqlx::query("UPDATE yzy_contracts.generated_documents SET owner_id = $1 WHERE id = $2")
        .bind(author.id)
        .bind(document_id)
        .execute(&app.admin)
        .await
        .unwrap();
    assert_eq!(app.get(author, &detail).await.0, StatusCode::FORBIDDEN);
    assert_eq!(
        app.patch(reader, &source, json!({"company_id": null}))
            .await
            .0,
        StatusCode::OK
    );
    let (status, historical) = app.get(reader, &detail).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(historical["id"], saved["id"]);
    assert_eq!(historical["company"], saved["company"]);
    assert_eq!(app.get(reader, DOCUMENTS).await.1["total"], 1);
    assert_eq!(app.get(reader, STATS).await.1["total"], 1);
    let (status, _, bytes) =
        binary_request(&app, reader, Method::GET, &artifact, PDF_MIME, Vec::new()).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(bytes, PDF_BYTES);
}

#[tokio::test]
async fn linked_artifact_requires_an_active_company_scope_and_can_use_another_template() {
    let app = TestApp::start().await;
    let owner = app.superadmin().await;
    let company = app.legacy_company(owner, "Empresa del expediente").await;
    let other_company = app
        .legacy_company(owner, "Empresa ajena al expediente")
        .await;
    let sale = app.create_contract(owner, "Venta sintética").await;
    let template = app
        .create_contract(owner, "Modelo derivado sintético")
        .await;
    let sale_path = format!("/api/v1/contracts/{}", sale["id"].as_str().unwrap());
    let template_path = format!("/api/v1/contracts/{}", template["id"].as_str().unwrap());
    assert_eq!(
        app.patch(owner, &sale_path, json!({"company_id": company}))
            .await
            .0,
        StatusCode::OK
    );
    assert_eq!(
        app.patch(
            owner,
            &template_path,
            json!({"shared_company_ids": [company, other_company]})
        )
        .await
        .0,
        StatusCode::OK
    );
    let (status, client) = app
        .post(
            owner,
            "/api/v1/clients",
            json!({"name": "Cliente ficticio"}),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{client}");
    let operations = format!(
        "/api/v1/clients/{}/operations",
        client["id"].as_str().unwrap()
    );
    let (status, operation) = app
        .post(
            owner,
            &operations,
            json!({"company_id": company, "contract_id": sale["id"], "vehicle": {"plate": "SINTETICA"}}),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{operation}");
    let operation_id = operation["id"].as_str().unwrap();
    let access = format!("{template_path}/generation-access");
    let scope = format!("company_id={company}&operation_id={operation_id}");
    assert_eq!(
        app.get(owner, &format!("{access}?operation_id={operation_id}"))
            .await
            .0,
        StatusCode::UNPROCESSABLE_ENTITY
    );
    assert_eq!(
        app.get(
            owner,
            &format!("{access}?company_id={other_company}&operation_id={operation_id}")
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        app.get(owner, &format!("{access}?{scope}")).await.0,
        StatusCode::NO_CONTENT
    );

    let template_id: Uuid = serde_json::from_value(template["id"].clone()).unwrap();
    sqlx::query("UPDATE yzy_contracts.contracts SET mime_type = $2 WHERE id = $1")
        .bind(template_id)
        .bind(DOCX_MIME)
        .execute(&app.admin)
        .await
        .unwrap();
    Mock::given(method("POST"))
        .and(path("/v1/render/pdf"))
        .and(body_bytes(DOCX_BYTES))
        .respond_with(ResponseTemplate::new(200).set_body_raw(PDF_BYTES, PDF_MIME))
        .expect(1)
        .mount(&app.extractor)
        .await;
    let render = format!("{template_path}/render-pdf?{scope}");
    assert_eq!(
        binary_request(
            &app,
            owner,
            Method::POST,
            &render,
            DOCX_MIME,
            DOCX_BYTES.to_vec()
        )
        .await
        .0,
        StatusCode::OK
    );

    let detail = format!("{DOCUMENTS}/{}", Uuid::new_v4());
    let artifact = format!("{detail}/artifact");
    let mut payload = pdf(&template["id"]);
    payload["markdown"] = json!("");
    payload["operation_id"] = json!(operation_id);
    payload["document_type"] = json!("venta_condicional");
    payload["company"] = json!({"id": other_company, "name": "Otra empresa", "values": {}});
    assert_eq!(
        put_artifact(&app, owner, &artifact, &payload, PDF_MIME, PDF_BYTES)
            .await
            .0,
        StatusCode::NOT_FOUND
    );
    payload["company"]["id"] = json!(company);
    let (status, saved) = put_artifact(&app, owner, &artifact, &payload, PDF_MIME, PDF_BYTES).await;
    assert_eq!(status, StatusCode::CREATED, "{saved}");
    assert_eq!(saved["operation_id"], operation_id);
    assert_eq!(saved["document_type"], "venta_condicional");
    assert_eq!(saved["contract_id"], template["id"]);
    assert_eq!(
        app.get(owner, &detail).await.1["operation_id"],
        operation_id
    );
    assert_eq!(
        app.get(owner, DOCUMENTS).await.1["items"][0]["operation_id"],
        operation_id
    );

    let (status, empty_case) = app
        .post(
            owner,
            &operations,
            json!({"company_id": company, "vehicle": {}}),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{empty_case}");
    assert_eq!(empty_case["contract_id"], Value::Null);
    let empty_id = empty_case["id"].as_str().unwrap();
    assert_ne!(empty_id, operation_id);
    assert_eq!(
        app.get(owner, &operations)
            .await
            .1
            .as_array()
            .unwrap()
            .len(),
        2
    );
    let empty_scope = format!("company_id={company}&operation_id={empty_id}");
    assert_eq!(
        app.get(owner, &format!("{access}?{empty_scope}")).await.0,
        StatusCode::NO_CONTENT
    );
    let mut other_case_payload = payload.clone();
    other_case_payload["operation_id"] = json!(empty_id);
    let mut latest = Value::Null;
    for _ in 0..2 {
        let target = format!("{DOCUMENTS}/{}/artifact", Uuid::new_v4());
        let (status, document) = put_artifact(
            &app,
            owner,
            &target,
            &other_case_payload,
            PDF_MIME,
            PDF_BYTES,
        )
        .await;
        assert_eq!(status, StatusCode::CREATED, "{document}");
        latest = document;
    }
    // Regenerating the same template and format in a case replaces the copy.
    let (status, page) = app
        .get(
            owner,
            &format!("{DOCUMENTS}?operation_id={empty_id}&per_page=1"),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{page}");
    assert_eq!(page["total"], 1);
    assert_eq!(page["items"][0]["id"], latest["id"]);
    let (status, page) = app
        .get(owner, &format!("{DOCUMENTS}?operation_id={operation_id}"))
        .await;
    assert_eq!(status, StatusCode::OK, "{page}");
    assert_eq!(page["items"], json!([saved]));

    let empty_detail = format!(
        "/api/v1/companies/{company}/clients/{}/operations/{empty_id}",
        client["id"].as_str().unwrap()
    );
    let (status, updated) = app
        .patch(owner, &empty_detail, json!({"contract_id": sale["id"]}))
        .await;
    assert_eq!(status, StatusCode::OK, "{updated}");
    assert_eq!(updated["contract_id"], sale["id"]);
    let (status, updated) = app
        .patch(owner, &empty_detail, json!({"contract_id": null}))
        .await;
    assert_eq!(status, StatusCode::OK, "{updated}");
    assert_eq!(updated["contract_id"], Value::Null);
    assert_eq!(
        app.get(owner, &format!("{DOCUMENTS}?operation_id={empty_id}"))
            .await
            .1["total"],
        1
    );

    assert_eq!(
        app.patch(owner, &sale_path, json!({"company_id": null}))
            .await
            .0,
        StatusCode::OK
    );
    assert_eq!(
        app.get(owner, &format!("{access}?{scope}")).await.0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        put_artifact(&app, owner, &artifact, &payload, PDF_MIME, PDF_BYTES)
            .await
            .0,
        StatusCode::OK
    );
    let mut altered = payload.clone();
    altered["operation_id"] = json!(Uuid::new_v4());
    assert_eq!(
        put_artifact(&app, owner, &artifact, &altered, PDF_MIME, PDF_BYTES)
            .await
            .0,
        StatusCode::CONFLICT
    );

    assert_eq!(
        app.patch(owner, &sale_path, json!({"company_id": company}))
            .await
            .0,
        StatusCode::OK
    );
    assert_eq!(
        app.get(owner, &format!("{access}?{scope}")).await.0,
        StatusCode::NO_CONTENT
    );
    let (status, _) = app
        .post(owner, &format!("{COMPANIES}/{company}/archive"), json!({}))
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(app.get(owner, &detail).await.0, StatusCode::OK);
    assert_eq!(app.get(owner, DOCUMENTS).await.1["total"], 2);
    assert_eq!(app.get(owner, STATS).await.1["total"], 2);
    assert_eq!(
        binary_request(&app, owner, Method::GET, &artifact, PDF_MIME, Vec::new())
            .await
            .0,
        StatusCode::OK
    );
    assert_eq!(
        put_artifact(&app, owner, &artifact, &payload, PDF_MIME, PDF_BYTES)
            .await
            .0,
        StatusCode::OK
    );
    let new_artifact = format!("{DOCUMENTS}/{}/artifact", Uuid::new_v4());
    assert_eq!(
        put_artifact(&app, owner, &new_artifact, &payload, PDF_MIME, PDF_BYTES)
            .await
            .0,
        StatusCode::NOT_FOUND
    );
}

#[tokio::test]
async fn native_artifact_is_immutable_private_and_independent_of_original() {
    let app = TestApp::start().await;
    let owner = app.superadmin().await;
    let other = app.user().await;
    let contract = app.create_contract(owner, "Modelo sintético").await;
    let id = Uuid::new_v4();
    let detail = format!("{DOCUMENTS}/{id}");
    let artifact = format!("{detail}/artifact");
    let mut payload = pdf(&contract["id"]);
    payload["markdown"] = json!("");

    let (first, second) = tokio::join!(
        put_artifact(&app, owner, &artifact, &payload, PDF_MIME, PDF_BYTES),
        put_artifact(&app, owner, &artifact, &payload, PDF_MIME, PDF_BYTES)
    );
    let statuses = [first.0, second.0];
    assert!(
        statuses.contains(&StatusCode::CREATED),
        "{first:?} {second:?}"
    );
    assert!(statuses.contains(&StatusCode::OK), "{first:?} {second:?}");
    assert_eq!(first.1, second.1);
    assert_eq!(first.1["has_artifact"], true);
    assert_eq!(
        app.get(owner, DOCUMENTS).await.1["items"][0]["has_artifact"],
        true
    );
    assert_eq!(app.get(owner, &detail).await.1["has_artifact"], true);
    assert_eq!(
        app.put(owner, &detail, pdf(&contract["id"])).await.0,
        StatusCode::CONFLICT
    );
    assert_eq!(
        put_artifact(
            &app,
            owner,
            &artifact,
            &payload,
            PDF_MIME,
            b"%PDF-1.7 changed"
        )
        .await
        .0,
        StatusCode::CONFLICT,
    );
    assert_eq!(
        put_artifact(&app, other, &artifact, &payload, PDF_MIME, PDF_BYTES)
            .await
            .0,
        StatusCode::FORBIDDEN,
    );
    assert_eq!(
        binary_request(&app, other, Method::GET, &artifact, PDF_MIME, vec![])
            .await
            .0,
        StatusCode::FORBIDDEN,
    );
    let invalid = format!("{DOCUMENTS}/{}/artifact", Uuid::new_v4());
    assert_eq!(
        put_artifact(&app, owner, &invalid, &payload, PDF_MIME, b"not a PDF")
            .await
            .0,
        StatusCode::UNPROCESSABLE_ENTITY,
    );
    assert_eq!(
        put_artifact(
            &app,
            owner,
            &invalid,
            &email(&contract["id"]),
            DOCX_MIME,
            DOCX_BYTES
        )
        .await
        .0,
        StatusCode::UNPROCESSABLE_ENTITY,
    );

    let contract_id: Uuid = serde_json::from_value(contract["id"].clone()).unwrap();
    sqlx::query("DELETE FROM yzy_contracts.contracts WHERE id = $1")
        .bind(contract_id)
        .execute(&app.admin)
        .await
        .unwrap();
    assert_eq!(
        put_artifact(&app, owner, &artifact, &payload, PDF_MIME, PDF_BYTES)
            .await
            .0,
        StatusCode::OK
    );
    let (status, headers, bytes) =
        binary_request(&app, owner, Method::GET, &artifact, PDF_MIME, vec![]).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(headers[header::CONTENT_TYPE], PDF_MIME);
    assert_eq!(headers[header::CACHE_CONTROL], "private, no-store");
    assert!(
        headers[header::CONTENT_DISPOSITION]
            .to_str()
            .unwrap()
            .starts_with("attachment;")
    );
    assert_eq!(bytes, PDF_BYTES);
}

#[tokio::test]
async fn word_render_checks_ownership_and_can_render_a_saved_email_attachment() {
    let app = TestApp::start().await;
    let owner = app.superadmin().await;
    let other = app.user().await;
    let source = app.create_contract(owner, "Modelo Word sintético").await;
    let id: Uuid = serde_json::from_value(source["id"].clone()).unwrap();
    let route = format!("/api/v1/contracts/{id}/render-pdf");
    assert_eq!(
        binary_request(
            &app,
            owner,
            Method::POST,
            &route,
            DOCX_MIME,
            DOCX_BYTES.to_vec()
        )
        .await
        .0,
        StatusCode::UNSUPPORTED_MEDIA_TYPE,
    );
    sqlx::query("UPDATE yzy_contracts.contracts SET mime_type = $2 WHERE id = $1")
        .bind(id)
        .bind(DOCX_MIME)
        .execute(&app.admin)
        .await
        .unwrap();
    Mock::given(method("POST"))
        .and(path("/v1/render/pdf"))
        .and(match_header("x-internal-api-key", EXTRACTOR_KEY))
        .and(match_header("content-type", DOCX_MIME))
        .and(body_bytes(DOCX_BYTES))
        .respond_with(ResponseTemplate::new(200).set_body_raw(PDF_BYTES, PDF_MIME))
        .expect(2)
        .mount(&app.extractor)
        .await;
    assert_eq!(
        binary_request(
            &app,
            other,
            Method::POST,
            &route,
            DOCX_MIME,
            DOCX_BYTES.to_vec()
        )
        .await
        .0,
        StatusCode::FORBIDDEN,
    );
    let (status, headers, body) = binary_request(
        &app,
        owner,
        Method::POST,
        &route,
        DOCX_MIME,
        DOCX_BYTES.to_vec(),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(headers[header::CACHE_CONTROL], "private, no-store");
    assert_eq!(body, PDF_BYTES);

    let pdf_artifact = format!("{DOCUMENTS}/{}/artifact", Uuid::new_v4());
    assert_eq!(
        put_artifact(
            &app,
            owner,
            &pdf_artifact,
            &pdf(&source["id"]),
            PDF_MIME,
            PDF_BYTES
        )
        .await
        .0,
        StatusCode::CREATED,
    );
    let base = format!("{DOCUMENTS}/{}", Uuid::new_v4());
    let artifact = format!("{base}/artifact");
    let render = format!("{base}/render-pdf");
    assert_eq!(
        put_artifact(
            &app,
            owner,
            &artifact,
            &email(&source["id"]),
            DOCX_MIME,
            DOCX_BYTES
        )
        .await
        .0,
        StatusCode::CREATED,
    );
    sqlx::query("DELETE FROM yzy_contracts.contracts WHERE id = $1")
        .bind(id)
        .execute(&app.admin)
        .await
        .unwrap();
    let (status, headers, bytes) =
        binary_request(&app, owner, Method::GET, &artifact, DOCX_MIME, vec![]).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(headers[header::CONTENT_TYPE], DOCX_MIME);
    assert!(
        headers[header::CONTENT_DISPOSITION]
            .to_str()
            .unwrap()
            .contains("acuerdo.docx")
    );
    assert_eq!(bytes, DOCX_BYTES);
    assert_eq!(
        binary_request(&app, other, Method::POST, &render, DOCX_MIME, vec![])
            .await
            .0,
        StatusCode::FORBIDDEN,
    );
    let (status, _, bytes) =
        binary_request(&app, owner, Method::POST, &render, DOCX_MIME, vec![]).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(bytes, PDF_BYTES);
}

fn pdf(contract_id: &Value) -> Value {
    json!({
        "contract_id": contract_id,
        "format": "pdf",
        "filename": "acuerdo.pdf",
        "markdown": "# Acuerdo sintético"
    })
}

fn email(contract_id: &Value) -> Value {
    json!({
        "contract_id": contract_id,
        "format": "email",
        "filename": "acuerdo.eml",
        "markdown": "# Acuerdo sintético",
        "email": {
            "to": "cliente@example.test",
            "cc": "copia@example.test",
            "subject": "Acuerdo",
            "message": "Revisión del acuerdo.",
            "attachment_format": "docx"
        }
    })
}

#[tokio::test]
async fn immutable_document_survives_retry_and_purge_and_is_private() {
    let app = TestApp::start().await;
    let owner = app.superadmin().await;
    let other = app.user().await;
    let contract = app.create_contract(owner, "Acuerdo sintético").await;
    let id = Uuid::new_v4();
    let route = format!("{DOCUMENTS}/{id}");
    let payload = pdf(&contract["id"]);

    let (first, second) = tokio::join!(
        app.put(owner, &route, payload.clone()),
        app.put(owner, &route, payload.clone())
    );
    let statuses = [first.0, second.0];
    assert!(
        statuses.contains(&StatusCode::CREATED),
        "{first:?} {second:?}"
    );
    assert!(statuses.contains(&StatusCode::OK), "{first:?} {second:?}");
    assert_eq!(first.1, second.1);
    assert_eq!(first.1["contract_name"], "Acuerdo sintético");
    assert!(first.1.get("markdown").is_none());

    let mut edited_payload = payload.clone();
    edited_payload["markdown"] = json!("Otro contenido");
    let (status, error) = app.put(owner, &route, edited_payload).await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(error_code(&error), "GENERATED_DOCUMENT_CONFLICT");

    let other_route = format!("{DOCUMENTS}/{}", Uuid::new_v4());
    let (status, error) = app.put(other, &other_route, payload.clone()).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(error_code(&error), "ACCESS_PENDING");
    let (status, error) = app.get(other, &route).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(error_code(&error), "ACCESS_PENDING");
    assert_eq!(app.get(other, DOCUMENTS).await.0, StatusCode::FORBIDDEN);
    assert_eq!(app.get(other, STATS).await.0, StatusCode::FORBIDDEN);

    let response = app
        .router
        .clone()
        .oneshot(
            Request::builder()
                .uri(&route)
                .header(
                    header::AUTHORIZATION,
                    format!("Bearer {}", token_for(owner.id)),
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

    let contract_id: Uuid = serde_json::from_value(contract["id"].clone()).unwrap();
    sqlx::query("DELETE FROM yzy_contracts.contracts WHERE id = $1")
        .bind(contract_id)
        .execute(&app.admin)
        .await
        .unwrap();
    let (status, body) = app.get(owner, &route).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["markdown"], payload["markdown"]);
    assert_eq!(
        app.put(owner, &route, payload.clone()).await.0,
        StatusCode::OK
    );

    let legacy_route = format!("{DOCUMENTS}/{}", Uuid::new_v4());
    let mut imported = email(&contract["id"]);
    imported["legacy"] = json!({
        "contract_name": "Acuerdo histórico",
        "created_at": "2026-07-01T16:42:00.123Z"
    });
    let (status, body) = app.put(owner, &legacy_route, imported.clone()).await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    assert_eq!(body["contract_name"], "Acuerdo histórico");
    assert_eq!(body["created_at"], "2026-07-01T16:42:00.123Z");
    assert_eq!(
        app.put(owner, &legacy_route, imported.clone()).await.0,
        StatusCode::OK
    );
    assert_eq!(
        app.get(owner, &legacy_route).await.1["email"],
        imported["email"]
    );

    let private_id = Uuid::new_v4();
    let contract_id: Uuid = serde_json::from_value(contract["id"].clone()).unwrap();
    sqlx::query(
        "INSERT INTO yzy_contracts.generated_documents
            (id, owner_id, contract_id, contract_name, format, filename, markdown, imported_from_session)
         VALUES ($1, $2, $3, 'Archivo personal', 'pdf', 'archivo.pdf', '', true)",
    )
    .bind(private_id)
    .bind(other.id)
    .bind(contract_id)
    .execute(&app.admin)
    .await
    .unwrap();
    let (status, error) = app.get(owner, &format!("{DOCUMENTS}/{private_id}")).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(error_code(&error), "GENERATED_DOCUMENT_NOT_FOUND");
    assert_eq!(app.get(owner, STATS).await.1["total"], 2);
}

#[tokio::test]
async fn metadata_paginates_and_stats_use_santo_domingo_month_boundary() {
    let app = TestApp::start().await;
    let owner = app.superadmin().await;
    let contract_id = json!(Uuid::new_v4());
    let start: DateTime<Utc> = sqlx::query_scalar(
        "SELECT date_trunc('month', now() AT TIME ZONE 'America/Santo_Domingo')
                AT TIME ZONE 'America/Santo_Domingo'",
    )
    .fetch_one(&app.admin)
    .await
    .unwrap();
    let before = start - Duration::milliseconds(1);
    let mut first = pdf(&contract_id);
    first["legacy"] = json!({"contract_name": "Compañía Órbita", "created_at": before});
    let mut second = email(&contract_id);
    second["legacy"] = json!({"contract_name": "Compañía Órbita", "created_at": start});
    let first_id = Uuid::new_v4();
    let second_id = Uuid::new_v4();
    for (id, payload) in [(first_id, first), (second_id, second)] {
        let (status, body) = app.put(owner, &format!("{DOCUMENTS}/{id}"), payload).await;
        assert_eq!(status, StatusCode::CREATED, "{body}");
    }

    let (status, page) = app
        .get(
            owner,
            &format!("{DOCUMENTS}?per_page=1&q=compania%20orbita"),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{page}");
    assert_eq!(page["total"], 2);
    assert_eq!(page["page"], 1);
    assert_eq!(page["per_page"], 1);
    assert_eq!(page["items"].as_array().unwrap().len(), 1);
    assert_eq!(page["items"][0]["id"], json!(second_id));
    assert!(page["items"][0].get("markdown").is_none());
    assert!(page["items"][0].get("email").is_none());
    let (_, filtered) = app
        .get(
            owner,
            &format!("{DOCUMENTS}?format=pdf&q={}", contract_id.as_str().unwrap()),
        )
        .await;
    assert_eq!(filtered["total"], 1);
    assert_eq!(filtered["items"][0]["id"], json!(first_id));
    let (_, empty_page) = app
        .get(owner, &format!("{DOCUMENTS}?page=3&per_page=1"))
        .await;
    assert_eq!(empty_page["total"], 2);
    assert_eq!(empty_page["items"], json!([]));

    let (status, stats) = app.get(owner, STATS).await;
    assert_eq!(status, StatusCode::OK, "{stats}");
    assert_eq!(stats["total"], 2);
    assert_eq!(stats["current_month_total"], 1);
    assert_eq!(stats["formats"], json!({"pdf": 1, "docx": 0, "email": 1}));
    assert_eq!(stats["months"].as_array().unwrap().len(), 6);
    assert_eq!(stats["months"][4]["total"], 1);
    assert_eq!(stats["months"][5]["total"], 1);
    assert_eq!(
        stats["months"][5]["month"],
        start.format("%Y-%m").to_string()
    );
}

#[tokio::test]
async fn validates_document_and_allows_json_overhead_for_valid_fields() {
    let app = TestApp::start().await;
    let owner = app.superadmin().await;
    let contract = app.create_contract(owner, "Acuerdo sintético").await;
    let route = format!("{DOCUMENTS}/{}", Uuid::new_v4());
    let mut payload = email(&contract["id"]);
    payload["filename"] = json!("carpeta/acuerdo.eml");
    assert_eq!(
        app.put(owner, &route, payload.clone()).await.0,
        StatusCode::UNPROCESSABLE_ENTITY
    );
    payload["filename"] = json!("acuerdo.eml");
    payload["markdown"] = json!("x".repeat(TEMPLATE_MAX_BYTES + 1));
    assert_eq!(
        app.put(owner, &route, payload.clone()).await.0,
        StatusCode::PAYLOAD_TOO_LARGE
    );

    payload["markdown"] = json!("x".repeat(TEMPLATE_MAX_BYTES));
    payload["email"]["message"] = json!("\u{0001}".repeat(12_000));
    let (status, body) = app.put(owner, &route, payload).await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
}
