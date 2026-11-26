mod common;

use axum::http::{Method, StatusCode};
use chrono::{DateTime, Duration, Months, NaiveDate, Utc};
use common::{TestApp, TestUser, error_code};
use serde_json::{Value, json};
use uuid::Uuid;

const CLIENTS: &str = "/api/v1/clients";
const CASES: &str = "/api/v1/expedientes";

fn cases_for(company: Uuid) -> String {
    format!("{CASES}?company_id={company}")
}

fn operation_detail(company: Uuid, client: &str, operation: &str) -> String {
    format!("/api/v1/companies/{company}/clients/{client}/operations/{operation}")
}

async fn add_client(app: &TestApp, actor: TestUser, name: &str) -> Value {
    let (status, body) = app
        .post(
            actor,
            CLIENTS,
            json!({"name": name, "phone": "809-555-0100"}),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    body
}

async fn set_scope(app: &TestApp, actor: TestUser, contract: &Value, scope: Value) {
    let uri = format!("/api/v1/contracts/{}", contract["id"].as_str().unwrap());
    let (status, body) = app.patch(actor, &uri, scope).await;
    assert_eq!(status, StatusCode::OK, "{body}");
}

#[tokio::test]
async fn case_references_are_reserved_by_company_and_stable_under_concurrent_creation() {
    let app = TestApp::start().await;
    let admin = app.superadmin().await;
    let company = app.legacy_company(admin, "Álamos del Norte S.R.L.").await;
    let another = app.legacy_company(admin, "Árboles del Noreste SRL").await;
    let client = add_client(&app, admin, "Cliente sintético").await;
    let client_id = client["id"].as_str().unwrap();
    let collection = format!("{CLIENTS}/{client_id}/operations");

    let (status, historical) = app
        .post(
            admin,
            &collection,
            json!({"company_id": company, "vehicle": {}, "reference": "an-0001"}),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{historical}");

    let (first, second, third) = tokio::join!(
        app.post(
            admin,
            &collection,
            json!({"company_id": company, "vehicle": {}})
        ),
        app.post(
            admin,
            &collection,
            json!({"company_id": company, "vehicle": {}, "reference": " "})
        ),
        app.post(
            admin,
            &collection,
            json!({"company_id": company, "vehicle": {}})
        )
    );
    let mut references = Vec::new();
    for (status, case) in [&first, &second, &third] {
        assert_eq!(*status, StatusCode::CREATED, "{case}");
        references.push(case["reference"].as_str().unwrap());
        assert!(case.get("reference_generated").is_none());
    }
    references.sort_unstable();
    assert_eq!(references, ["AN-0002", "AN-0003", "AN-0004"]);

    let (status, collision) = app
        .post(
            admin,
            &collection,
            json!({"company_id": another, "vehicle": {}}),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{collision}");
    assert_eq!(collision["reference"], "AN2-0001");

    let generated = &first.1;
    let detail = operation_detail(company, client_id, generated["id"].as_str().unwrap());
    let (status, error) = app
        .patch(
            admin,
            &detail,
            json!({"reference": "Referencia reemplazada"}),
        )
        .await;
    assert_eq!(status, StatusCode::CONFLICT, "{error}");
    assert_eq!(error_code(&error), "CASE_REFERENCE_CONFLICT");
    let (status, error) = app
        .post(
            admin,
            &collection,
            json!({"company_id": another, "vehicle": {}, "reference": generated["reference"].as_str().unwrap().to_lowercase()}),
        )
        .await;
    assert_eq!(status, StatusCode::CONFLICT, "{error}");
    assert_eq!(error_code(&error), "CASE_REFERENCE_CONFLICT");

    let historical_detail =
        operation_detail(company, client_id, historical["id"].as_str().unwrap());
    assert_eq!(
        app.get(admin, &historical_detail).await.1["reference"],
        "an-0001"
    );
    let (status, corrected) = app
        .patch(
            admin,
            &historical_detail,
            json!({"reference": "Histórico corregido"}),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{corrected}");
    assert_eq!(corrected["reference"], "Histórico corregido");

    sqlx::query("UPDATE yzy_contracts.companies SET name = 'Nueva razón social' WHERE id = $1")
        .bind(company)
        .execute(&app.admin)
        .await
        .unwrap();
    let (status, renamed) = app
        .post(
            admin,
            &collection,
            json!({"company_id": company, "vehicle": {}}),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{renamed}");
    assert_eq!(renamed["reference"], "AN-0005");
}

#[tokio::test]
async fn client_profile_round_trips_without_exposing_contacts_in_lists_or_history() {
    let app = TestApp::start().await;
    let admin = app.superadmin().await;
    let minimal = add_client(&app, admin, "Cliente sin referencias").await;
    assert!(minimal.get("profile").is_none());
    let profile = json!({
        "treatment": "  Señor ", "nationality": "Dominicana", "marital_status": "Soltero",
        "owns_home": false,
        "employer": "  Lugar sintético ",
        "spouse": {"name":"Cónyuge sintético","work_phone":"809-555-0101"},
        "family_references": [{"name":"Familiar A"},{"name":"Familiar B"},{"name":"Familiar C"}],
        "personal_references": [{"name":"Referencia A"},{"name":"Referencia B"}]
    });
    let (status, saved) = app
        .post(
            admin,
            CLIENTS,
            json!({"name":"Cliente con referencias", "profile":profile}),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{saved}");
    assert_eq!(saved["profile"]["owns_home"], false);
    assert_eq!(saved["profile"]["employer"], "LUGAR SINTÉTICO");
    assert_eq!(saved["profile"]["treatment"], "SEÑOR");
    assert_eq!(saved["profile"]["nationality"], "DOMINICANA");
    assert_eq!(saved["profile"]["marital_status"], "SOLTERO");
    assert_eq!(
        saved["profile"]["family_references"]
            .as_array()
            .unwrap()
            .len(),
        3
    );
    let uri = format!("{CLIENTS}/{}", saved["id"].as_str().unwrap());
    assert_eq!(app.get(admin, &uri).await.1["profile"], saved["profile"]);
    let (status, list) = app.get(admin, CLIENTS).await;
    assert_eq!(status, StatusCode::OK, "{list}");
    assert!(
        list["items"]
            .as_array()
            .unwrap()
            .iter()
            .all(|client| client.get("profile").is_none())
    );

    let excessive = json!({"profile":{"personal_references":[{},{},{}]}});
    assert_eq!(
        app.patch(admin, &uri, excessive).await.0,
        StatusCode::UNPROCESSABLE_ENTITY
    );
    let (status, edited) = app
        .patch(
            admin,
            &uri,
            json!({"profile":{"spouse":{"name":"Otro contacto sintético"}}}),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{edited}");
    assert_eq!(
        edited["profile"]["spouse"]["name"],
        "OTRO CONTACTO SINTÉTICO"
    );
    let (_, timeline) = app.get(admin, &format!("{uri}/timeline")).await;
    assert!(
        timeline
            .to_string()
            .contains("Datos complementarios del cliente")
    );
    assert!(!timeline.to_string().contains("OTRO CONTACTO SINTÉTICO"));
    let (status, cleared) = app.patch(admin, &uri, json!({"profile":null})).await;
    assert_eq!(status, StatusCode::OK, "{cleared}");
    assert!(cleared.get("profile").is_none());
}

#[tokio::test]
async fn case_directory_lists_each_purchase_and_searches_across_clients_and_vehicles() {
    let app = TestApp::start().await;
    let admin = app.superadmin().await;
    let member = app.pending_user().await;
    let company = app.legacy_company(admin, "Financiera sintética").await;
    let archived = app.legacy_company(admin, "Financiera histórica").await;
    let (status, client) = app
        .post(
            admin,
            CLIENTS,
            json!({"name": "Inés de prueba", "identity": "000-0000001-1"}),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{client}");
    let another = add_client(&app, admin, "Cliente de prueba").await;

    let mut ids = Vec::new();
    for (client, company, reference, vehicle) in [
        (
            &client,
            company,
            Some("Compra número uno"),
            json!({"make": "Honda", "model": "Civic"}),
        ),
        (
            &client,
            archived,
            Some("Compra número dos"),
            json!({"make": "Toyota", "model": "Corolla"}),
        ),
        (&another, company, None, json!({})),
    ] {
        let client_id = client["id"].as_str().unwrap();
        let (status, case) = app
            .post(
                admin,
                &format!("{CLIENTS}/{client_id}/operations"),
                json!({"company_id": company, "reference": reference, "vehicle": vehicle}),
            )
            .await;
        assert_eq!(status, StatusCode::CREATED, "{case}");
        ids.push(case["id"].clone());
    }
    sqlx::query("UPDATE yzy_contracts.companies SET archived_at = now() WHERE id = $1")
        .bind(archived)
        .execute(&app.admin)
        .await
        .unwrap();
    sqlx::query("UPDATE yzy_contracts.client_operations SET created_at = '2026-01-01 00:00:00Z'")
        .execute(&app.admin)
        .await
        .unwrap();

    let detail = format!("{CASES}/{}", ids[1].as_str().unwrap());
    let active_cases = cases_for(company);
    let archived_cases = cases_for(archived);
    for path in [active_cases.as_str(), &detail] {
        assert_eq!(
            app.request(Method::GET, path, None, None).await.0,
            StatusCode::UNAUTHORIZED
        );
        let (status, body) = app.get(member, path).await;
        assert_eq!(status, StatusCode::FORBIDDEN, "{body}");
        assert_eq!(error_code(&body), "ACCESS_PENDING");
    }
    assert_eq!(
        app.put(
            admin,
            &format!("/api/v1/admin/users/{}/access", member.id),
            json!({"enabled": true})
        )
        .await
        .0,
        StatusCode::OK
    );

    assert_eq!(
        app.get(member, CASES).await.0,
        StatusCode::UNPROCESSABLE_ENTITY
    );

    let (status, result) = app.get(member, &active_cases).await;
    assert_eq!(status, StatusCode::OK, "{result}");
    assert_eq!(result["total"], 2);
    assert_eq!(result["page"], 1);
    assert_eq!(result["per_page"], 20);
    assert_eq!(
        result["items"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|item| item["client_id"] == client["id"])
            .count(),
        1
    );
    assert!(
        result["items"]
            .as_array()
            .unwrap()
            .iter()
            .all(|item| item["company_id"] == json!(company))
    );

    // Members never list case files of an archived company.
    let (status, archived_page) = app.get(member, &archived_cases).await;
    assert_eq!(status, StatusCode::NOT_FOUND, "{archived_page}");
    assert_eq!(error_code(&archived_page), "COMPANY_NOT_FOUND");
    assert!(!archived_page.to_string().contains("Financiera histórica"));
    assert!(!archived_page.to_string().contains("Compra número dos"));

    let mut expected: Vec<_> = ids.iter().filter(|&id| *id != ids[1]).cloned().collect();
    expected.sort_by(|left, right| right.as_str().cmp(&left.as_str()));
    for (index, id) in expected.iter().enumerate() {
        let page = index + 1;
        let (status, result) = app
            .get(member, &format!("{active_cases}&page={page}&per_page=1"))
            .await;
        assert_eq!(status, StatusCode::OK, "{result}");
        assert_eq!(result["page"], page);
        assert_eq!(result["total"], 2);
        assert_eq!(result["items"].as_array().unwrap().len(), 1);
        assert_eq!(result["items"][0]["id"], *id);
    }
    for (query, total) in [
        ("ines", 1),
        ("00000000011", 1),
        ("honda%20civic", 1),
        ("numero%20dos", 0),
        ("sin%20coincidencias", 0),
        ("---", 0),
    ] {
        let (status, result) = app.get(member, &format!("{active_cases}&q={query}")).await;
        assert_eq!(status, StatusCode::OK, "{result}");
        assert_eq!(result["total"], total, "{query}: {result}");
    }
    let (status, searched) = app
        .get(member, &format!("{archived_cases}&q=numero%20dos"))
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND, "{searched}");
    assert_eq!(error_code(&searched), "COMPANY_NOT_FOUND");
    for query in ["per_page=101", "page=0", "q=%00"] {
        assert_eq!(
            app.get(member, &format!("{active_cases}&{query}")).await.0,
            StatusCode::UNPROCESSABLE_ENTITY
        );
    }

    // Members never read a case file of an archived company, even by its UUID.
    let (status, hidden) = app.get(member, &detail).await;
    assert_eq!(status, StatusCode::NOT_FOUND, "{hidden}");
    assert_eq!(error_code(&hidden), "CLIENT_OPERATION_NOT_FOUND");
    assert!(!hidden.to_string().to_lowercase().contains("corolla"));
    assert!(!hidden.to_string().contains("Compra número dos"));

    let (status, case) = app.get(admin, &detail).await;
    assert_eq!(status, StatusCode::OK, "{case}");
    assert_eq!(case["id"], ids[1]);
    assert_eq!(case["client_id"], client["id"]);
    assert_eq!(case["company_id"], json!(archived));
    assert_eq!(case["vehicle"]["model"], "COROLLA");
    assert_eq!(
        app.get(member, &format!("{CASES}/{}", Uuid::new_v4()))
            .await
            .0,
        StatusCode::NOT_FOUND
    );
}

#[tokio::test]
async fn case_directory_filters_by_status_within_the_company() {
    let app = TestApp::start().await;
    let admin = app.superadmin().await;
    let company = app.legacy_company(admin, "Financiera de estados").await;
    let other = app.legacy_company(admin, "Financiera de control").await;
    let client = add_client(&app, admin, "Cliente de estados").await;
    let client_id = client["id"].as_str().unwrap();
    let mut firma_ids = Vec::new();
    for (company_id, reference, status) in [
        (company, "ESTADO-1", "solicitud"),
        (company, "ESTADO-2", "firma"),
        (company, "ESTADO-3", "firma"),
        (company, "ESTADO-4", "desembolso"),
        (other, "ESTADO-5", "firma"),
    ] {
        let (code, case) = app
            .post(
                admin,
                &format!("{CLIENTS}/{client_id}/operations"),
                json!({
                    "company_id": company_id,
                    "reference": reference,
                    "status": status,
                    "vehicle": {"make": "Honda", "model": "Civic"},
                }),
            )
            .await;
        assert_eq!(code, StatusCode::CREATED, "{case}");
        if company_id == company && status == "firma" {
            firma_ids.push(case["id"].as_str().unwrap().to_owned());
        }
    }

    let (status, all) = app.get(admin, &cases_for(company)).await;
    assert_eq!(status, StatusCode::OK, "{all}");
    assert_eq!(all["total"], 4);

    for (value, total) in [
        ("solicitud", 1),
        ("en_proceso", 0),
        ("firma", 2),
        ("desembolso", 1),
        ("cerrado", 0),
    ] {
        let (status, page) = app
            .get(admin, &format!("{}&status={value}", cases_for(company)))
            .await;
        assert_eq!(status, StatusCode::OK, "{page}");
        assert_eq!(page["total"], total, "{value}: {page}");
        assert!(
            page["items"]
                .as_array()
                .unwrap()
                .iter()
                .all(|item| item["status"] == value && item["company_id"] == json!(company))
        );
    }

    let (status, firma) = app
        .get(admin, &format!("{}&status=firma", cases_for(company)))
        .await;
    assert_eq!(status, StatusCode::OK, "{firma}");
    let mut listed: Vec<String> = firma["items"]
        .as_array()
        .unwrap()
        .iter()
        .map(|item| item["id"].as_str().unwrap().to_owned())
        .collect();
    listed.sort();
    firma_ids.sort();
    assert_eq!(listed, firma_ids);

    let (status, paged) = app
        .get(
            admin,
            &format!("{}&status=firma&per_page=1&page=2", cases_for(company)),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{paged}");
    assert_eq!(paged["total"], 2);
    assert_eq!(paged["items"].as_array().unwrap().len(), 1);

    let (status, searched) = app
        .get(
            admin,
            &format!("{}&status=firma&q=estado-2", cases_for(company)),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{searched}");
    assert_eq!(searched["total"], 1);
    assert_eq!(searched["items"][0]["reference"], "ESTADO-2");

    let (status, unknown) = app
        .get(admin, &format!("{}&status=desconocido", cases_for(company)))
        .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{unknown}");
    assert_eq!(error_code(&unknown), "VALIDATION_ERROR");
}

// Pending decision (Randy): whether an empty `status=` should mean "all statuses".
// Until decided, it is rejected as a validation error.
#[tokio::test]
async fn case_directory_rejects_an_empty_status_filter_as_validation_error() {
    let app = TestApp::start().await;
    let admin = app.superadmin().await;
    let company = app
        .legacy_company(admin, "Financiera de filtro vacío")
        .await;

    let (status, empty) = app
        .get(admin, &format!("{}&status=", cases_for(company)))
        .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{empty}");
    assert_eq!(error_code(&empty), "VALIDATION_ERROR");
}

#[tokio::test]
async fn case_application_is_saved_and_editable_without_copying_contacts_to_history() {
    let app = TestApp::start().await;
    let owner = app.superadmin().await;
    let company = app.legacy_company(owner, "Empresa sintética").await;
    let client = add_client(&app, owner, "Cliente sintético").await;
    let client_id = client["id"].as_str().unwrap();
    let (status, saved) = app
        .post(
            owner,
            &format!("{CLIENTS}/{client_id}/operations"),
            json!({"company_id": company, "vehicle": {}, "application": {
                "application_date": "2026-11-13", "owns_home": false, "requested_amount_minor": 150000,
                "spouse": {"name": "Persona de prueba"},
                "family_references": [{"name": "Referencia de prueba"}]
            }}),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{saved}");
    assert_eq!(saved["application"]["application_date"], "2026-11-13");
    assert!(saved["contract_date"].is_null());
    assert!(saved["financing"].is_null());
    assert_eq!(saved["application"]["owns_home"], false);
    assert_eq!(saved["application"]["requested_amount_minor"], 150000);
    let id = saved["id"].as_str().unwrap();
    let route = operation_detail(company, client_id, id);
    assert_eq!(
        app.get(owner, &route).await.1["application"],
        saved["application"]
    );
    let (status, _) = app
        .patch(
            owner,
            &route,
            json!({"application": {
                "family_references": [{}, {}, {}, {}]
            }}),
        )
        .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    let (status, updated) = app.patch(owner, &route, json!({"application": null})).await;
    assert_eq!(status, StatusCode::OK, "{updated}");
    assert!(updated["application"].is_null());
    let timeline = app
        .get(
            owner,
            &format!("{CLIENTS}/{client_id}/timeline?operation_id={id}"),
        )
        .await
        .1;
    assert_eq!(timeline["items"][0]["changes"][0]["field"], "application");
    assert!(!timeline.to_string().contains("Persona de prueba"));
}

#[tokio::test]
async fn client_timeline_paginates_milestones_across_companies() {
    let app = TestApp::start().await;
    let owner = app.superadmin().await;
    let outsider = app.user().await;
    let company = app.legacy_company(owner, "Empresa del historial").await;
    let other_company = app.legacy_company(outsider, "Otra empresa").await;

    let client = add_client(&app, owner, "Expediente sintético").await;
    let other_client = add_client(&app, owner, "Otro expediente sintético").await;
    let client_id = serde_json::from_value::<Uuid>(client["id"].clone()).unwrap();
    let other_client_id = other_client["id"].as_str().unwrap();
    let timeline = format!("{CLIENTS}/{client_id}/timeline");
    let contract = app.create_contract(owner, "Contrato sintético").await;
    let contract_id = serde_json::from_value::<Uuid>(contract["id"].clone()).unwrap();
    set_scope(
        &app,
        owner,
        &contract,
        json!({"shared_company_ids": [company, other_company]}),
    )
    .await;

    let (_, initial) = app.get(owner, &timeline).await;
    assert_eq!(initial["total"], 1);
    assert_eq!(initial["items"][0]["kind"], "client_created");
    assert_eq!(
        initial["items"][0]["actor_name"],
        common::test_email(owner.id)
    );
    assert_eq!(initial["items"][0]["changes"], json!([]));
    let (status, operation) = app
        .post(
            owner,
            &format!("{CLIENTS}/{client_id}/operations"),
            json!({
                "company_id": company,
                "contract_id": contract_id,
                "vehicle": { "make": "Marca", "model": "Modelo", "plate": "SINT-001" }
            }),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{operation}");
    let operation_id = serde_json::from_value::<Uuid>(operation["id"].clone()).unwrap();
    let (status, second_operation) = app
        .post(
            owner,
            &format!("{CLIENTS}/{client_id}/operations"),
            json!({
                "company_id": other_company,
                "contract_id": contract_id,
                "reference": "REF-OTRA-EMPRESA",
                "vehicle": {}
            }),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{second_operation}");
    let second_operation_id =
        serde_json::from_value::<Uuid>(second_operation["id"].clone()).unwrap();
    let (status, listed) = app
        .get(owner, &format!("{CLIENTS}/{client_id}/operations"))
        .await;
    assert_eq!(status, StatusCode::OK, "{listed}");
    let listed = listed.as_array().unwrap();
    assert_eq!(listed.len(), 2);
    assert!(listed.contains(&operation));
    assert!(listed.contains(&second_operation));
    assert_eq!(second_operation["client_id"], json!(client_id));
    assert_eq!(second_operation["company_id"], json!(other_company));

    let (status, other_operation) = app
        .post(
            owner,
            &format!("{CLIENTS}/{other_client_id}/operations"),
            json!({"company_id": company, "contract_id": contract_id, "vehicle": {}}),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{other_operation}");
    let other_operation_id = serde_json::from_value::<Uuid>(other_operation["id"].clone()).unwrap();

    // Model an expediente saved before the history table existed.
    sqlx::query("DELETE FROM yzy_contracts.client_case_history WHERE client_id = $1")
        .bind(client_id)
        .execute(&app.admin)
        .await
        .unwrap();
    sqlx::query(
        "UPDATE yzy_contracts.clients SET created_at = '2026-11-10 01:00:00Z',
            updated_at = '2026-11-10 02:00:00Z' WHERE id = $1",
    )
    .bind(client_id)
    .execute(&app.admin)
    .await
    .unwrap();
    sqlx::query(
        "UPDATE yzy_contracts.client_operations SET created_at = '2026-11-10 03:00:00Z',
            updated_at = '2026-11-10 04:00:00Z' WHERE id = $1",
    )
    .bind(operation_id)
    .execute(&app.admin)
    .await
    .unwrap();
    sqlx::query(
        "UPDATE yzy_contracts.client_operations
         SET created_at = '2026-11-10 03:30:00Z', updated_at = '2026-11-10 03:30:00Z'
         WHERE id = $1",
    )
    .bind(second_operation_id)
    .execute(&app.admin)
    .await
    .unwrap();

    let first_document = Uuid::from_u128(1);
    let second_document = Uuid::from_u128(2);
    for (author, document, company_id, operation, name) in [
        (
            owner,
            first_document,
            company,
            operation_id,
            "Carta sintética",
        ),
        (
            outsider,
            second_document,
            other_company,
            second_operation_id,
            "Acto sintético",
        ),
        (
            owner,
            Uuid::from_u128(3),
            company,
            other_operation_id,
            "Documento de otro expediente",
        ),
    ] {
        sqlx::query(
            "INSERT INTO yzy_contracts.generated_documents
                (owner_id, id, operation_id, operation_company_id, company, contract_id, contract_name,
                 format, filename, markdown, imported_from_session, artifact, created_at)
             VALUES ($1, $2, $3, $4, jsonb_build_object('id', $4::text), $5, $6,
                     'pdf', 'sintetico.pdf', '', false, $7, '2026-11-10 04:00:00Z')",
        )
        .bind(author.id)
        .bind(document)
        .bind(operation)
        .bind(company_id)
        .bind(contract_id)
        .bind(name)
        .bind(common::PDF_BYTES)
        .execute(&app.admin)
        .await
        .unwrap();
    }

    let (status, full) = app.get(owner, &timeline).await;
    assert_eq!(status, StatusCode::OK, "{full}");
    assert_eq!(full["total"], 7);
    let events = full["items"].as_array().unwrap();
    let expected_kinds = [
        "document_generated",
        "document_generated",
        "operation_updated",
        "operation_created",
        "operation_created",
        "client_updated",
        "client_created",
    ];
    assert_eq!(
        events
            .iter()
            .map(|event| event["kind"].as_str().unwrap())
            .collect::<Vec<_>>(),
        expected_kinds
    );
    assert_eq!(
        events[0],
        json!({
            "id": second_document, "kind": "document_generated",
            "occurred_at": "2026-11-10T04:00:00Z", "operation_label": "REF-OTRA-EMPRESA",
            "document_name": "Acto sintético",
            "actor_name": common::test_email(outsider.id), "changes": []
        })
    );
    assert_eq!(events[1]["id"], json!(first_document));
    assert_eq!(events[3]["operation_label"], "REF-OTRA-EMPRESA");
    assert_eq!(events[5]["occurred_at"], "2026-11-10T02:00:00Z");
    assert!(events[5]["actor_name"].is_null());
    assert_eq!(events[5]["changes"], json!([]));
    let (status, page) = app
        .get(owner, &format!("{timeline}?page=2&per_page=1"))
        .await;
    assert_eq!(status, StatusCode::OK, "{page}");
    assert_eq!(
        page,
        json!({ "items": [events[1]], "total": 7, "page": 2, "per_page": 1 })
    );
    let (status, page) = app
        .get(owner, &format!("{timeline}?page=5&per_page=2"))
        .await;
    assert_eq!(status, StatusCode::OK, "{page}");
    assert_eq!(
        page,
        json!({ "items": [], "total": 7, "page": 5, "per_page": 2 })
    );

    let first_case = format!("{timeline}?operation_id={operation_id}&per_page=1");
    let (status, page) = app.get(owner, &first_case).await;
    assert_eq!(status, StatusCode::OK, "{page}");
    assert_eq!(
        page,
        json!({ "items": [events[1]], "total": 3, "page": 1, "per_page": 1 })
    );
    let (status, page) = app
        .get(
            owner,
            &format!("{timeline}?operation_id={second_operation_id}"),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{page}");
    assert_eq!(page["items"], json!([events[0], events[3]]));
    assert_eq!(page["total"], 2);

    let (status, body) = app
        .get(
            owner,
            &format!("{timeline}?operation_id={other_operation_id}"),
        )
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(error_code(&body), "CLIENT_OPERATION_NOT_FOUND");

    assert_eq!(app.get(outsider, &timeline).await.0, StatusCode::FORBIDDEN);
    assert_eq!(
        app.request(Method::GET, &timeline, None, None).await.0,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        app.get(owner, &format!("{timeline}?per_page=101")).await.0,
        StatusCode::UNPROCESSABLE_ENTITY
    );
}

#[tokio::test]
async fn client_timeline_records_the_superadmin_and_preserves_concurrent_edits() {
    let app = TestApp::start().await;
    let owner = app.superadmin().await;
    sqlx::query(
        "INSERT INTO yzy_contracts.access_identities (user_id, email, name) VALUES ($1, $2, $3)",
    )
    .bind(owner.id)
    .bind(common::test_email(owner.id))
    .bind("Rosa Prueba")
    .execute(&app.admin)
    .await
    .unwrap();
    let client = add_client(&app, owner, "Expediente sintético").await;
    let detail = format!("{CLIENTS}/{}", client["id"].as_str().unwrap());
    let timeline = format!("{detail}/timeline");

    // Concurrent writes to the same field must leave a single ordered value chain.
    let ((first_status, _), (second_status, _)) = tokio::join!(
        app.patch(owner, &detail, json!({"phone": "809-555-0101"})),
        app.patch(owner, &detail, json!({"phone": "809-555-0102"})),
    );
    assert_eq!(first_status, StatusCode::OK);
    assert_eq!(second_status, StatusCode::OK);
    let (status, saved) = app.patch(owner, &detail, json!({"phone": null})).await;
    assert_eq!(status, StatusCode::OK, "{saved}");
    let (status, unchanged) = app
        .patch(
            owner,
            &detail,
            json!({"phone": null, "name": " Expediente sintético "}),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{unchanged}");
    assert_eq!(unchanged["updated_at"], saved["updated_at"]);
    assert_eq!(
        app.patch(owner, &detail, json!({"name": " "})).await.0,
        StatusCode::UNPROCESSABLE_ENTITY
    );
    let (_, timeline_body) = app.get(owner, &timeline).await;
    let items = timeline_body["items"].as_array().unwrap();
    assert_eq!(items.len(), 4, "{timeline_body}");
    assert_eq!(items[0]["actor_name"], "Rosa Prueba");
    assert_eq!(items[0]["occurred_at"], saved["updated_at"]);
    assert_eq!(
        items[0]["changes"],
        json!([{"field": "phone", "before": items[1]["changes"][0]["after"], "after": null}])
    );
    assert_eq!(
        items[1]["changes"][0]["before"],
        items[2]["changes"][0]["after"]
    );
    assert_eq!(items[2]["changes"][0]["before"], "809-555-0100");
    assert!(
        items
            .iter()
            .all(|event| event["actor_name"] == "Rosa Prueba")
    );
    assert_eq!(items[3]["kind"], "client_created");

    // A failure writing the audit entry must discard the business update as well.
    sqlx::query(
        "ALTER TABLE yzy_contracts.client_case_history
         ADD CONSTRAINT test_reject_new_history CHECK (false) NOT VALID",
    )
    .execute(&app.admin)
    .await
    .unwrap();
    assert_eq!(
        app.patch(owner, &detail, json!({"phone": "809-555-0199"}))
            .await
            .0,
        StatusCode::INTERNAL_SERVER_ERROR
    );
    assert_eq!(app.get(owner, &detail).await.1, saved);
    assert_eq!(app.get(owner, &timeline).await.1, timeline_body);
}

#[tokio::test]
async fn operation_timeline_preserves_legacy_update_and_records_nested_changes() {
    let app = TestApp::start().await;
    let owner = app.superadmin().await;
    let company = app.legacy_company(owner, "Empresa de operaciones").await;
    let client = add_client(&app, owner, "Expediente sintético").await;
    let client_id = client["id"].as_str().unwrap();
    let detail = format!("{CLIENTS}/{client_id}");
    let operations = format!("{detail}/operations");
    let first = app.create_contract(owner, "Contrato de prueba uno").await;
    let second = app.create_contract(owner, "Contrato de prueba dos").await;
    set_scope(&app, owner, &first, json!({"company_id": company})).await;
    set_scope(&app, owner, &second, json!({"company_id": company})).await;

    let finance = json!({
        "interest_installments": [{"date": "2026-12-01", "amount_minor": 20000}],
        "final_principal": {"date": "2027-01-01", "amount_minor": 500000},
        "extraordinary_payments": [],
        "insurance_installment_count": 10
    });
    let (status, operation) = app
        .post(
            owner,
            &operations,
            json!({
                "company_id": company, "contract_id": first["id"], "reference": "REF-SINT",
                "vehicle": {"color": "Azul", "make": "Marca sintética"},
                "financing": finance
            }),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{operation}");
    let operation_id = serde_json::from_value::<Uuid>(operation["id"].clone()).unwrap();
    let operation_route = operation_detail(company, client_id, &operation_id.to_string());
    let timeline = format!("{detail}/timeline");
    let (_, created_history) = app.get(owner, &timeline).await;
    assert_eq!(created_history["items"][0]["kind"], "operation_created");
    assert_eq!(
        created_history["items"][0]["actor_name"],
        common::test_email(owner.id)
    );

    // Simulate an edit made by the previous release during the rollout.
    sqlx::query(
        "UPDATE yzy_contracts.client_operations
         SET created_at = '2026-11-10 01:00:00Z', updated_at = '2026-11-10 02:00:00Z'
         WHERE id = $1",
    )
    .bind(operation_id)
    .execute(&app.admin)
    .await
    .unwrap();
    let (status, saved) = app
        .patch(
            owner,
            &operation_route,
            json!({
                "contract_id": second["id"], "vehicle": {"color": "Verde"},
                "financing": null
            }),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{saved}");
    let (_, current) = app.get(owner, &timeline).await;
    let events = current["items"].as_array().unwrap();
    assert_eq!(events.len(), 4, "{current}");
    let changes = events[0]["changes"].as_array().unwrap();
    assert_eq!(changes.len(), 7);
    assert_eq!(changes[0]["field"], "contract_id");
    assert_eq!(
        changes[0]["before"],
        format!("Contrato de prueba uno · {}", first["id"].as_str().unwrap())
    );
    assert_eq!(
        changes[0]["after"],
        format!(
            "Contrato de prueba dos · {}",
            second["id"].as_str().unwrap()
        )
    );
    assert!(
        changes.contains(&json!({"field": "vehicle.color", "before": "AZUL", "after": "VERDE"}))
    );
    assert!(
        changes.contains(
            &json!({"field": "vehicle.make", "before": "MARCA SINTÉTICA", "after": null})
        )
    );
    assert!(changes.contains(&json!({
        "field": "financing.interest_installments", "before": finance["interest_installments"], "after": null
    })));
    assert_eq!(events[0]["occurred_at"], saved["updated_at"]);
    let legacy = events
        .iter()
        .find(|event| event["occurred_at"] == "2026-11-10T02:00:00Z")
        .unwrap();
    assert!(legacy["actor_name"].is_null());
    assert_eq!(legacy["changes"], json!([]));
    assert_eq!(legacy["operation_label"], "REF-SINT");
    assert_eq!(
        app.patch(
            owner,
            &operation_route,
            json!({"contract_id": Uuid::new_v4()})
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(app.get(owner, &timeline).await.1, current);
}

#[tokio::test]
async fn global_clients_are_searchable_editable_and_private() {
    let app = TestApp::start().await;
    let owner = app.superadmin().await;
    let stranger = app.user().await;
    let (status, saved) = app
        .post(
            owner,
            CLIENTS,
            json!({"name": "  Ágata Sintética  ", "identity": "abc-001", "phone": "809-555-0100"}),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{saved}");
    assert!(saved.get("company_id").is_none());
    let detail = format!("{CLIENTS}/{}", saved["id"].as_str().unwrap());
    let other = add_client(&app, owner, "Beatriz Sintética").await;
    let other_detail = format!("{CLIENTS}/{}", other["id"].as_str().unwrap());

    for (status, error) in [
        app.post(
            owner,
            CLIENTS,
            json!({"name": "Persona duplicada", "identity": "ABC 001"}),
        )
        .await,
        app.patch(owner, &other_detail, json!({"identity": "aBc 00-1"}))
            .await,
    ] {
        assert_eq!(status, StatusCode::CONFLICT, "{error}");
        assert_eq!(error["error"]["code"], "CLIENT_IDENTITY_CONFLICT");
    }

    let (status, page) = app.get(owner, &format!("{CLIENTS}?q=agata")).await;
    assert_eq!(status, StatusCode::OK, "{page}");
    assert_eq!(page["total"], 1);
    assert_eq!(page["items"][0]["name"], "ÁGATA SINTÉTICA");
    let (_, unpaginated) = app.get(owner, CLIENTS).await;
    let (_, page) = app
        .get(owner, &format!("{CLIENTS}?page=2&per_page=1"))
        .await;
    assert_eq!(page["total"], 2);
    assert_eq!(page["page"], 2);
    assert_eq!(page["per_page"], 1);
    assert_eq!(page["items"][0], unpaginated["items"][1]);

    let (status, updated) = app
        .patch(
            owner,
            &detail,
            json!({"phone": null, "address": "  Calle ficticia  "}),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{updated}");
    assert!(updated["phone"].is_null());
    assert_eq!(updated["identity"], saved["identity"]);
    assert_eq!(updated["address"], "CALLE FICTICIA");
    assert_eq!(app.get(owner, &detail).await.1, updated);
    assert_eq!(
        app.patch(owner, &detail, json!({"name": null})).await.0,
        StatusCode::UNPROCESSABLE_ENTITY
    );

    assert_eq!(app.get(stranger, CLIENTS).await.0, StatusCode::FORBIDDEN);
    assert_eq!(app.get(stranger, &detail).await.0, StatusCode::FORBIDDEN);
    assert_eq!(
        app.post(stranger, CLIENTS, json!({"name": "Persona ajena"}))
            .await
            .0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        app.patch(stranger, &detail, json!({"name": "Cambio ajeno"}))
            .await
            .0,
        StatusCode::FORBIDDEN
    );

    let private: bool = sqlx::query_scalar(
        "SELECT bool_and(relrowsecurity AND NOT has_table_privilege('anon', oid, 'SELECT')
          AND NOT has_table_privilege('authenticated', oid, 'SELECT')
          AND NOT has_table_privilege('service_role', oid, 'SELECT'))
         FROM pg_class
         WHERE oid IN ('yzy_contracts.clients'::regclass, 'yzy_contracts.client_operations'::regclass)",
    )
    .fetch_one(&app.admin)
    .await
    .unwrap();
    assert!(private);
}

#[tokio::test]
async fn operation_accepts_only_company_templates_and_preserves_validated_payment_data() {
    let app = TestApp::start().await;
    let owner = app.superadmin().await;
    let company = app.legacy_company(owner, "Empresa de expedientes").await;
    let other_company = app
        .legacy_company(owner, "Empresa ajena al expediente")
        .await;
    let client = add_client(&app, owner, "Cliente sintético").await;
    let other_client = add_client(&app, owner, "Segundo cliente sintético").await;
    let client_id = client["id"].as_str().unwrap();
    let collection = format!("{CLIENTS}/{client_id}/operations");
    assert_eq!(app.get(owner, &collection).await.1, json!([]));
    let sale = app.create_contract(owner, "Venta sintética").await;
    let mut input = json!({
        "company_id": company,
        "contract_id": sale["id"],
        "contract_date": "2026-01-12",
        "reference": "OPERACION-PRUEBA",
        "vehicle": {"registration_number": "REG-SINT", "year": "2024"},
        "financing": {
            "interest_installments": [{"date": "2026-02-28", "amount_minor": 100000}],
            "final_principal": {"date": "2027-01-31", "amount_minor": 3000000},
            "extraordinary_payments": [
                {"date": "2026-01-31", "amount_minor": 90000},
                {"date": "2026-05-31", "amount_minor": 110000},
                {"date": "2026-09-30", "amount_minor": 95000},
                {"date": "2027-01-31", "amount_minor": 130000}
            ],
            "insurance_installment_count": 10
        }
    });

    // An account-level template and a template for the wrong company are
    // both ineligible, even when the actor can read them.
    let (status, error) = app.post(owner, &collection, input.clone()).await;
    assert_eq!(status, StatusCode::NOT_FOUND, "{error}");
    assert_eq!(error["error"]["code"], "CONTRACT_NOT_FOUND");
    set_scope(&app, owner, &sale, json!({"company_id": other_company})).await;
    let (status, error) = app.post(owner, &collection, input.clone()).await;
    assert_eq!(status, StatusCode::NOT_FOUND, "{error}");
    assert_eq!(error["error"]["code"], "CONTRACT_NOT_FOUND");
    set_scope(
        &app,
        owner,
        &sale,
        json!({"shared_company_ids": [company, other_company]}),
    )
    .await;

    let valid = input.clone();
    let mut without_company = valid.clone();
    without_company
        .as_object_mut()
        .unwrap()
        .remove("company_id");
    assert_eq!(
        app.post(owner, &collection, without_company).await.0,
        StatusCode::UNPROCESSABLE_ENTITY
    );
    let archived = app.legacy_company(owner, "Empresa archivada").await;
    sqlx::query("UPDATE yzy_contracts.companies SET archived_at = now() WHERE id = $1")
        .bind(archived)
        .execute(&app.admin)
        .await
        .unwrap();
    for invalid_company in [Uuid::new_v4(), archived] {
        let mut invalid = valid.clone();
        invalid["company_id"] = json!(invalid_company);
        let (status, error) = app.post(owner, &collection, invalid).await;
        assert_eq!(status, StatusCode::NOT_FOUND, "{error}");
        assert_eq!(error["error"]["code"], "COMPANY_NOT_FOUND");
    }
    input["financing"]["extraordinary_payments"][3]["date"] = json!("2027-01-30");
    let (status, error) = app.post(owner, &collection, input).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{error}");
    let mut input = valid.clone();
    input["financing"]["final_principal"]["amount_minor"] = json!(9_007_199_254_740_991_i64);
    assert_eq!(
        app.post(owner, &collection, input).await.0,
        StatusCode::UNPROCESSABLE_ENTITY
    );
    let mut input = valid.clone();
    input["contract_date"] = json!("2026-1-12");
    assert_eq!(
        app.post(owner, &collection, input).await.0,
        StatusCode::UNPROCESSABLE_ENTITY
    );

    let (status, saved) = app.post(owner, &collection, valid.clone()).await;
    assert_eq!(status, StatusCode::CREATED, "{saved}");
    assert_eq!(saved["company_id"], json!(company));
    assert_eq!(saved["client_id"], client["id"]);
    assert_eq!(saved["contract_date"], valid["contract_date"]);
    assert_eq!(saved["vehicle"], valid["vehicle"]);
    assert_eq!(saved["financing"], valid["financing"]);
    let operation_id = saved["id"].as_str().unwrap();
    let detail = operation_detail(company, client_id, operation_id);
    let (_, listed) = app.get(owner, &collection).await;
    assert_eq!(listed, json!([saved]));
    assert_eq!(app.get(owner, &detail).await.1, saved);
    let mismatched = operation_detail(company, other_client["id"].as_str().unwrap(), operation_id);
    assert_eq!(app.get(owner, &mismatched).await.0, StatusCode::NOT_FOUND);
    let wrong_company = operation_detail(other_company, client_id, operation_id);
    assert_eq!(
        app.get(owner, &wrong_company).await.0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        app.patch(owner, &detail, json!({"company_id": other_company}))
            .await
            .0,
        StatusCode::UNPROCESSABLE_ENTITY
    );
    let (status, edited) = app
        .patch(
            owner,
            &detail,
            json!({"contract_date": null, "vehicle": {"plate": "PLACA-PRUEBA"}}),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{edited}");
    assert_eq!(edited["reference"], saved["reference"]);
    assert_eq!(edited["financing"], saved["financing"]);
    assert_eq!(edited["vehicle"], json!({"plate": "PLACA-PRUEBA"}));
    assert!(edited["contract_date"].is_null());
    assert_eq!(
        app.patch(owner, &detail, json!({"financing": null}))
            .await
            .1["financing"],
        Value::Null
    );
}

#[tokio::test]
async fn operation_enforces_interest_date_order_and_preserves_legacy_financing_on_unrelated_edits()
{
    let app = TestApp::start().await;
    let owner = app.superadmin().await;
    let company = app.legacy_company(owner, "Empresa de prueba").await;
    let client = add_client(&app, owner, "Cliente sintético").await;
    let client_id = client["id"].as_str().unwrap();
    let collection = format!("{CLIENTS}/{client_id}/operations");
    let sale = app.create_contract(owner, "Venta sintética").await;
    set_scope(&app, owner, &sale, json!({"company_id": company})).await;
    let plan = |first_date: &str, second_date: &str| {
        json!({
            "interest_installments": [
                {"date": first_date, "amount_minor": 10000},
                {"date": second_date, "amount_minor": 10000}
            ],
            "final_principal": {"date": "2026-05-01", "amount_minor": 100000},
            "extraordinary_payments": []
        })
    };
    let mut body = json!({"company_id": company, "contract_id": sale["id"], "vehicle": {}, "reference": "Referencia manual anterior"});
    let (status, saved) = app.post(owner, &collection, body.clone()).await;
    assert_eq!(status, StatusCode::CREATED, "{saved}");
    let operation_id = saved["id"].as_str().unwrap();
    let detail = operation_detail(company, client_id, operation_id);

    for (first, second) in [
        ("2026-04-01", "2026-03-01"),
        ("2026-04-01", "2026-04-01"),
        ("2026-04-01", "2026-05-01"),
        ("2026-04-01", "2026-05-02"),
    ] {
        let financing = plan(first, second);
        body["financing"] = financing.clone();
        let created = app.post(owner, &collection, body.clone()).await;
        let updated = app
            .patch(owner, &detail, json!({"financing": financing}))
            .await;
        for (status, error) in [created, updated] {
            assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{error}");
            assert!(
                error["error"]["message"]
                    .as_str()
                    .unwrap()
                    .contains("orden ascendente"),
                "{error}"
            );
        }
    }

    let legacy = plan("2026-04-01", "2026-03-01");
    sqlx::query("UPDATE yzy_contracts.client_operations SET financing = $2 WHERE id = $1")
        .bind(Uuid::parse_str(operation_id).unwrap())
        .bind(sqlx::types::Json(&legacy))
        .execute(&app.admin)
        .await
        .unwrap();
    assert_eq!(app.get(owner, &detail).await.1["financing"], legacy);
    let (status, edited) = app
        .patch(owner, &detail, json!({"reference": "Referencia corregida"}))
        .await;
    assert_eq!(status, StatusCode::OK, "{edited}");
    assert_eq!(edited["reference"], "Referencia corregida");
    assert_eq!(edited["financing"], legacy);
    let corrected = plan("2026-03-01", "2026-04-01");
    let (status, updated) = app
        .patch(owner, &detail, json!({"financing": corrected}))
        .await;
    assert_eq!(status, StatusCode::OK, "{updated}");
    assert_eq!(updated["financing"], corrected);
}

#[tokio::test]
async fn loan_pdf_checks_company_and_requires_complete_data_before_rendering() {
    use wiremock::{
        Mock, ResponseTemplate,
        matchers::{method, path},
    };

    let app = TestApp::start_with_upload_limit(1024 * 1024).await;
    let owner = app.superadmin().await;
    let company = app.legacy_company(owner, "Empresa sintética").await;
    let client = add_client(&app, owner, "Cliente sintético").await;
    let client_id = client["id"].as_str().unwrap();
    let collection = format!("{CLIENTS}/{client_id}/operations");
    let (status, saved) = app.post(owner, &collection, json!({
        "company_id": company,
        "vehicle": {},
        "application": { "application_date": "2026-11-13", "requested_amount_minor": 150000 }
    })).await;
    assert_eq!(status, StatusCode::CREATED, "{saved}");
    let id = saved["id"].as_str().unwrap();
    let pdf = format!("{CASES}/{id}/solicitud-prestamo.pdf");
    assert_eq!(
        app.request(Method::GET, &pdf, None, None).await.0,
        StatusCode::UNAUTHORIZED
    );
    let pending = app.pending_user().await;
    assert_eq!(app.get(pending, &pdf).await.0, StatusCode::FORBIDDEN);
    assert_eq!(
        app.get(owner, &pdf).await.0,
        StatusCode::UNPROCESSABLE_ENTITY
    );

    let family = json!({"name":"Referencia sintética", "relationship":"Familiar", "phone":"809-555-0101", "address":"Calle sintética"});
    let personal =
        json!({"name":"Referencia sintética", "relationship":"Amistad", "phone":"809-555-0102"});
    let (status, edited) = app.patch(owner, &format!("{CLIENTS}/{client_id}"), json!({
        "identity":"000-0000000-1", "address":"Calle A & B", "email":"cliente@ejemplo.test",
        "profile": {
            "owns_home":false, "rents_home":true, "owns_vehicle":true,
            "employer":"Taller sintético", "work_address":"Calle C", "work_phone":"809-555-0100",
            "position":"Técnico", "employment_duration":"2 años", "fixed_income":"40000",
            "other_income":"No", "other_income_source":"No aplica", "pay_days":"15 y 30",
            "spouse_not_applicable":true, "family_references":[family, family, family],
            "personal_references":[personal, personal]
        }
    })).await;
    assert_eq!(status, StatusCode::OK, "{edited}");
    let (status, edited) = app.patch(owner, &operation_detail(company, client_id, id), json!({
        "vehicle": {
            "vehicle_type":"Automóvil", "make":"Honda", "model":"Civic", "year":"2025", "color":"Blanco",
            "plate":"SINT-0002", "chassis_number":"SINT-0003", "engine_number":"SINT-0004"
        }
    })).await;
    assert_eq!(status, StatusCode::OK, "{edited}");
    let expected: Vec<&str> = vec![
        "CLIENTE SINTÉTICO",
        "CALLE A &amp; B",
        "CONCEPTO: N/A",
        "NOMBRE: N/A",
    ];
    Mock::given(method("POST"))
        .and(path("/v1/render/pdf"))
        .and(move |request: &wiremock::Request| {
            use std::io::{Cursor, Read};
            let mut zip = zip::ZipArchive::new(Cursor::new(&request.body)).unwrap();
            let mut xml = String::new();
            zip.by_name("word/document.xml")
                .unwrap()
                .read_to_string(&mut xml)
                .unwrap();
            let mut header = String::new();
            zip.by_name("word/header2.xml")
                .unwrap()
                .read_to_string(&mut header)
                .unwrap();
            let mut footer = String::new();
            zip.by_name("word/footer2.xml")
                .unwrap()
                .read_to_string(&mut footer)
                .unwrap();

            expected.iter().all(|value| xml.contains(value))
                && !xml.contains("{{")
                && !xml.contains("No aplica")
                && xml.find("DATOS DEL SOLICITANTE") < xml.find("NOMBRES Y APELLIDOS")
                && xml.find("FECHA: 13 de noviembre de 2026") < xml.find("NOMBRES Y APELLIDOS")
                && xml.find("DATOS DEL CÓNYUGE") < xml.find("PROPIEDAD QUE OFRECE EN GARANTÍA:")
                && xml.find("PROPIEDAD QUE OFRECE EN GARANTÍA:")
                    < xml.find("REFERENCIAS FAMILIARES")
                && header.contains("EMPRESA SINTÉTICA")
                && header.contains("SOLICITUD DE PRÉSTAMO")
                && footer.contains("LA CARTA DE SALDO TIENE UN COSTO DE RD$4,500.00")
                && footer.contains("SE LE COBRARÁN RD$25,000.00")
        })
        .respond_with(
            ResponseTemplate::new(200).set_body_raw(b"%PDF-1.4\n%%EOF".to_vec(), "application/pdf"),
        )
        .expect(4)
        .mount(&app.extractor)
        .await;
    let (status, result) = app.get(owner, &pdf).await;
    assert_eq!(status, StatusCode::OK, "{result}");

    // The type is required unless the vehicle was imported with a bill of lading.
    let mut imported = json!({
        "make":"Honda", "model":"Civic", "year":"2025", "color":"Blanco",
        "chassis_number":"SINT-0003", "engine_number":"SINT-0004"
    });
    let (status, edited) = app
        .patch(
            owner,
            &operation_detail(company, client_id, id),
            json!({ "vehicle": imported }),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{edited}");
    assert_eq!(
        app.get(owner, &pdf).await.0,
        StatusCode::UNPROCESSABLE_ENTITY
    );
    imported["source_document"] = json!("bill_of_lading");
    let (status, edited) = app
        .patch(
            owner,
            &operation_detail(company, client_id, id),
            json!({ "vehicle": imported }),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{edited}");
    assert_eq!(edited["vehicle"]["source_document"], "bill_of_lading");
    let (status, result) = app.get(owner, &pdf).await;
    assert_eq!(status, StatusCode::OK, "{result}");
    for plate in [None, Some("SINT-0002")] {
        imported.as_object_mut().unwrap().remove("engine_number");
        if let Some(plate) = plate {
            imported["plate"] = json!(plate);
        }
        let (status, edited) = app
            .patch(
                owner,
                &operation_detail(company, client_id, id),
                json!({ "vehicle": imported }),
            )
            .await;
        assert_eq!(status, StatusCode::OK, "{edited}");
        let (status, result) = app.get(owner, &pdf).await;
        assert_eq!(status, StatusCode::OK, "{result}");
    }
    let render_requests = app.extractor.received_requests().await.unwrap();
    let expected_descriptions = [
        "COLOR: BLANCO, PLACA: SINT-0002, CHASIS N.º: SINT-0003, MOTOR O N.º DE SERIE: SINT-0004",
        "COLOR: BLANCO, PLACA: ________________, CHASIS N.º: SINT-0003, MOTOR O N.º DE SERIE: SINT-0004",
        "COLOR: BLANCO, PLACA: ________________, CHASIS N.º: SINT-0003, MOTOR O N.º DE SERIE: ________________",
        "COLOR: BLANCO, PLACA: SINT-0002, CHASIS N.º: SINT-0003, MOTOR O N.º DE SERIE: ________________",
    ];
    assert_eq!(render_requests.len(), expected_descriptions.len());
    for (request, description) in render_requests.iter().zip(expected_descriptions) {
        use std::io::{Cursor, Read};
        let mut word = zip::ZipArchive::new(Cursor::new(&request.body)).unwrap();
        let mut xml = String::new();
        word.by_name("word/document.xml")
            .unwrap()
            .read_to_string(&mut xml)
            .unwrap();
        assert!(
            xml.contains(&format!("{description}</w:t>")),
            "{description}"
        );
    }
    let (status, timeline) = app
        .get(owner, &format!("{CLIENTS}/{client_id}/timeline"))
        .await;
    assert_eq!(status, StatusCode::OK, "{timeline}");
    assert!(
        timeline.to_string().contains("vehicle.source_document"),
        "{timeline}"
    );
    sqlx::query("UPDATE yzy_contracts.companies SET archived_at = now() WHERE id = $1")
        .bind(company)
        .execute(&app.admin)
        .await
        .unwrap();
    assert_eq!(app.get(owner, &pdf).await.0, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn case_saves_extraordinary_amounts_and_moves_dates_with_the_signature() {
    let app = TestApp::start().await;
    let admin = app.superadmin().await;
    let company = app.legacy_company(admin, "Financiera sintética").await;
    let client = add_client(&app, admin, "Cliente sintético").await;
    let client_id = client["id"].as_str().unwrap();
    let (status, case) = app
        .post(
            admin,
            &format!("{CLIENTS}/{client_id}/operations"),
            json!({
                "company_id": company, "vehicle": {}, "signature_date": "2027-10-31",
                "application": {"application_date":"2027-10-20","requested_amount_minor":77500000}
            }),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{case}");
    let detail = operation_detail(company, client_id, case["id"].as_str().unwrap());
    let (status, saved) = app.patch(admin, &detail, json!({
        "financing": {
            "monthly_plan": {"capital_minor":100,"monthly_rate_basis_points":250,"installment_count":13},
            "interest_installments": [], "final_principal": {"date":"2028-11-30","amount_minor":1}, "extraordinary_payments": []
        },
        "extraordinary_payment_amounts_minor": [1234500, 0, 2500000]
    })).await;
    assert_eq!(status, StatusCode::OK, "{saved}");
    assert_eq!(saved["financing"]["extraordinary_from_signature"], true);
    assert_eq!(
        saved["financing"]["extraordinary_payments"],
        json!([
            {"date":"2028-02-29","amount_minor":1234500},
            {"date":"2028-06-30","amount_minor":0},
            {"date":"2028-10-31","amount_minor":2500000}
        ])
    );
    let (status, changed) = app
        .patch(
            admin,
            &detail,
            json!({"extraordinary_payment_amounts_minor": [1234500, 1000000, 2500000]}),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{changed}");
    assert_eq!(
        changed["financing"]["monthly_plan"],
        saved["financing"]["monthly_plan"]
    );
    assert_eq!(
        app.patch(
            admin,
            &detail,
            json!({"extraordinary_payment_amounts_minor": [1, 2, 3, 4]})
        )
        .await
        .0,
        StatusCode::UNPROCESSABLE_ENTITY
    );
    assert_eq!(
        app.patch(
            admin,
            &detail,
            json!({"extraordinary_payment_amounts_minor": [1, -1, 1]})
        )
        .await
        .0,
        StatusCode::UNPROCESSABLE_ENTITY
    );
    assert_eq!(
        app.patch(admin, &detail, json!({"signature_date":"2028-10-31"}))
            .await
            .0,
        StatusCode::OK
    );
    let (_, loaded) = app.get(admin, &detail).await;
    assert_eq!(
        loaded["financing"]["extraordinary_payments"],
        json!([
            {"date":"2029-02-28","amount_minor":1234500},
            {"date":"2029-06-30","amount_minor":1000000},
            {"date":"2029-10-31","amount_minor":2500000}
        ])
    );
    let (status, saved) = app
        .patch(
            admin,
            &detail,
            json!({"extraordinary_payment_amounts_minor": [1234500, 1000000]}),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{saved}");
    assert_eq!(saved["financing"]["extraordinary_payment_count"], 2);
    assert_eq!(
        saved["financing"]["extraordinary_payments"],
        json!([
            {"date":"2029-02-28","amount_minor":1234500},
            {"date":"2029-06-30","amount_minor":1000000}
        ])
    );
}

#[tokio::test]
async fn monthly_plan_uses_the_original_signing_day_and_recalculates_on_signature_changes() {
    let app = TestApp::start().await;
    let admin = app.superadmin().await;
    let company = app.legacy_company(admin, "Financiera sintética").await;
    let client = add_client(&app, admin, "Cliente sintético").await;
    let client_id = client["id"].as_str().unwrap();
    let (status, case) = app
        .post(
            admin,
            &format!("{CLIENTS}/{client_id}/operations"),
            json!({
                "company_id": company, "vehicle": {}, "signature_date": "2027-01-31",
                "application": {"application_date":"2027-01-20","requested_amount_minor":77500000}
            }),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{case}");
    let detail = operation_detail(company, client_id, case["id"].as_str().unwrap());
    let (status, saved) = app.patch(admin, &detail, json!({"financing": {
        "monthly_plan": {"capital_minor":100,"monthly_rate_basis_points":250,"installment_count":3},
        "interest_installments": [],
        "final_principal": {"date":"2027-02-01","amount_minor":1},
        "extraordinary_payments": [{"date":"2027-03-10","amount_minor":100}]
    }})).await;
    assert_eq!(status, StatusCode::OK, "{saved}");
    assert_eq!(
        saved["financing"]["monthly_plan"]["capital_minor"],
        77500000
    );
    assert_eq!(
        saved["financing"]["interest_installments"],
        json!([
            {"date":"2027-02-28","amount_minor":1937500},
            {"date":"2027-03-31","amount_minor":1937500}
        ])
    );
    assert_eq!(
        saved["financing"]["final_principal"],
        json!({"date":"2027-04-30","amount_minor":79437500})
    );

    let (status, changed) = app
        .patch(admin, &detail, json!({"signature_date":"2028-01-31"}))
        .await;
    assert_eq!(status, StatusCode::OK, "{changed}");
    assert_eq!(
        changed["financing"]["interest_installments"][0]["date"],
        "2028-02-29"
    );
    assert_eq!(
        changed["financing"]["interest_installments"][1]["date"],
        "2028-03-31"
    );
    assert_eq!(
        changed["financing"]["extraordinary_payments"],
        saved["financing"]["extraordinary_payments"]
    );
    let (status, revised) = app
        .patch(
            admin,
            &detail,
            json!({"application": {
                "application_date":"2027-01-20", "requested_amount_minor":80000000
            }}),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{revised}");
    assert_eq!(
        revised["financing"]["monthly_plan"]["capital_minor"],
        80000000
    );
    assert_eq!(
        revised["financing"]["interest_installments"][0]["amount_minor"],
        2000000
    );
    assert_eq!(
        revised["financing"]["final_principal"]["amount_minor"],
        82000000
    );
    assert_eq!(
        app.patch(admin, &detail, json!({"application":null}))
            .await
            .0,
        StatusCode::UNPROCESSABLE_ENTITY
    );
    assert_eq!(
        app.patch(admin, &detail, json!({"signature_date":null}))
            .await
            .0,
        StatusCode::UNPROCESSABLE_ENTITY
    );
    assert_eq!(
        app.get(admin, &detail).await.1["signature_date"],
        "2028-01-31"
    );
}

#[tokio::test]
async fn operation_status_defaults_to_solicitud_and_can_be_updated() {
    let app = TestApp::start().await;
    let admin = app.superadmin().await;
    let company = app.legacy_company(admin, "Financiera sintética").await;
    let client = add_client(&app, admin, "Cliente sintético").await;
    let client_id = client["id"].as_str().unwrap();
    let collection = format!("{CLIENTS}/{client_id}/operations");
    let (status, created) = app
        .post(
            admin,
            &collection,
            json!({"company_id": company, "vehicle": {}}),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{created}");
    assert_eq!(created["status"], "solicitud");
    let detail = operation_detail(company, client_id, created["id"].as_str().unwrap());
    let (status, updated) = app
        .patch(admin, &detail, json!({"status": "en_proceso"}))
        .await;
    assert_eq!(status, StatusCode::OK, "{updated}");
    assert_eq!(updated["status"], "en_proceso");
    let (status, invalid) = app
        .patch(admin, &detail, json!({"status": "archivado"}))
        .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{invalid}");
    for next in ["firma", "desembolso", "cerrado"] {
        let (status, body) = app.patch(admin, &detail, json!({"status": next})).await;
        assert_eq!(status, StatusCode::OK, "{body}");
        assert_eq!(body["status"], next);
    }
    let (_, timeline) = app
        .get(
            admin,
            &format!(
                "{CLIENTS}/{client_id}/timeline?operation_id={}",
                created["id"].as_str().unwrap()
            ),
        )
        .await;
    assert!(timeline["items"].as_array().unwrap().iter().any(|event| {
        event["changes"].as_array().is_some_and(|changes| {
            changes
                .iter()
                .any(|change| change["field"] == "status" && change["after"] == "cerrado")
        })
    }));
}

#[tokio::test]
async fn signature_date_is_stored_per_case_and_recorded_in_its_history() {
    let app = TestApp::start().await;
    let admin = app.superadmin().await;
    let company = app.legacy_company(admin, "Financiera sintética").await;
    let client = add_client(&app, admin, "Cliente sintético").await;
    let client_id = client["id"].as_str().unwrap();
    let collection = format!("{CLIENTS}/{client_id}/operations");
    let mut paths = Vec::new();
    for _ in 0..2 {
        let (status, case) = app
            .post(
                admin,
                &collection,
                json!({"company_id":company,"vehicle":{}}),
            )
            .await;
        assert_eq!(status, StatusCode::CREATED, "{case}");
        paths.push(case["id"].as_str().unwrap().to_owned());
    }
    let detail = operation_detail(company, client_id, &paths[0]);
    let (status, body) = app
        .patch(admin, &detail, json!({"signature_date":"2026-02-30"}))
        .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    let (status, case) = app
        .patch(admin, &detail, json!({"signature_date":"2026-11-14"}))
        .await;
    assert_eq!(status, StatusCode::OK, "{case}");
    assert_eq!(case["signature_date"], "2026-11-14");
    assert_eq!(
        app.get(admin, &format!("{CASES}/{}", paths[0])).await.1["signature_date"],
        "2026-11-14"
    );
    assert!(app.get(admin, &format!("{CASES}/{}", paths[1])).await.1["signature_date"].is_null());
    let (_, timeline) = app
        .get(
            admin,
            &format!("{CLIENTS}/{client_id}/timeline?operation_id={}", paths[0]),
        )
        .await;
    assert!(timeline["items"].as_array().unwrap().iter().any(|event| {
        event["changes"].as_array().is_some_and(|changes| {
            changes.iter().any(|change| {
                change["field"] == "signature_date" && change["after"] == "2026-11-14"
            })
        })
    }));
    assert!(
        app.patch(admin, &detail, json!({"signature_date":null}))
            .await
            .1["signature_date"]
            .is_null()
    );
}

#[tokio::test]
async fn insurance_installment_amount_is_stored_per_case_and_recorded_in_its_history() {
    let app = TestApp::start().await;
    let admin = app.superadmin().await;
    let company = app.legacy_company(admin, "Financiera de seguro").await;
    let client = add_client(&app, admin, "Cliente de seguro").await;
    let client_id = client["id"].as_str().unwrap();
    let collection = format!("{CLIENTS}/{client_id}/operations");

    for invalid in [0_i64, -100_i64, 9_007_199_254_740_992_i64] {
        let (status, error) = app
            .post(
                admin,
                &collection,
                json!({"company_id": company, "vehicle": {}, "insurance_installment_minor": invalid}),
            )
            .await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{error}");
    }

    let (status, created) = app
        .post(
            admin,
            &collection,
            json!({"company_id": company, "vehicle": {}, "insurance_installment_minor": 919800}),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{created}");
    assert_eq!(created["insurance_installment_minor"], 919800);
    assert_eq!(created["insurance_paid"], false);

    let operation_id = created["id"].as_str().unwrap();
    let detail = operation_detail(company, client_id, operation_id);
    assert_eq!(
        app.get(admin, &format!("{CASES}/{operation_id}")).await.1["insurance_installment_minor"],
        919800
    );

    for invalid in [0_i64, -1_i64, 9_007_199_254_740_992_i64] {
        let (status, error) = app
            .patch(
                admin,
                &detail,
                json!({"insurance_installment_minor": invalid}),
            )
            .await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{error}");
    }

    let (status, updated) = app
        .patch(
            admin,
            &detail,
            json!({"insurance_installment_minor": 1050000}),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{updated}");
    assert_eq!(updated["insurance_installment_minor"], 1050000);

    let (_, timeline) = app
        .get(
            admin,
            &format!("{CLIENTS}/{client_id}/timeline?operation_id={operation_id}"),
        )
        .await;
    assert!(timeline["items"].as_array().unwrap().iter().any(|event| {
        event["changes"].as_array().is_some_and(|changes| {
            changes.iter().any(|change| {
                change["field"] == "insurance_installment_minor"
                    && change["before"] == 919800
                    && change["after"] == 1050000
            })
        })
    }));

    let (status, cleared) = app
        .patch(
            admin,
            &detail,
            json!({"insurance_installment_minor": null, "insurance_paid": true}),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{cleared}");
    assert!(cleared["insurance_installment_minor"].is_null());
    assert_eq!(cleared["insurance_paid"], true);

    let (status, invalid_null_paid) = app
        .patch(admin, &detail, json!({"insurance_paid": null}))
        .await;
    assert_eq!(
        status,
        StatusCode::UNPROCESSABLE_ENTITY,
        "{invalid_null_paid}"
    );

    let (status, paid_case) = app
        .post(
            admin,
            &collection,
            json!({"company_id": company, "vehicle": {}, "insurance_paid": true}),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{paid_case}");
    assert_eq!(paid_case["insurance_paid"], true);
    assert!(paid_case["insurance_installment_minor"].is_null());
}

#[tokio::test]
async fn clients_delete_only_when_they_have_no_case_files() {
    let app = TestApp::start().await;
    let owner = app.superadmin().await;
    let company = app
        .legacy_company(owner, "Empresa de borrado de clientes")
        .await;
    let spare = add_client(&app, owner, "Cliente sin expediente").await;
    let spare_id = spare["id"].as_str().unwrap();
    let spare_detail = format!("{CLIENTS}/{spare_id}");
    let kept = add_client(&app, owner, "Cliente con expediente").await;
    let kept_id = kept["id"].as_str().unwrap();
    let kept_detail = format!("{CLIENTS}/{kept_id}");
    let collection = format!("{CLIENTS}/{kept_id}/operations");
    let (status, case) = app
        .post(
            owner,
            &collection,
            json!({"company_id": company, "vehicle": {}}),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{case}");

    assert_eq!(
        app.delete(owner, &kept_detail).await.0,
        StatusCode::CONFLICT
    );
    assert_eq!(
        error_code(&app.delete(owner, &kept_detail).await.1),
        "CLIENT_IN_USE"
    );
    assert_eq!(app.get(owner, &kept_detail).await.0, StatusCode::OK);

    assert_eq!(
        app.delete(owner, &spare_detail).await.0,
        StatusCode::NO_CONTENT
    );
    assert_eq!(app.get(owner, &spare_detail).await.0, StatusCode::NOT_FOUND);
    assert_eq!(
        app.delete(owner, &spare_detail).await.0,
        StatusCode::NOT_FOUND
    );
}

#[tokio::test]
async fn only_the_billing_manager_soft_deletes_a_case_file() {
    let app = TestApp::start().await;
    let admin = app.superadmin().await;
    let company = app.legacy_company(admin, "Financiera de borrado").await;
    let mut people = Vec::new();
    for _ in 0..2 {
        let user = app.pending_user().await;
        assert_eq!(app.get(user, "/api/v1/me").await.0, StatusCode::OK);
        let route = format!("/api/v1/admin/users/{}/access", user.id);
        assert_eq!(
            app.put(admin, &route, json!({"enabled": true})).await.0,
            StatusCode::OK
        );
        people.push(user);
    }
    let (manager, member) = (people[0], people[1]);
    let (status, account) = app
        .post(
            admin,
            "/api/v1/admin/billing/accounts",
            json!({"name": "Cuenta de borrado", "manager_user_id": manager.id, "company_ids": [company]}),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{account}");

    let client = add_client(&app, admin, "Cliente de borrado").await;
    let client_id = client["id"].as_str().unwrap();
    let (status, case) = app
        .post(
            admin,
            &format!("{CLIENTS}/{client_id}/operations"),
            json!({"company_id": company, "reference": "Compra a borrar", "vehicle": {"make": "Kia"}}),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{case}");
    let case_id = case["id"].as_str().unwrap();
    let detail = operation_detail(company, client_id, case_id);

    let (status, denied) = app.delete(member, &detail).await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{denied}");
    assert_eq!(error_code(&denied), "BILLING_REQUIRED");
    assert_eq!(app.get(admin, &detail).await.0, StatusCode::OK);

    let (status, body) = app.delete(manager, &detail).await;
    assert_eq!(status, StatusCode::NO_CONTENT, "{body}");

    assert_eq!(app.get(admin, &detail).await.0, StatusCode::NOT_FOUND);
    assert_eq!(
        app.get(admin, &format!("{CASES}/{case_id}")).await.0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(app.delete(manager, &detail).await.0, StatusCode::NOT_FOUND);
    let (_, cases) = app.get(admin, &cases_for(company)).await;
    assert_eq!(cases["total"], 0, "{cases}");
    let (_, operations) = app
        .get(admin, &format!("{CLIENTS}/{client_id}/operations"))
        .await;
    assert_eq!(operations, json!([]));

    let (deleted_at, deleted_by): (Option<chrono::DateTime<chrono::Utc>>, Option<Uuid>) = sqlx::query_as(
        "SELECT deleted_at, deleted_by FROM yzy_contracts.client_operations WHERE id = $1::uuid",
    )
    .bind(case_id)
    .fetch_one(&app.admin)
    .await
    .unwrap();
    assert!(deleted_at.is_some());
    assert_eq!(deleted_by, Some(manager.id));
}

#[tokio::test]
async fn workspace_dashboard_summarizes_company_cases_and_clients() {
    let app = TestApp::start().await;
    let admin = app.superadmin().await;
    let company = app.legacy_company(admin, "Dashboard Norte SRL").await;
    let other = app.legacy_company(admin, "Dashboard Sur SRL").await;

    let first = add_client(&app, admin, "Cliente dashboard uno").await;
    let second = add_client(&app, admin, "Cliente dashboard dos").await;
    let first_id = first["id"].as_str().unwrap();
    let second_id = second["id"].as_str().unwrap();

    let (status, with_plan) = app
        .post(
            admin,
            &format!("{CLIENTS}/{first_id}/operations"),
            json!({
                "company_id": company,
                "reference": "DN-0001",
                "vehicle": {"make": "Honda"},
                "financing": {
                    "interest_installments": [{"date": "2026-02-28", "amount_minor": 100000}],
                    "final_principal": {"date": "2027-01-31", "amount_minor": 3000000},
                    "extraordinary_payments": []
                }
            }),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{with_plan}");

    let (status, without_plan) = app
        .post(
            admin,
            &format!("{CLIENTS}/{second_id}/operations"),
            json!({"company_id": company, "reference": "DN-0002", "vehicle": {"make": "Toyota"}}),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{without_plan}");

    let (status, other_case) = app
        .post(
            admin,
            &format!("{CLIENTS}/{first_id}/operations"),
            json!({"company_id": other, "reference": "DS-0001", "vehicle": {"make": "Kia"}}),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{other_case}");

    let with_plan_id = with_plan["id"].as_str().unwrap();
    let (status, updated) = app
        .patch(
            admin,
            &operation_detail(company, first_id, with_plan_id),
            json!({"status": "desembolso"}),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{updated}");

    let member = app.pending_user().await;
    for owner in [admin, member] {
        sqlx::query(
            "INSERT INTO yzy_contracts.generated_documents
                (owner_id, id, operation_id, operation_company_id, company, contract_id,
                 contract_name, format, filename, markdown, imported_from_session, artifact)
             VALUES ($1, $2, $3::uuid, $4, jsonb_build_object('id', $4::text), $5,
                     'Contrato sintético', 'pdf', 'sintetico.pdf', '', false, $6)",
        )
        .bind(owner.id)
        .bind(Uuid::new_v4())
        .bind(with_plan_id)
        .bind(company)
        .bind(Uuid::new_v4())
        .bind(common::PDF_BYTES)
        .execute(&app.admin)
        .await
        .unwrap();
    }

    let (status, dashboard) = app
        .get(admin, &format!("/api/v1/dashboard?company_id={company}"))
        .await;
    assert_eq!(status, StatusCode::OK, "{dashboard}");
    assert!(dashboard["clients_total"].as_i64().unwrap() >= 2);
    assert_eq!(dashboard["cases_total"], 2);
    assert_eq!(dashboard["cases_this_month"], 2);
    assert_eq!(dashboard["cases_without_plan"], 1);
    assert_eq!(dashboard["unsigned_cases"], 1);
    assert_eq!(dashboard["pending_disbursement_cases"], 1);
    assert_eq!(dashboard["disbursed_cases"], 1);
    assert_eq!(dashboard["disbursed_this_month"], 1);
    assert_eq!(dashboard["documents_total"], 2);
    assert_eq!(dashboard["user_documents_total"], 1);
    assert_eq!(dashboard["time_saved_minutes"], 30);
    assert_eq!(dashboard["user_time_saved_minutes"], 25);
    assert_eq!(dashboard["user_disbursements_total"], 1);
    assert_eq!(dashboard["status_counts"]["solicitud"], 1);
    assert_eq!(dashboard["status_counts"]["desembolso"], 1);
    let user_stats = dashboard["user_stats"].as_array().unwrap();
    assert_eq!(user_stats.len(), 1);
    assert_eq!(user_stats[0]["user_id"], json!(member.id));
    assert_eq!(user_stats[0]["documents_total"], 1);
    assert_eq!(user_stats[0]["time_saved_minutes"], 5);
    assert_eq!(dashboard["recent_cases"].as_array().unwrap().len(), 2);
    assert_eq!(dashboard["months"].as_array().unwrap().len(), 6);
    assert_eq!(dashboard["formats"]["pdf"], 2);
    assert_eq!(dashboard["recent_cases"][0]["has_payment_plan"], false);
    assert_eq!(dashboard["recent_cases"][1]["has_payment_plan"], true);

    let stranger = app.pending_user().await;
    let (status, denied) = app
        .get(stranger, &format!("/api/v1/dashboard?company_id={company}"))
        .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{denied}");
    assert_eq!(error_code(&denied), "ACCESS_PENDING");
}

async fn insert_policy(
    app: &TestApp,
    company: Uuid,
    carrier: Uuid,
    client: &str,
    number: &str,
) -> Uuid {
    sqlx::query_scalar(
        "INSERT INTO yzy_contracts.insurance_policies
            (company_id, carrier_id, client_id, number, first_due_on, installment_count,
             installment_minor, renewal_on, renewal_minor)
         VALUES ($1, $2, $3::uuid, $4, current_date, 10, 100000, current_date + 365, 900000)
         RETURNING id",
    )
    .bind(company)
    .bind(carrier)
    .bind(client)
    .bind(number)
    .fetch_one(&app.admin)
    .await
    .unwrap()
}

/// Inserts a due. `month_offset` is 0 for a payment in the current Santo Domingo
/// month and -1 for one in the previous month; `None` leaves the due unpaid.
async fn insert_due(
    app: &TestApp,
    policy: Uuid,
    slot: i32,
    amount_minor: i64,
    paid: Option<(TestUser, i32)>,
) {
    let paid_by = paid.map(|(user, _)| user.id);
    let month_offset = paid.map(|(_, offset)| offset);
    sqlx::query(
        "INSERT INTO yzy_contracts.insurance_dues
            (policy_id, slot, due_on, amount_minor, paid_on, paid_by, recorded_at)
         VALUES ($1, $2, current_date, $3,
                 CASE WHEN $5::int IS NULL THEN NULL
                      ELSE (date_trunc('month', now() AT TIME ZONE 'America/Santo_Domingo')
                            + ($5::int * interval '1 month'))::date END,
                 $4, CASE WHEN $5::int IS NULL THEN NULL ELSE now() END)",
    )
    .bind(policy)
    .bind(slot)
    .bind(amount_minor)
    .bind(paid_by)
    .bind(month_offset)
    .execute(&app.admin)
    .await
    .unwrap();
}

#[tokio::test]
async fn workspace_dashboard_counts_prospects_new_clients_and_insurance_for_the_company_only() {
    let app = TestApp::start().await;
    let admin = app.superadmin().await;
    let company = app.legacy_company(admin, "Dashboard Seguros SRL").await;
    let other = app.legacy_company(admin, "Dashboard Ajena SRL").await;

    let first = add_client(&app, admin, "Cliente seguro uno").await;
    let second = add_client(&app, admin, "Cliente seguro dos").await;
    let old = add_client(&app, admin, "Cliente antiguo").await;
    let first_id = first["id"].as_str().unwrap();
    let second_id = second["id"].as_str().unwrap();
    let old_id = old["id"].as_str().unwrap();
    sqlx::query(
        "UPDATE yzy_contracts.clients SET created_at = now() - interval '70 days' WHERE id = $1::uuid",
    )
    .bind(old_id)
    .execute(&app.admin)
    .await
    .unwrap();

    for (owner, name, identity) in [
        (company, "Prospecto uno", "00100000001"),
        (company, "Prospecto dos", "00100000002"),
        (other, "Prospecto ajeno", "00100000003"),
    ] {
        sqlx::query(
            "INSERT INTO yzy_contracts.prospects (company_id, name, identity, phone, address)
             VALUES ($1, $2, $3, '8095550000', 'Calle sintetica 1')",
        )
        .bind(owner)
        .bind(name)
        .bind(identity)
        .execute(&app.admin)
        .await
        .unwrap();
    }

    let carrier: Uuid = sqlx::query_scalar(
        "INSERT INTO yzy_contracts.insurance_carriers (name) VALUES ($1) RETURNING id",
    )
    .bind(format!("Aseguradora sintetica {}", Uuid::new_v4()))
    .fetch_one(&app.admin)
    .await
    .unwrap();

    let policy_a = insert_policy(&app, company, carrier, first_id, "POL-A").await;
    let policy_b = insert_policy(&app, company, carrier, second_id, "POL-B").await;
    let policy_c = insert_policy(&app, company, carrier, first_id, "POL-C").await;
    insert_due(&app, policy_a, 1, 100_000, Some((admin, 0))).await;
    insert_due(&app, policy_a, 2, 50_000, Some((admin, -1))).await;
    insert_due(&app, policy_b, 1, 250_000, Some((admin, 0))).await;
    insert_due(&app, policy_c, 1, 70_000, None).await;

    let foreign = insert_policy(&app, other, carrier, second_id, "POL-X").await;
    insert_due(&app, foreign, 1, 999_999, Some((admin, 0))).await;

    let (status, dashboard) = app
        .get(admin, &format!("/api/v1/dashboard?company_id={company}"))
        .await;
    assert_eq!(status, StatusCode::OK, "{dashboard}");
    assert_eq!(dashboard["prospects_pending"], 2);
    assert_eq!(dashboard["insurance"]["policies_total"], 3);
    assert_eq!(dashboard["insurance"]["insured_clients"], 2);
    assert_eq!(dashboard["insurance"]["collected"]["count"], 2);
    assert_eq!(dashboard["insurance"]["collected"]["amount_minor"], 350_000);
    assert_eq!(
        dashboard["insurance"]["collected"]["previous_amount_minor"],
        50_000
    );
    let clients_total = dashboard["clients_total"].as_i64().unwrap();
    let clients_this_month = dashboard["clients_this_month"].as_i64().unwrap();
    assert!(clients_this_month >= 2, "{dashboard}");
    assert!(clients_total - clients_this_month >= 1, "{dashboard}");

    let (status, foreign_dashboard) = app
        .get(admin, &format!("/api/v1/dashboard?company_id={other}"))
        .await;
    assert_eq!(status, StatusCode::OK, "{foreign_dashboard}");
    assert_eq!(foreign_dashboard["prospects_pending"], 1);
    assert_eq!(foreign_dashboard["insurance"]["policies_total"], 1);
    assert_eq!(foreign_dashboard["insurance"]["insured_clients"], 1);
    assert_eq!(foreign_dashboard["insurance"]["collected"]["count"], 1);
    assert_eq!(
        foreign_dashboard["insurance"]["collected"]["amount_minor"],
        999_999
    );
}

fn date_of(value: &Value) -> NaiveDate {
    NaiveDate::parse_from_str(value.as_str().unwrap(), "%Y-%m-%d").unwrap()
}

/// Santo Domingo has no daylight saving time: local time is UTC-4 all year.
fn local(date: NaiveDate, hour: u32) -> DateTime<Utc> {
    (date.and_hms_opt(hour, 0, 0).unwrap() + Duration::hours(4)).and_utc()
}

fn month_key(date: NaiveDate) -> String {
    date.format("%Y-%m").to_string()
}

async fn open_case(
    app: &TestApp,
    admin: TestUser,
    company: Uuid,
    client: &str,
    reference: &str,
) -> String {
    let (status, case) = app
        .post(
            admin,
            &format!("{CLIENTS}/{client}/operations"),
            json!({"company_id": company, "reference": reference, "vehicle": {}}),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{case}");
    case["id"].as_str().unwrap().to_owned()
}

struct CaseFixture<'a> {
    id: &'a str,
    status: &'a str,
    created: DateTime<Utc>,
    updated: DateTime<Utc>,
    principal_minor: Option<i64>,
    requested_minor: Option<i64>,
    /// When the history was last touched; `None` keeps the creation entry at now.
    last_history: Option<DateTime<Utc>>,
}

async fn shape_case(app: &TestApp, case: CaseFixture<'_>) {
    sqlx::query(
        "UPDATE yzy_contracts.client_operations
         SET status = $2, created_at = $3, updated_at = $4,
             financing = CASE WHEN $5::bigint IS NULL THEN NULL
                         ELSE jsonb_build_object('final_principal',
                                jsonb_build_object('amount_minor', $5::bigint)) END,
             application = CASE WHEN $6::bigint IS NULL THEN NULL
                           ELSE jsonb_build_object('requested_amount_minor', $6::bigint) END
         WHERE id = $1::uuid",
    )
    .bind(case.id)
    .bind(case.status)
    .bind(case.created)
    .bind(case.updated)
    .bind(case.principal_minor)
    .bind(case.requested_minor)
    .execute(&app.admin)
    .await
    .unwrap();
    if let Some(at) = case.last_history {
        sqlx::query(
            "UPDATE yzy_contracts.client_case_history SET occurred_at = $2 WHERE operation_id = $1::uuid",
        )
        .bind(case.id)
        .bind(at)
        .execute(&app.admin)
        .await
        .unwrap();
    }
}

async fn insert_document(
    app: &TestApp,
    owner: TestUser,
    company: Uuid,
    format: &str,
    created: DateTime<Utc>,
) {
    sqlx::query(
        "INSERT INTO yzy_contracts.generated_documents
            (owner_id, id, company, contract_id, contract_name, format, filename, markdown,
             email, imported_from_session, created_at, artifact)
         VALUES ($1, $2, jsonb_build_object('id', $3::text), $4, 'Contrato sintético', $5,
                 'sintetico', '',
                 CASE WHEN $5 = 'email' THEN '{\"attachment_format\": \"pdf\"}'::jsonb END, false, $6, $7)",
    )
    .bind(owner.id)
    .bind(Uuid::new_v4())
    .bind(company)
    .bind(Uuid::new_v4())
    .bind(format)
    .bind(created)
    .bind(common::PDF_BYTES)
    .execute(&app.admin)
    .await
    .unwrap();
}

#[derive(Clone)]
struct DueFixture {
    policy: usize,
    slot: i32,
    due_on: NaiveDate,
    amount_minor: i64,
    paid_on: Option<NaiveDate>,
}

async fn insert_due_on(app: &TestApp, policy: Uuid, due: &DueFixture, paid_by: TestUser) {
    sqlx::query(
        "INSERT INTO yzy_contracts.insurance_dues
            (policy_id, slot, due_on, amount_minor, paid_on, paid_by, recorded_at)
         VALUES ($1, $2, $3, $4, $5,
                 CASE WHEN $5::date IS NULL THEN NULL ELSE $6::uuid END,
                 CASE WHEN $5::date IS NULL THEN NULL ELSE now() END)",
    )
    .bind(policy)
    .bind(due.slot)
    .bind(due.due_on)
    .bind(due.amount_minor)
    .bind(due.paid_on)
    .bind(paid_by.id)
    .execute(&app.admin)
    .await
    .unwrap();
}

struct Window {
    start: NaiveDate,
    end: NaiveDate,
    effective_end: NaiveDate,
    compare_start: NaiveDate,
    compare_end: NaiveDate,
    today: NaiveDate,
}

impl Window {
    fn from(period: &Value) -> Self {
        let end = date_of(&period["end"]);
        let today = date_of(&period["today"]);
        Self {
            start: date_of(&period["start"]),
            end,
            effective_end: end.min(today + Duration::days(1)),
            compare_start: date_of(&period["compare_start"]),
            compare_end: date_of(&period["compare_end"]),
            today,
        }
    }

    fn current(&self, day: NaiveDate) -> bool {
        day >= self.start && day < self.effective_end
    }

    fn previous(&self, day: NaiveDate) -> bool {
        day >= self.compare_start && day < self.compare_end
    }
}

fn assert_insurance(insurance: &Value, window: &Window, dues: &[DueFixture], carriers: &[&str]) {
    let sum = |filter: &dyn Fn(&DueFixture) -> bool| -> (i64, i64) {
        dues.iter()
            .filter(|due| filter(due))
            .fold((0, 0), |(count, total), due| {
                (count + 1, total + due.amount_minor)
            })
    };
    let collected = sum(&|due| due.paid_on.is_some_and(|day| window.current(day)));
    let previous = sum(&|due| due.paid_on.is_some_and(|day| window.previous(day)));
    let due_in_period = sum(&|due| window.current(due.due_on));
    let paid_in_period = sum(&|due| window.current(due.due_on) && due.paid_on.is_some());
    let pending = sum(&|due| due.paid_on.is_none() && due.due_on < window.end);
    let overdue =
        sum(&|due| due.paid_on.is_none() && due.due_on < window.end && due.due_on < window.today);
    assert_eq!(insurance["collected"]["count"], collected.0);
    assert_eq!(insurance["collected"]["amount_minor"], collected.1);
    assert_eq!(insurance["collected"]["previous_amount_minor"], previous.1);
    assert_eq!(insurance["collected"]["due_in_period"], due_in_period.0);
    assert_eq!(
        insurance["collected"]["paid_of_due_in_period"],
        paid_in_period.0
    );
    assert_eq!(insurance["pending"]["count"], pending.0);
    assert_eq!(insurance["pending"]["amount_minor"], pending.1);
    assert_eq!(insurance["pending"]["overdue_amount_minor"], overdue.1);

    let mut pending_dues: Vec<&DueFixture> = dues
        .iter()
        .filter(|due| due.paid_on.is_none() && due.due_on < window.end)
        .collect();
    pending_dues.sort_by_key(|due| due.due_on);
    let listed: Vec<(String, i64)> = insurance["attention_dues"]
        .as_array()
        .unwrap()
        .iter()
        .map(|due| {
            (
                due["policy_number"].as_str().unwrap().to_owned(),
                due["slot"].as_i64().unwrap(),
            )
        })
        .collect();
    let expected: Vec<(String, i64)> = pending_dues
        .iter()
        .take(10)
        .map(|due| (format!("POL-{}", due.policy + 1), i64::from(due.slot)))
        .collect();
    assert_eq!(listed, expected);

    let mut by_carrier: Vec<(&str, i64, i64)> = Vec::new();
    for due in &pending_dues {
        let name = carriers[due.policy];
        match by_carrier.iter_mut().find(|entry| entry.0 == name) {
            Some(entry) => {
                entry.1 += 1;
                entry.2 += due.amount_minor;
            }
            None => by_carrier.push((name, 1, due.amount_minor)),
        }
    }
    by_carrier.sort_by_key(|entry| std::cmp::Reverse(entry.2));
    let reported: Vec<(String, i64, i64)> = insurance["by_carrier"]
        .as_array()
        .unwrap()
        .iter()
        .map(|entry| {
            (
                entry["carrier_name"].as_str().unwrap().to_owned(),
                entry["count"].as_i64().unwrap(),
                entry["amount_minor"].as_i64().unwrap(),
            )
        })
        .collect();
    let expected: Vec<(String, i64, i64)> = by_carrier
        .iter()
        .map(|(name, count, amount)| ((*name).to_owned(), *count, *amount))
        .collect();
    assert_eq!(reported, expected);
}

#[tokio::test]
async fn workspace_dashboard_reports_period_contracts_insurance_attention_and_trend() {
    let app = TestApp::start().await;
    let admin = app.superadmin().await;
    let company = app.legacy_company(admin, "Dashboard Periodo SRL").await;
    let other = app.legacy_company(admin, "Dashboard Vecina SRL").await;
    let uri = |period: &str| format!("/api/v1/dashboard?company_id={company}&period={period}");

    let (status, probe) = app.get(admin, &uri("month")).await;
    assert_eq!(status, StatusCode::OK, "{probe}");
    let month = Window::from(&probe["period"]);
    assert_eq!(probe["period"]["key"], "month");
    let (start, previous_start, today) = (month.start, month.compare_start, month.today);

    let client_x = add_client(&app, admin, "Cliente periodo X").await;
    let client_y = add_client(&app, admin, "Cliente periodo Y").await;
    let x = client_x["id"].as_str().unwrap();
    let y = client_y["id"].as_str().unwrap();
    let ninety_days_ago = Utc::now() - Duration::days(90);

    // Disbursed now: one with a plan, one closed without a plan.
    let case_a = open_case(&app, admin, company, x, "PE-A").await;
    shape_case(
        &app,
        CaseFixture {
            id: &case_a,
            status: "desembolso",
            created: local(start, 0),
            updated: local(start, 12),
            principal_minor: Some(3_000_000),
            requested_minor: None,
            last_history: None,
        },
    )
    .await;
    let case_b = open_case(&app, admin, company, y, "PE-B").await;
    shape_case(
        &app,
        CaseFixture {
            id: &case_b,
            status: "cerrado",
            created: local(start, 0),
            updated: local(start, 23),
            principal_minor: None,
            requested_minor: None,
            last_history: None,
        },
    )
    .await;
    // Disbursed in the comparison range: the date comes from the status history, not updated_at.
    let case_c = open_case(&app, admin, company, x, "PE-C").await;
    shape_case(
        &app,
        CaseFixture {
            id: &case_c,
            status: "desembolso",
            created: local(previous_start, 0),
            updated: Utc::now(),
            principal_minor: Some(1_000_000),
            requested_minor: None,
            last_history: None,
        },
    )
    .await;
    sqlx::query(
        "INSERT INTO yzy_contracts.client_case_history
            (company_id, client_id, operation_id, kind, occurred_at, actor_id, actor_name, changes)
         SELECT company_id, client_id, id, 'operation_updated', $2, $3, 'Tester',
                '[{\"field\": \"status\", \"before\": \"firma\", \"after\": \"desembolso\"}]'::jsonb
         FROM yzy_contracts.client_operations WHERE id = $1::uuid",
    )
    .bind(&case_c)
    .bind(local(previous_start, 12))
    .bind(admin.id)
    .execute(&app.admin)
    .await
    .unwrap();
    // Disbursed before both ranges.
    let case_d = open_case(&app, admin, company, y, "PE-D").await;
    shape_case(
        &app,
        CaseFixture {
            id: &case_d,
            status: "desembolso",
            created: local(previous_start - Duration::days(40), 0),
            updated: local(previous_start - Duration::days(40), 12),
            principal_minor: Some(500_000),
            requested_minor: None,
            last_history: None,
        },
    )
    .await;
    // Open cases: old and stalled, active, stalled for ten days, and brand new.
    let case_e = open_case(&app, admin, company, x, "PE-E").await;
    shape_case(
        &app,
        CaseFixture {
            id: &case_e,
            status: "solicitud",
            created: ninety_days_ago,
            updated: ninety_days_ago,
            principal_minor: None,
            requested_minor: Some(800_000),
            last_history: Some(ninety_days_ago),
        },
    )
    .await;
    let case_f = open_case(&app, admin, company, y, "PE-F").await;
    shape_case(
        &app,
        CaseFixture {
            id: &case_f,
            status: "en_proceso",
            created: ninety_days_ago,
            updated: Utc::now(),
            principal_minor: None,
            requested_minor: None,
            last_history: None,
        },
    )
    .await;
    let case_g = open_case(&app, admin, company, x, "PE-G").await;
    let ten_days_ago = Utc::now() - Duration::days(10);
    shape_case(
        &app,
        CaseFixture {
            id: &case_g,
            status: "firma",
            created: ninety_days_ago,
            updated: ten_days_ago,
            principal_minor: None,
            requested_minor: Some(200_000),
            last_history: Some(ten_days_ago),
        },
    )
    .await;
    open_case(&app, admin, company, y, "PE-I").await;
    let foreign_case = open_case(&app, admin, other, x, "VE-A").await;
    shape_case(
        &app,
        CaseFixture {
            id: &foreign_case,
            status: "solicitud",
            created: ninety_days_ago,
            updated: ninety_days_ago,
            principal_minor: None,
            requested_minor: Some(999_000),
            last_history: Some(ninety_days_ago),
        },
    )
    .await;

    for (format, created) in [
        ("pdf", local(start, 12)),
        ("pdf", local(start, 12)),
        ("docx", Utc::now()),
        ("email", local(previous_start, 12)),
        ("pdf", ninety_days_ago),
    ] {
        insert_document(&app, admin, company, format, created).await;
    }
    insert_document(&app, admin, other, "pdf", local(start, 12)).await;

    let carrier_names = [
        format!("Aseguradora Alfa {}", Uuid::new_v4()),
        format!("Aseguradora Beta {}", Uuid::new_v4()),
    ];
    let mut carrier_ids = Vec::new();
    for name in &carrier_names {
        let id: Uuid = sqlx::query_scalar(
            "INSERT INTO yzy_contracts.insurance_carriers (name) VALUES ($1) RETURNING id",
        )
        .bind(name)
        .fetch_one(&app.admin)
        .await
        .unwrap();
        carrier_ids.push(id);
    }
    // POL-1 and POL-3 belong to the first carrier and client X; POL-2 to the second and client Y.
    let policy_ids = [
        insert_policy(&app, company, carrier_ids[0], x, "POL-1").await,
        insert_policy(&app, company, carrier_ids[1], y, "POL-2").await,
        insert_policy(&app, company, carrier_ids[0], x, "POL-3").await,
    ];
    sqlx::query("UPDATE yzy_contracts.insurance_policies SET created_at = $2 WHERE id = $1")
        .bind(policy_ids[1])
        .bind(local(previous_start, 12))
        .execute(&app.admin)
        .await
        .unwrap();
    sqlx::query("UPDATE yzy_contracts.insurance_policies SET created_at = NULL WHERE id = $1")
        .bind(policy_ids[2])
        .execute(&app.admin)
        .await
        .unwrap();

    let due = |policy, slot, due_on, amount_minor, paid_on| DueFixture {
        policy,
        slot,
        due_on,
        amount_minor,
        paid_on,
    };
    let dues = vec![
        due(0, 1, today - Duration::days(100), 10_000, None),
        due(0, 2, today - Duration::days(75), 20_000, None),
        due(2, 1, today - Duration::days(45), 30_000, None),
        due(2, 2, today - Duration::days(5), 40_000, None),
        due(1, 1, today, 50_000, None),
        due(1, 2, month.end + Duration::days(40), 60_000, None),
        due(1, 0, today + Duration::days(3), 70_000, None),
        due(0, 0, today + Duration::days(8), 90_000, None),
        due(0, 3, start, 100_000, Some(start)),
        due(2, 3, today - Duration::days(3), 200_000, Some(start)),
        due(1, 5, previous_start, 300_000, Some(previous_start)),
    ];
    for fixture in &dues {
        insert_due_on(&app, policy_ids[fixture.policy], fixture, admin).await;
    }
    sqlx::query(
        "INSERT INTO yzy_contracts.insurance_dues (policy_id, slot, due_on, amount_minor, replaced_at)
         VALUES ($1, 6, $2, 999999, now())",
    )
    .bind(policy_ids[0])
    .bind(today - Duration::days(2))
    .execute(&app.admin)
    .await
    .unwrap();
    let foreign_policy = insert_policy(&app, other, carrier_ids[0], y, "POL-X").await;
    insert_due_on(
        &app,
        foreign_policy,
        &due(0, 1, today - Duration::days(1), 7_777, None),
        admin,
    )
    .await;

    let carriers = [
        carrier_names[0].as_str(),
        carrier_names[1].as_str(),
        carrier_names[0].as_str(),
    ];

    let (status, dashboard) = app.get(admin, &uri("month")).await;
    assert_eq!(status, StatusCode::OK, "{dashboard}");

    let contracts = &dashboard["contracts"];
    assert_eq!(contracts["disbursed"]["count"], 2);
    assert_eq!(contracts["disbursed"]["amount_minor"], 3_000_000);
    assert_eq!(contracts["disbursed"]["without_plan"], 1);
    assert_eq!(contracts["disbursed"]["previous_count"], 1);
    assert_eq!(contracts["disbursed"]["previous_amount_minor"], 1_000_000);
    assert_eq!(contracts["in_process"]["count"], 4);
    assert_eq!(contracts["in_process"]["amount_minor"], 1_000_000);
    assert_eq!(contracts["in_process"]["without_amount"], 2);
    assert_eq!(contracts["in_process"]["solicitud"], 2);
    assert_eq!(contracts["in_process"]["en_proceso"], 1);
    assert_eq!(contracts["in_process"]["firma"], 1);
    assert_eq!(contracts["cases_created"]["count"], 3);
    assert_eq!(contracts["cases_created"]["previous_count"], 1);
    assert_eq!(contracts["days_to_disbursement"]["average"], json!(0.7));
    assert_eq!(
        contracts["days_to_disbursement"]["previous_average"],
        json!(0.5)
    );
    assert_eq!(contracts["days_to_disbursement"]["sample"], 2);

    assert_eq!(dashboard["attention"]["unsigned_over_5_days"], 2);
    let overdue: Vec<&DueFixture> = dues
        .iter()
        .filter(|due| due.paid_on.is_none() && due.due_on < today)
        .collect();
    assert_eq!(
        dashboard["attention"]["overdue_dues"]["count"],
        overdue.len()
    );
    assert_eq!(
        dashboard["attention"]["overdue_dues"]["amount_minor"],
        overdue.iter().map(|due| due.amount_minor).sum::<i64>()
    );
    assert_eq!(dashboard["attention"]["renewals_next_7_days"]["count"], 1);
    assert_eq!(
        dashboard["attention"]["renewals_next_7_days"]["amount_minor"],
        70_000
    );

    let insurance = &dashboard["insurance"];
    assert_eq!(insurance["policies_total"], 3);
    assert_eq!(insurance["policies_new"], 1);
    assert_eq!(insurance["policies_new_previous"], 1);
    assert_eq!(insurance["insured_clients"], 2);
    assert_insurance(insurance, &month, &dues, &carriers);
    let aging: Vec<(String, i64, i64)> = insurance["aging"]
        .as_array()
        .unwrap()
        .iter()
        .map(|bucket| {
            (
                bucket["bucket"].as_str().unwrap().to_owned(),
                bucket["count"].as_i64().unwrap(),
                bucket["amount_minor"].as_i64().unwrap(),
            )
        })
        .collect();
    assert_eq!(
        aging,
        [
            ("1-30".to_owned(), 1, 40_000),
            ("31-60".to_owned(), 1, 30_000),
            ("61-90".to_owned(), 1, 20_000),
            ("90+".to_owned(), 1, 10_000),
        ]
    );
    let first_due = &insurance["attention_dues"][0];
    assert_eq!(first_due["policy_number"], "POL-1");
    assert_eq!(first_due["client_name"], "CLIENTE PERIODO X");
    assert_eq!(first_due["carrier_name"], carrier_names[0].as_str());
    assert_eq!(first_due["amount_minor"], 10_000);

    let trend = dashboard["trend"].as_array().unwrap();
    assert_eq!(trend.len(), 12);
    let months: Vec<NaiveDate> = (0..12u32)
        .rev()
        .map(|back| start.checked_sub_months(Months::new(back)).unwrap())
        .collect();
    let created_days = [
        start,
        start,
        previous_start,
        previous_start - Duration::days(40),
        today - Duration::days(90),
        today - Duration::days(90),
        today - Duration::days(90),
        today,
    ];
    for (entry, first_day) in trend.iter().zip(&months) {
        let key = month_key(*first_day);
        let in_month = |day: &NaiveDate| month_key(*day) == key;
        let amount = |pairs: &[(NaiveDate, i64)]| -> i64 {
            pairs
                .iter()
                .filter(|(day, _)| in_month(day))
                .map(|(_, amount)| amount)
                .sum()
        };
        assert_eq!(entry["month"], key.as_str());
        assert_eq!(
            entry["cases_created"],
            created_days.iter().filter(|day| in_month(day)).count()
        );
        assert_eq!(
            entry["disbursed_amount_minor"],
            amount(&[
                (start, 3_000_000),
                (previous_start, 1_000_000),
                (previous_start - Duration::days(40), 500_000)
            ])
        );
        assert_eq!(
            entry["collected_amount_minor"],
            amount(&[(start, 300_000), (previous_start, 300_000)])
        );
    }

    assert_eq!(dashboard["stalled_cases"]["count"], 2);
    let stalled = dashboard["stalled_cases"]["items"].as_array().unwrap();
    assert_eq!(stalled.len(), 2);
    assert_eq!(stalled[0]["reference"], "PE-E");
    assert_eq!(stalled[0]["status"], "solicitud");
    assert_eq!(stalled[0]["days_without_activity"], 90);
    assert_eq!(stalled[1]["reference"], "PE-G");
    assert_eq!(stalled[1]["days_without_activity"], 10);

    assert_eq!(dashboard["productivity"]["documents"]["total"], 3);
    assert_eq!(dashboard["productivity"]["documents"]["pdf"], 2);
    assert_eq!(dashboard["productivity"]["documents"]["docx"], 1);
    assert_eq!(dashboard["productivity"]["documents"]["email"], 0);
    assert_eq!(
        dashboard["productivity"]["time_saved_minutes"],
        3 * 5 + 3 * 10
    );

    // Fields the mobile app already parses keep their name and meaning.
    assert_eq!(dashboard["cases_total"], 8);
    assert_eq!(dashboard["cases_this_month"], 3);
    assert_eq!(dashboard["cases_without_plan"], 5);
    assert_eq!(dashboard["unsigned_cases"], 3);
    assert_eq!(dashboard["pending_disbursement_cases"], 4);
    assert_eq!(dashboard["disbursed_cases"], 4);
    assert_eq!(dashboard["disbursed_this_month"], 2);
    assert_eq!(dashboard["documents_total"], 5);
    assert_eq!(dashboard["documents_this_month"], 3);
    assert_eq!(dashboard["time_saved_minutes"], 5 * 5 + 8 * 10);
    assert_eq!(dashboard["status_counts"]["solicitud"], 2);
    assert_eq!(dashboard["status_counts"]["en_proceso"], 1);
    assert_eq!(dashboard["status_counts"]["firma"], 1);
    assert_eq!(dashboard["status_counts"]["desembolso"], 3);
    assert_eq!(dashboard["status_counts"]["cerrado"], 1);
    assert_eq!(dashboard["formats"]["pdf"], 3);
    assert_eq!(dashboard["formats"]["email"], 1);
    assert_eq!(dashboard["months"].as_array().unwrap().len(), 6);
    assert_eq!(dashboard["recent_cases"].as_array().unwrap().len(), 5);
    assert!(dashboard["user_stats"].is_array());
    assert!(dashboard["prospects_pending"].is_i64());
    assert!(dashboard["clients_this_month"].is_i64());

    // Last month is complete and compares with the whole month before it.
    let (status, last) = app.get(admin, &uri("last_month")).await;
    assert_eq!(status, StatusCode::OK, "{last}");
    let window = Window::from(&last["period"]);
    assert_eq!(last["period"]["key"], "last_month");
    assert_eq!(window.start, previous_start);
    assert_eq!(window.end, start);
    assert_eq!(window.effective_end, start);
    assert_eq!(window.compare_end, window.start);
    assert_eq!(
        window.compare_start,
        previous_start.checked_sub_months(Months::new(1)).unwrap()
    );
    assert_eq!(last["contracts"]["disbursed"]["count"], 1);
    assert_eq!(last["contracts"]["disbursed"]["amount_minor"], 1_000_000);
    assert_eq!(last["contracts"]["disbursed"]["previous_count"], 0);
    assert_eq!(last["contracts"]["cases_created"]["count"], 1);
    assert_eq!(
        last["contracts"]["days_to_disbursement"]["average"],
        json!(0.5)
    );
    assert_eq!(
        last["contracts"]["days_to_disbursement"]["previous_average"],
        Value::Null
    );
    assert_eq!(last["contracts"]["days_to_disbursement"]["sample"], 1);
    assert_eq!(last["insurance"]["policies_new"], 1);
    assert_eq!(last["insurance"]["policies_new_previous"], 0);
    assert_eq!(last["productivity"]["documents"]["total"], 1);
    assert_eq!(last["productivity"]["documents"]["email"], 1);
    assert_insurance(&last["insurance"], &window, &dues, &carriers);
    // The snapshot does not depend on the period.
    assert_eq!(
        last["contracts"]["in_process"],
        dashboard["contracts"]["in_process"]
    );
    assert_eq!(last["attention"], dashboard["attention"]);

    for (key, months_in_period) in [("quarter", 3u32), ("year", 12)] {
        let (status, body) = app.get(admin, &uri(key)).await;
        assert_eq!(status, StatusCode::OK, "{body}");
        let window = Window::from(&body["period"]);
        let first_month = if key == "year" {
            1
        } else {
            (today.format("%m").to_string().parse::<u32>().unwrap() - 1) / 3 * 3 + 1
        };
        let expected_start = NaiveDate::from_ymd_opt(
            today.format("%Y").to_string().parse().unwrap(),
            first_month,
            1,
        )
        .unwrap();
        assert_eq!(window.start, expected_start);
        assert_eq!(
            window.end,
            expected_start
                .checked_add_months(Months::new(months_in_period))
                .unwrap()
        );
        assert_eq!(
            window.compare_start,
            expected_start
                .checked_sub_months(Months::new(months_in_period))
                .unwrap()
        );
        assert!(window.compare_end <= window.start);
        assert_eq!(
            window.compare_end,
            (window.compare_start + (window.effective_end - window.start)).min(window.start)
        );
        assert_insurance(&body["insurance"], &window, &dues, &carriers);
    }

    let (status, invalid) = app.get(admin, &uri("week")).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{invalid}");
    assert_eq!(error_code(&invalid), "VALIDATION_ERROR");

    // The neighbouring company only sees its own records.
    let (status, foreign) = app
        .get(admin, &format!("/api/v1/dashboard?company_id={other}"))
        .await;
    assert_eq!(status, StatusCode::OK, "{foreign}");
    assert_eq!(foreign["period"]["key"], "month");
    assert_eq!(foreign["contracts"]["in_process"]["count"], 1);
    assert_eq!(foreign["contracts"]["in_process"]["amount_minor"], 999_000);
    assert_eq!(foreign["contracts"]["disbursed"]["count"], 0);
    assert_eq!(foreign["attention"]["overdue_dues"]["count"], 1);
    assert_eq!(foreign["attention"]["overdue_dues"]["amount_minor"], 7_777);
    assert_eq!(foreign["insurance"]["policies_total"], 1);
    assert_eq!(foreign["stalled_cases"]["count"], 1);
    assert_eq!(foreign["productivity"]["documents"]["total"], 1);
    assert_eq!(
        foreign["insurance"]["by_carrier"].as_array().unwrap().len(),
        1
    );

    // Membership is checked before any query, whatever the period.
    let stranger = app.pending_user().await;
    let (status, denied) = app.get(stranger, &uri("year")).await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{denied}");
}

#[tokio::test]
async fn workspace_dashboard_without_data_returns_empty_sections_and_four_aging_buckets() {
    let app = TestApp::start().await;
    let admin = app.superadmin().await;
    let company = app.legacy_company(admin, "Dashboard Vacio SRL").await;
    let (status, dashboard) = app
        .get(admin, &format!("/api/v1/dashboard?company_id={company}"))
        .await;
    assert_eq!(status, StatusCode::OK, "{dashboard}");
    assert_eq!(dashboard["period"]["key"], "month");
    assert_eq!(dashboard["trend"].as_array().unwrap().len(), 12);
    assert_eq!(dashboard["insurance"]["aging"].as_array().unwrap().len(), 4);
    assert_eq!(dashboard["insurance"]["aging"][3]["bucket"], "90+");
    assert_eq!(dashboard["insurance"]["aging"][3]["count"], 0);
    assert_eq!(dashboard["insurance"]["by_carrier"], json!([]));
    assert_eq!(dashboard["insurance"]["attention_dues"], json!([]));
    assert_eq!(dashboard["stalled_cases"], json!({"count": 0, "items": []}));
    assert_eq!(
        dashboard["contracts"]["days_to_disbursement"]["average"],
        Value::Null
    );
    assert_eq!(dashboard["contracts"]["days_to_disbursement"]["sample"], 0);
    assert_eq!(dashboard["contracts"]["disbursed"]["amount_minor"], 0);
    assert_eq!(dashboard["productivity"]["time_saved_minutes"], 0);
}
