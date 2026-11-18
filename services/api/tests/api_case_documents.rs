mod common;

use std::io::{Cursor, Read, Write};

use axum::{
    body::Body,
    http::{Method, Request, StatusCode, header},
};
use common::{
    DOCX_MIME, EXTRACTOR_KEY, PDF_BYTES, PDF_MIME, TestApp, TestUser, error_code, token_for,
};
use http_body_util::BodyExt;
use serde::Deserialize;
use serde_json::{Value, json};
use tower::ServiceExt;
use uuid::Uuid;
use wiremock::{
    Mock, ResponseTemplate,
    matchers::{header as match_header, method, path},
};
use zip::{ZipArchive, ZipWriter, write::SimpleFileOptions};

const ROOT: &str = "/api/v1/expedientes";

#[derive(Deserialize)]
struct ParityFixture {
    client: Value,
    operation: Value,
    company: Value,
    insurer: Value,
    cases: Vec<ParityCase>,
}

#[derive(Deserialize)]
struct ParityCase {
    #[serde(rename = "type")]
    kind: String,
    label: String,
    document_xml: String,
    expected_xml: String,
    operator_values: Value,
    company_values: Value,
}

fn fixture() -> ParityFixture {
    serde_json::from_str(include_str!("../../../fixtures/parity/expediente.json")).unwrap()
}

fn url(operation: Uuid, document: Uuid) -> String {
    format!("{ROOT}/{operation}/documents/{document}")
}

fn available_url(operation: Uuid, company: Uuid) -> String {
    format!("{ROOT}/{operation}/available-documents?company_id={company}")
}

fn available_type<'a>(available: &'a Value, kind: &str) -> &'a Value {
    available
        .as_array()
        .unwrap()
        .iter()
        .find(|document| document["document_type"] == kind)
        .unwrap()
}

