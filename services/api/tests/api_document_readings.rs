#![recursion_limit = "256"]

mod common;

use axum::{
    body::Body,
    http::{Method, Request, StatusCode, header},
};
use common::{OPENROUTER_KEY, OPENROUTER_MODEL, TestApp, TestUser, error_code, token_for};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use tower::ServiceExt;
use wiremock::{
    Mock, ResponseTemplate,
    matchers::{body_partial_json, header as match_header, method, path},
};

const ROUTE: &str = "/api/v1/document-readings";
const COMPLETIONS: &str = "/openrouter/chat/completions";
const PNG: &[u8] = b"\x89PNG\r\n\x1a\nsynthetic-image";
const BOUNDARY: &str = "test-reading-boundary";

struct Part<'a> {
    name: &'a str,
    file: Option<(&'a str, &'a str)>,
    bytes: &'a [u8],
}

fn text(name: &'static str, value: &'static str) -> Part<'static> {
    Part {
        name,
        file: None,
        bytes: value.as_bytes(),
    }
}

fn file<'a>(mime: &'a str, bytes: &'a [u8]) -> Part<'a> {
    Part {
        name: "file",
        file: Some(("cedula.png", mime)),
        bytes,
    }
}

async fn send(app: &TestApp, user: TestUser, parts: &[Part<'_>]) -> (StatusCode, Value) {
    let mut body = Vec::new();
    for part in parts {
        body.extend_from_slice(format!("--{BOUNDARY}\r\n").as_bytes());
        match part.file {
            Some((name, mime)) => body.extend_from_slice(
                format!(
                    "Content-Disposition: form-data; name=\"{}\"; filename=\"{name}\"\r\nContent-Type: {mime}\r\n\r\n",
                    part.name
                )
                .as_bytes(),
            ),
            None => body.extend_from_slice(
                format!("Content-Disposition: form-data; name=\"{}\"\r\n\r\n", part.name)
                    .as_bytes(),
            ),
        }
        body.extend_from_slice(part.bytes);
        body.extend_from_slice(b"\r\n");
    }
    body.extend_from_slice(format!("--{BOUNDARY}--\r\n").as_bytes());
    let request = Request::builder()
        .method(Method::POST)
        .uri(ROUTE)
        .header(
            header::AUTHORIZATION,
            format!("Bearer {}", token_for(user.id)),
        )
        .header(
            header::CONTENT_TYPE,
            format!("multipart/form-data; boundary={BOUNDARY}"),
        )
        .body(Body::from(body))
        .expect("request");
    let response = app.router.clone().oneshot(request).await.expect("response");
    let status = response.status();
    let bytes = response
        .into_body()
        .collect()
        .await
        .expect("body")
        .to_bytes();
    (
        status,
        serde_json::from_slice(&bytes).expect("JSON response"),
    )
}

fn completion(content: Value) -> ResponseTemplate {
    ResponseTemplate::new(200).set_body_json(json!({
        "id": "gen-synthetic",
        "choices": [{
            "finish_reason": "stop",
            "message": { "role": "assistant", "content": content.to_string() },
        }],
    }))
}

fn synthetic_id_card() -> Value {
    json!({
        "matches_category": true,
        "warnings": [],
        "data": {
            "card_version": "current",
            "id_number": "00100000017",
            "given_names": "PERSONA",
            "surnames": "SINTETICA PRUEBA",
            "full_name": "PERSONA SINTETICA PRUEBA",
            "birth_date": "1990-01-31",
            "birth_place": "SANTO DOMINGO, D.N.",
            "nationality": "DOMINICANA",
            "sex": "M",
            "blood_type": "O+",
            "marital_status": "SOLTERO",
            "occupation": "EMPLEADO",
            "expiration_date": "16 ABRIL 2040",
            "card_serial": "000000"
        }
    })
}

#[tokio::test]
async fn reads_an_id_card_with_a_strict_schema_and_checks_it() {
    let app = TestApp::start().await;
    let user = app.superadmin().await;
    Mock::given(method("POST"))
        .and(path(COMPLETIONS))
        .and(match_header(
            "authorization",
            format!("Bearer {OPENROUTER_KEY}").as_str(),
        ))
        .and(body_partial_json(json!({
            "model": OPENROUTER_MODEL,
            "response_format": {
                "type": "json_schema",
                "json_schema": { "name": "dominican_id_card", "strict": true },
            },
            "provider": { "require_parameters": true, "data_collection": "deny" },
        })))
        .respond_with(completion(synthetic_id_card()))
        .expect(1)
        .mount(&app.extractor)
        .await;

    let (status, body) = send(
        &app,
        user,
        &[
            text("category", "dominican_id_card"),
            file("image/png", PNG),
        ],
    )
    .await;

    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["category"], "dominican_id_card");
    assert_eq!(body["model"], OPENROUTER_MODEL);
    assert_eq!(body["matches_category"], true);
    // Normalized to the printed format; the check digit is valid.
    assert_eq!(body["data"]["id_number"], "001-0000001-7");
    let warnings = body["warnings"].as_array().unwrap();
    assert_eq!(warnings.len(), 1, "{warnings:?}");
    assert!(warnings[0].as_str().unwrap().starts_with("expiration_date"));
}

