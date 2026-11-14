mod common;

use axum::http::{Method, StatusCode};
use common::{TestApp, TestUser, error_code};
use serde_json::{Value, json};
use uuid::Uuid;

const CLIENTS: &str = "/api/v1/clients";
const CASES: &str = "/api/v1/expedientes";

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
    assert_eq!(saved["profile"]["employer"], "Lugar sintético");
    assert_eq!(saved["profile"]["treatment"], "Señor");
    assert_eq!(saved["profile"]["nationality"], "Dominicana");
    assert_eq!(saved["profile"]["marital_status"], "Soltero");
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
        "Otro contacto sintético"
    );
    let (_, timeline) = app.get(admin, &format!("{uri}/timeline")).await;
    assert!(
        timeline
            .to_string()
            .contains("Datos complementarios del cliente")
    );
    assert!(!timeline.to_string().contains("Otro contacto sintético"));
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
    for path in [CASES, &detail] {
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

    let (status, result) = app.get(member, CASES).await;
    assert_eq!(status, StatusCode::OK, "{result}");
    assert_eq!(result["total"], 3);
    assert_eq!(result["page"], 1);
    assert_eq!(result["per_page"], 20);
    assert_eq!(
        result["items"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|item| item["client_id"] == client["id"])
            .count(),
        2
    );
    assert_eq!(
        result["items"]
            .as_array()
            .unwrap()
            .iter()
            .find(|item| item["id"] == ids[1])
            .unwrap()["company_name"],
        "Financiera histórica"
    );

    let mut expected = ids.clone();
    expected.sort_by(|left, right| right.as_str().cmp(&left.as_str()));
    for (index, id) in expected.iter().enumerate() {
        let page = index + 1;
        let (status, result) = app
            .get(member, &format!("{CASES}?page={page}&per_page=1"))
            .await;
        assert_eq!(status, StatusCode::OK, "{result}");
        assert_eq!(result["page"], page);
        assert_eq!(result["total"], 3);
        assert_eq!(result["items"].as_array().unwrap().len(), 1);
        assert_eq!(result["items"][0]["id"], *id);
    }
    for (query, total) in [
        ("ines", 2),
        ("00000000011", 2),
        ("honda%20civic", 1),
        ("numero%20dos", 1),
        ("sin%20coincidencias", 0),
        ("---", 0),
    ] {
        let (status, result) = app.get(member, &format!("{CASES}?q={query}")).await;
        assert_eq!(status, StatusCode::OK, "{result}");
        assert_eq!(result["total"], total, "{query}: {result}");
    }
    for query in ["per_page=101", "page=0", "q=%00"] {
        assert_eq!(
            app.get(member, &format!("{CASES}?{query}")).await.0,
            StatusCode::UNPROCESSABLE_ENTITY
        );
    }

    let (status, case) = app.get(member, &detail).await;
    assert_eq!(status, StatusCode::OK, "{case}");
    assert_eq!(case["id"], ids[1]);
    assert_eq!(case["client_id"], client["id"]);
    assert_eq!(case["company_id"], json!(archived));
    assert_eq!(case["vehicle"]["model"], "Corolla");
    assert_eq!(
        app.get(member, &format!("{CASES}/{}", Uuid::new_v4()))
            .await
            .0,
        StatusCode::NOT_FOUND
    );
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
        changes.contains(&json!({"field": "vehicle.color", "before": "Azul", "after": "Verde"}))
    );
    assert!(
        changes.contains(
            &json!({"field": "vehicle.make", "before": "Marca sintética", "after": null})
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
    assert_eq!(page["items"][0]["name"], "Ágata Sintética");
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
    assert_eq!(updated["address"], "Calle ficticia");
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
            "registration_number":"SINT-0001", "plate":"SINT-0002", "chassis_number":"SINT-0003", "engine_number":"SINT-0004"
        }
    })).await;
    assert_eq!(status, StatusCode::OK, "{edited}");
    let expected: Vec<&str> = vec![
        "Cliente sintético",
        "Calle A &amp; B",
        "CONCEPTO: N/A",
        "NOMBRE: N/A",
        "SINT-0004",
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
        .expect(1)
        .mount(&app.extractor)
        .await;
    let (status, result) = app.get(owner, &pdf).await;
    assert_eq!(status, StatusCode::OK, "{result}");
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
    let (_, cases) = app.get(admin, CASES).await;
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