async fn seed_case(app: &TestApp, owner: TestUser, data: &ParityFixture) -> (Uuid, Uuid) {
    let company = app
        .legacy_company(owner, data.company["name"].as_str().unwrap())
        .await;
    let mut values = data.company["values"].clone();
    values.as_object_mut().unwrap().remove("empresa_nombre");
    sqlx::query("UPDATE yzy_contracts.companies SET variable_values = $2 WHERE id = $1")
        .bind(company)
        .bind(sqlx::types::Json(values))
        .execute(&app.admin)
        .await
        .unwrap();
    let (status, client) = app
        .post(owner, "/api/v1/clients", data.client.clone())
        .await;
    assert_eq!(status, StatusCode::CREATED, "{client}");
    let mut body = data.operation.clone();
    body["company_id"] = json!(company);
    let (status, operation) = app
        .post(
            owner,
            &format!(
                "/api/v1/clients/{}/operations",
                client["id"].as_str().unwrap()
            ),
            body,
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{operation}");
    (
        company,
        serde_json::from_value(operation["id"].clone()).unwrap(),
    )
}

fn docx(xml: &str) -> Vec<u8> {
    let mut zip = ZipWriter::new(Cursor::new(Vec::new()));
    for (file, data) in [
        (
            "[Content_Types].xml",
            r#"<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>"#,
        ),
        ("word/document.xml", xml),
    ] {
        zip.start_file(file, SimpleFileOptions::default()).unwrap();
        zip.write_all(data.as_bytes()).unwrap();
    }
    zip.finish().unwrap().into_inner()
}

async fn add_template(app: &TestApp, user: TestUser, company: Uuid, document: &ParityCase) -> Uuid {
    let source = docx(&document.document_xml);
    let (status, upload) = app
        .post(
            user,
            "/api/v1/files/upload-url",
            json!({"file_name": "modelo.docx", "mime_type": DOCX_MIME, "size_bytes": source.len()}),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{upload}");
    let upload_id: Uuid = serde_json::from_value(upload["upload_id"].clone()).unwrap();
    let key: String =
        sqlx::query_scalar("SELECT object_key FROM yzy_contracts.file_uploads WHERE id = $1")
            .bind(upload_id)
            .fetch_one(&app.admin)
            .await
            .unwrap();
    app.storage.put(&key, &source, DOCX_MIME);
    let (status, template) = app
        .post(
            user,
            "/api/v1/contracts",
            json!({"company_id": company, "upload_id": upload_id, "name": document.label}),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{template}");
    serde_json::from_value(template["id"].clone()).unwrap()
}

async fn download(app: &TestApp, user: TestUser, id: Uuid, mime: &str) -> Vec<u8> {
    let response = app
        .router
        .clone()
        .oneshot(
            Request::get(format!("/api/v1/generated-documents/{id}/artifact"))
                .header(
                    header::AUTHORIZATION,
                    format!("Bearer {}", token_for(user.id)),
                )
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response.headers()[header::CONTENT_TYPE], mime);
    response
        .into_body()
        .collect()
        .await
        .unwrap()
        .to_bytes()
        .to_vec()
}

fn word_xml(bytes: &[u8]) -> String {
    let mut zip = ZipArchive::new(Cursor::new(bytes)).unwrap();
    let mut xml = String::new();
    zip.by_name("word/document.xml")
        .unwrap()
        .read_to_string(&mut xml)
        .unwrap();
    xml
}

// Compare expanded names and effective attribute values; XML serializers may use different prefixes.
fn canonical(xml: &str) -> Vec<String> {
    let doc = roxmltree::Document::parse(xml).unwrap();
    doc.root_element()
        .descendants()
        .map(|node| {
            if node.is_element() {
                let mut attrs: Vec<_> = node
                    .attributes()
                    .map(|attr| (attr.namespace(), attr.name(), attr.value()))
                    .collect();
                attrs.sort_unstable();
                format!(
                    "{:?} {:?} {:?}",
                    node.parent_element().map(|parent| parent.tag_name().name()),
                    node.tag_name(),
                    attrs
                )
            } else {
                format!(
                    "text {:?} {:?}",
                    node.parent_element().map(|parent| parent.tag_name().name()),
                    node.text()
                )
            }
        })
        .collect()
}

#[tokio::test]
async fn generated_case_artifacts_match_the_portal_for_all_catalog_types() {
    let data = fixture();
    let app = TestApp::start().await;
    let admin = app.superadmin().await;
    let (company, operation) = seed_case(&app, admin, &data).await;
    let issuer = app
        .legacy_company(
            admin,
            data.insurer["empresa_razon_social"].as_str().unwrap(),
        )
        .await;
    sqlx::query("UPDATE yzy_contracts.companies SET variable_values = $2 WHERE id = $1")
        .bind(issuer)
        .bind(sqlx::types::Json(&data.insurer))
        .execute(&app.admin)
        .await
        .unwrap();
    let mut templates = Vec::new();
    for case in &data.cases {
        templates.push(add_template(&app, admin, company, case).await);
    }
    let (status, available) = app.get(admin, &available_url(operation, company)).await;
    assert_eq!(status, StatusCode::OK, "{available}");
    assert_eq!(available.as_array().unwrap().len(), 18);
    let mut failures = Vec::new();
    for (fixture, contract) in data.cases.iter().zip(templates) {
        let kind = &fixture.kind;
        let available = available_type(&available, kind);
        assert_eq!(available["status"], "ready", "{kind}: {available}");
        assert_eq!(available["latest_generated"], Value::Null);
        assert_eq!(
            available["candidates"][0]["contract_id"],
            json!(contract),
            "{kind}"
        );
        assert_eq!(
            available["operator_fields"].as_array().unwrap().len(),
            fixture.operator_values.as_object().unwrap().len()
        );
        let id = Uuid::new_v4();
        let body = json!({"company_id":company, "document_type":kind, "format":"docx", "operator_values":fixture.operator_values});
        let (status, metadata) = app.put(admin, &url(operation, id), body).await;
        if status != StatusCode::CREATED {
            failures.push(format!("{kind}: {status} {metadata}"));
            continue;
        }
        assert_eq!(metadata["id"], json!(id));
        assert_eq!(metadata["contract_id"], json!(contract));
        assert_eq!(
            metadata["company"]["values"], fixture.company_values,
            "{kind}"
        );
        let actual = word_xml(&download(&app, admin, id, DOCX_MIME).await);
        let expected = canonical(&fixture.expected_xml);
        let actual_tree = canonical(&actual);
        if expected != actual_tree {
            let first = expected
                .iter()
                .zip(&actual_tree)
                .position(|(portal, rust)| portal != rust)
                .unwrap_or(expected.len().min(actual_tree.len()));
            failures.push(format!(
                "{kind} at XML node {first}\n  portal: {:?}\n  rust:   {:?}",
                expected.get(first),
                actual_tree.get(first)
            ));
        } else {
            eprintln!("expediente parity PASS {kind}");
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
    let (status, history) = app
        .get(
            admin,
            &format!("/api/v1/generated-documents?operation_id={operation}&per_page=100"),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{history}");
    // The existing history endpoint consolidates the legacy insured sale with acto_seguro.
    assert_eq!(history["total"], 17);
    let (_, available) = app.get(admin, &available_url(operation, company)).await;
    for fixture in &data.cases {
        assert_eq!(
            available_type(&available, &fixture.kind)["latest_generated"]["format"],
            "docx"
        );
    }
}

#[tokio::test]
async fn scopes_authenticates_and_rejects_generation_for_suspended_company() {
    let data = fixture();
    let app = TestApp::start().await;
    let admin = app.superadmin().await;
    let (company, operation) = seed_case(&app, admin, &data).await;
    let other = app.pending_user().await;
    let put = url(operation, Uuid::new_v4());
    let get = available_url(operation, company);
    let body = json!({"company_id": company, "document_type": "acuerdo_seguro", "format":"docx"});
    for (method, path, body) in [
        (Method::PUT, put.as_str(), Some(body.clone())),
        (Method::GET, get.as_str(), None),
    ] {
        let (status, response) = app.request(method.clone(), path, None, body.clone()).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED, "{response}");
        assert_eq!(error_code(&response), "UNAUTHENTICATED");
        let (status, response) = app
            .request(method, path, Some(&token_for(other.id)), body)
            .await;
        assert_eq!(status, StatusCode::FORBIDDEN, "{response}");
        assert_eq!(error_code(&response), "ACCESS_PENDING");
    }
    let wrong = app.legacy_company(admin, "Otra empresa sintética").await;
    let (_, response) = app.get(admin, &available_url(operation, wrong)).await;
    assert_eq!(error_code(&response), "CLIENT_OPERATION_NOT_FOUND");
    let (status, account) = app.post(admin, "/api/v1/admin/billing/accounts", json!({
        "name": "Facturación sintética", "manager_user_id": admin.id, "company_ids": [company]
    })).await;
    assert_eq!(status, StatusCode::CREATED, "{account}");
    let account_id: Uuid = serde_json::from_value(account["id"].clone()).unwrap();
    let mut tx = app.admin.begin().await.unwrap();
    for table in ["billing_accounts", "billing_account_companies"] {
        let id = if table == "billing_accounts" {
            "id"
        } else {
            "account_id"
        };
        sqlx::query(sqlx::AssertSqlSafe(format!(
            "UPDATE yzy_contracts.{table} SET starts_on = (date_trunc('month', now() AT TIME ZONE 'America/Santo_Domingo') - interval '1 month')::date WHERE {id} = $1"
        ))).bind(account_id).execute(&mut *tx).await.unwrap();
    }
    tx.commit().await.unwrap();
    assert_eq!(app.get(admin, "/api/v1/billing").await.0, StatusCode::OK);
    let (status, payment) = app.put(admin, &put, body).await;
    assert_eq!(status, StatusCode::PAYMENT_REQUIRED, "{payment}");
    assert_eq!(error_code(&payment), "PAYMENT_REQUIRED");
    assert_eq!(app.get(admin, &get).await.0, StatusCode::OK);
    sqlx::query("UPDATE yzy_contracts.companies SET archived_at = now() WHERE id = $1")
        .bind(company)
        .execute(&app.admin)
        .await
        .unwrap();
    let (status, response) = app.get(admin, &get).await;
    assert_eq!(status, StatusCode::NOT_FOUND, "{response}");
    assert_eq!(error_code(&response), "COMPANY_NOT_FOUND");
    let (status, response) = app
        .put(
            admin,
            &put,
            json!({
                "company_id": company, "document_type": "acuerdo_seguro", "format":"docx"
            }),
        )
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND, "{response}");
    assert_eq!(error_code(&response), "COMPANY_NOT_FOUND");
}

#[tokio::test]
async fn disambiguates_validates_replays_and_saves_the_rendered_pdf() {
    let data = fixture();
    let app = TestApp::start().await;
    let admin = app.superadmin().await;
    let (company, operation) = seed_case(&app, admin, &data).await;
    let fixture = data
        .cases
        .iter()
        .find(|case| case.kind == "carta_saldo")
        .unwrap();
    let first = add_template(&app, admin, company, fixture).await;
    let second = add_template(&app, admin, company, fixture).await;
    let get = available_url(operation, company);
    let (_, available) = app.get(admin, &get).await;
    let balance = available_type(&available, "carta_saldo");
    assert_eq!(balance["status"], "ambiguous");
    assert_eq!(
        balance["operator_fields"],
        json!([
            {"key":"saldo_confirmado","label":"Saldo confirmado (RD$)","kind":"money","required":true},
            {"key":"fecha_saldo","label":"Fecha del saldo confirmado","kind":"date","required":true},
        ])
    );
    let id = Uuid::new_v4();
    let put = url(operation, id);
    let selected_body = json!({
        "company_id":company, "document_type":"carta_saldo", "format":"docx",
        "operator_values":fixture.operator_values,
    });
    let (status, error) = app.put(admin, &put, selected_body.clone()).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{error}");
    assert_eq!(error_code(&error), "DOCUMENT_TEMPLATE_AMBIGUOUS");
    assert_eq!(error["error"]["candidates"], balance["candidates"]);
    assert_eq!(balance["candidates"].as_array().unwrap().len(), 2);

    for (operator_values, label) in [
        (json!({}), "Saldo confirmado (RD$)"),
        (
            json!({"saldo_confirmado":"-1", "fecha_saldo":"2026-11-16"}),
            "Saldo confirmado (RD$)",
        ),
        (
            json!({"saldo_confirmado":"1", "fecha_saldo":"2026-02-30"}),
            "Fecha del saldo confirmado",
        ),
        (
            json!({"saldo_confirmado":"1", "fecha_saldo":"2026-11-16", "otro":"sintético"}),
            "otro",
        ),
    ] {
        let mut invalid = selected_body.clone();
        invalid["operator_values"] = operator_values;
        let (status, body) = app.put(admin, &put, invalid).await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
        assert_eq!(error_code(&body), "VALIDATION_ERROR");
        assert!(
            body["error"]["message"].as_str().unwrap().contains(label),
            "{body}"
        );
    }
    let (status, body) = app
        .put(
            admin,
            &put,
            json!({
                "company_id":company, "document_type":"acuerdo_seguro", "format":"docx",
                "operator_values":{"saldo_confirmado":"1"}
            }),
        )
        .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    assert_eq!(error_code(&body), "VALIDATION_ERROR");

    let (status, error) = app
        .put(
            admin,
            &put,
            json!({
                "company_id":company, "document_type":"autorizacion_desembolso", "format":"docx",
                "operator_values":{"distribucion_desembolso":" \n "}
            }),
        )
        .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{error}");
    assert_eq!(error_code(&error), "VALIDATION_ERROR");
    assert!(
        error["error"]["message"]
            .as_str()
            .unwrap()
            .contains("Distribución del desembolso")
    );

    let mut body = selected_body;
    body["contract_id"] = json!(first);
    let (a, b) = tokio::join!(
        app.put(admin, &put, body.clone()),
        app.put(admin, &put, body.clone())
    );
    let (created, replayed) = if a.0 == StatusCode::CREATED {
        (a, b)
    } else {
        (b, a)
    };
    assert_eq!(created.0, StatusCode::CREATED, "{}", created.1);
    assert_eq!(replayed.0, StatusCode::OK, "{}", replayed.1);
    assert_eq!(created.1, replayed.1);
    assert_eq!(created.1["contract_id"], json!(first));
    let mut changed = body.clone();
    changed["operator_values"]["saldo_confirmado"] = json!("1405,25"); // Same normalized value; different request.
    let (status, conflict) = app.put(admin, &put, changed).await;
    assert_eq!(status, StatusCode::CONFLICT, "{conflict}");
    assert_eq!(error_code(&conflict), "GENERATED_DOCUMENT_CONFLICT");
    let docx_bytes = download(&app, admin, id, DOCX_MIME).await;
    assert_eq!(
        canonical(&word_xml(&docx_bytes)),
        canonical(&fixture.expected_xml)
    );

    Mock::given(method("POST"))
        .and(path("/v1/render/pdf"))
        .and(match_header("content-type", DOCX_MIME))
        .and(match_header("x-internal-api-key", EXTRACTOR_KEY))
        .respond_with(ResponseTemplate::new(200).set_body_raw(PDF_BYTES, PDF_MIME))
        .expect(1)
        .mount(&app.extractor)
        .await;
    let pdf_id = Uuid::new_v4();
    body["format"] = json!("pdf");
    body["operator_values"]["saldo_confirmado"] = json!("1405,25");
    body["contract_id"] = json!(second);
    let (status, saved) = app.put(admin, &url(operation, pdf_id), body.clone()).await;
    assert_eq!(status, StatusCode::CREATED, "{saved}");
    assert_eq!(saved["format"], "pdf");
    assert_eq!(download(&app, admin, pdf_id, PDF_MIME).await, PDF_BYTES);
    assert_eq!(
        app.put(admin, &url(operation, pdf_id), body).await,
        (StatusCode::OK, saved)
    );
    let requests = app.extractor.received_requests().await.unwrap();
    assert_eq!(requests.len(), 1);
    assert_eq!(
        canonical(&word_xml(&requests[0].body)),
        canonical(&fixture.expected_xml)
    );
}

#[tokio::test]
async fn operator_text_is_limited_to_one_thousand_characters_after_trimming() {
    let data = fixture();
    let app = TestApp::start().await;
    let admin = app.superadmin().await;
    let (company, operation) = seed_case(&app, admin, &data).await;
    let template = data
        .cases
        .iter()
        .find(|case| case.kind == "autorizacion_desembolso")
        .unwrap();
    add_template(&app, admin, company, template).await;
    let document = Uuid::new_v4();
    let request = |distribution: String| {
        json!({
            "company_id": company, "document_type": template.kind, "format": "docx",
            "operator_values": { "distribucion_desembolso": distribution },
        })
    };
    let (status, error) = app
        .put(admin, &url(operation, document), request("á".repeat(1001)))
        .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{error}");
    assert_eq!(error_code(&error), "VALIDATION_ERROR");
    assert_eq!(
        error["error"]["message"],
        "El valor de «Distribución del desembolso» supera el máximo de 1000 caracteres."
    );

    let distribution = "á".repeat(1000);
    let (status, saved) = app
        .put(
            admin,
            &url(operation, document),
            request(format!(" {distribution} ")),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{saved}");
    let xml = word_xml(&download(&app, admin, document, DOCX_MIME).await);
    assert!(xml.contains(&distribution));
}

#[tokio::test]
async fn regenerating_a_compatible_template_replaces_only_the_same_document_type() {
    let mut data = fixture();
    let app = TestApp::start().await;
    let admin = app.superadmin().await;
    let (company, operation) = seed_case(&app, admin, &data).await;
    let template = data
        .cases
        .iter_mut()
        .find(|case| case.kind == "entrega_documentos")
        .unwrap();
    template.label = "Modelo compartido de prueba".into();
    let contract = add_template(&app, admin, company, template).await;
    let original_receipt = Uuid::new_v4();
    let vehicle_receipt = Uuid::new_v4();
    let replacement_receipt = Uuid::new_v4();
    for (kind, document) in [
        ("entrega_documentos", original_receipt),
        ("entrega_vehiculo", vehicle_receipt),
        ("entrega_documentos", replacement_receipt),
    ] {
        let (status, saved) = app.put(admin, &url(operation, document), json!({
            "company_id": company, "document_type": kind, "format": "docx", "contract_id": contract,
        })).await;
        assert_eq!(status, StatusCode::CREATED, "{saved}");
    }
    for document in [vehicle_receipt, replacement_receipt] {
        let artifact = download(&app, admin, document, DOCX_MIME).await;
        assert!(!artifact.is_empty());
    }
    let (status, history) = app
        .get(
            admin,
            &format!("/api/v1/generated-documents?operation_id={operation}"),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{history}");
    assert_eq!(history["total"], 2);
    assert_eq!(
        app.get(
            admin,
            &format!("/api/v1/generated-documents/{original_receipt}")
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
}