#[tokio::test]
async fn flags_a_cedula_whose_check_digit_does_not_match() {
    let app = TestApp::start().await;
    let user = app.superadmin().await;
    let mut reading = synthetic_id_card();
    reading["data"]["id_number"] = json!("001-0000001-8");
    reading["data"]["expiration_date"] = json!("2040-04-16");
    Mock::given(method("POST"))
        .and(path(COMPLETIONS))
        .respond_with(completion(reading))
        .mount(&app.extractor)
        .await;

    let (status, body) = send(
        &app,
        user,
        &[
            text("category", "dominican_id_card"),
            file("image/png", PNG),
        ],
    )
    .await;

    assert_eq!(status, StatusCode::OK, "{body}");
    assert!(
        body["warnings"][0]
            .as_str()
            .unwrap()
            .contains("dígito verificador")
    );
}

#[tokio::test]
async fn sends_pdfs_as_files_for_native_reading() {
    let app = TestApp::start().await;
    let user = app.superadmin().await;
    let reading = json!({
        "matches_category": true,
        "warnings": [],
        "data": {
            "carrier": "NAVIERA SINTETICA", "bill_of_lading_number": "BL0001", "booking_number": null,
            "issue_date": "2026-01-15", "scac_code": null,
            "shipper": {"name": "EMBARCADOR", "address": null, "tax_id": null, "email": null, "phone": null},
            "consignee": {"name": "CONSIGNATARIO", "address": null, "tax_id": "000000000", "email": null, "phone": null},
            "notify_party": {"name": null, "address": null, "tax_id": null, "email": null, "phone": null},
            "forwarding_agent": {"name": null, "address": null, "tax_id": null, "email": null, "phone": null},
            "vessel": null, "voyage": null, "flag": null, "place_of_receipt": null,
            "port_of_loading": null, "port_of_discharge": null, "place_of_delivery": null,
            "country_of_origin": null, "move_type": null, "freight_terms": "COLLECT",
            "itn_number": null, "container_numbers": ["ABCU0000000"], "marks_and_numbers": [],
            "cargo": [{
                "packages": "1 AUTO", "description": "VEHICULO", "hazardous": true, "un_number": "UN3166",
                "gross_weight": "3000", "weight_unit": "LB", "volume": null, "volume_unit": null,
                "vehicle": {"year": "2020", "make": "MARCA", "model": "MODELO", "color": null, "engine": null, "vin": "SHORTVIN"}
            }]
        }
    });
    Mock::given(method("POST"))
        .and(path(COMPLETIONS))
        .and(body_partial_json(json!({
            "plugins": [{ "id": "file-parser", "pdf": { "engine": "native" } }],
        })))
        .respond_with(completion(reading))
        .expect(1)
        .mount(&app.extractor)
        .await;

    let (status, body) = send(
        &app,
        user,
        &[
            text("category", "bill_of_lading"),
            Part {
                name: "file",
                file: Some(("bl.pdf", "application/pdf")),
                bytes: b"%PDF-1.7 synthetic",
            },
        ],
    )
    .await;

    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["data"]["cargo"][0]["vehicle"]["make"], "MARCA");
    assert!(body["warnings"][0].as_str().unwrap().contains("VIN"));
}

#[tokio::test]
async fn rejects_invalid_forms_before_calling_the_model() {
    let app = TestApp::start().await;
    let user = app.superadmin().await;
    Mock::given(method("POST"))
        .and(path(COMPLETIONS))
        .respond_with(completion(synthetic_id_card()))
        .expect(0)
        .mount(&app.extractor)
        .await;

    let (status, body) = send(
        &app,
        user,
        &[text("category", "passport"), file("image/png", PNG)],
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(error_code(&body), "VALIDATION_ERROR");

    let (status, _) = send(&app, user, &[text("category", "dominican_id_card")]).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);

    let (status, body) = send(
        &app,
        user,
        &[
            text("category", "dominican_id_card"),
            file("image/gif", b"GIF89a"),
        ],
    )
    .await;
    assert_eq!(status, StatusCode::UNSUPPORTED_MEDIA_TYPE);
    assert_eq!(error_code(&body), "UNSUPPORTED_FILE_TYPE");

    // Declared PNG, but the bytes are not.
    let (status, _) = send(
        &app,
        user,
        &[
            text("category", "dominican_id_card"),
            file("image/png", b"not an image"),
        ],
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
}

#[tokio::test]
async fn reports_model_failures_without_leaking_them() {
    let app = TestApp::start().await;
    let user = app.superadmin().await;
    let parts = [
        text("category", "vehicle_registration"),
        file("image/png", PNG),
    ];

    let mock = Mock::given(method("POST"))
        .and(path(COMPLETIONS))
        .respond_with(
            ResponseTemplate::new(402)
                .set_body_json(json!({"error": {"code": 402, "message": "Insufficient credits"}})),
        )
        .mount_as_scoped(&app.extractor)
        .await;
    let (status, body) = send(&app, user, &parts).await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(error_code(&body), "DOCUMENT_READER_UNAVAILABLE");
    drop(mock);

    // Output that ignores the schema is not passed through.
    let _mock = Mock::given(method("POST"))
        .and(path(COMPLETIONS))
        .respond_with(completion(
            json!({"matches_category": true, "warnings": [], "data": {"plate": "X"}}),
        ))
        .mount_as_scoped(&app.extractor)
        .await;
    let (status, body) = send(&app, user, &parts).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(error_code(&body), "DOCUMENT_UNREADABLE");
}

#[tokio::test]
async fn requires_authentication() {
    let app = TestApp::start().await;
    let request = Request::builder()
        .method(Method::POST)
        .uri(ROUTE)
        .body(Body::empty())
        .expect("request");
    let response = app.router.clone().oneshot(request).await.expect("response");
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}
