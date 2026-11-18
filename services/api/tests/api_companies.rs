mod common;

use axum::http::{Method, StatusCode};
use common::{TestApp, error_code, token_for};
use serde_json::{Value, json};
use uuid::Uuid;

const COMPANIES: &str = "/api/v1/companies";
const ADMIN_COMPANIES: &str = "/api/v1/admin/companies";

fn profile(name: &str, legal_name: &str) -> Value {
    json!({
        "name": name,
        "values": {
            "empresa_razon_social": legal_name,
            "empresa_rnc": "000000000",
            "empresa_codigo_interno": "SYNTH"
        }
    })
}

fn path(company: &Value) -> String {
    format!("{COMPANIES}/{}", company["id"].as_str().unwrap())
}

#[tokio::test]
async fn company_lifecycle_is_admin_managed_and_defaults_serialize() {
    let app = TestApp::start().await;
    let owner = app.superadmin().await;
    let other = app.user().await;
    let historical: Uuid =
        sqlx::query_scalar("SELECT id FROM yzy_contracts.companies WHERE owner_id = $1")
            .bind(other.id)
            .fetch_one(&app.admin)
            .await
            .unwrap();
    let unauthorized = app.request(Method::GET, COMPANIES, None, None).await;
    assert_eq!(unauthorized.0, StatusCode::UNAUTHORIZED);

    let (first, second) = tokio::join!(
        app.post(
            owner,
            COMPANIES,
            profile("Perfil uno", "Entidad sintética uno")
        ),
        app.post(
            owner,
            COMPANIES,
            profile("Perfil dos", "Entidad sintética dos")
        ),
    );
    assert_eq!(first.0, StatusCode::CREATED, "{:?}", first.1);
    assert_eq!(second.0, StatusCode::CREATED, "{:?}", second.1);
    assert_ne!(first.1["is_default"], second.1["is_default"]);
    assert_eq!(first.1["values"]["empresa_nombre"], "Entidad sintética uno");
    assert!(first.1.get("owner_id").is_none());
    let (status, billing) = app.get(owner, "/api/v1/admin/billing/accounts").await;
    assert_eq!(status, StatusCode::OK, "{billing}");
    let accounts = billing["items"].as_array().unwrap();
    assert_eq!(accounts.len(), 2);
    for (path, filter, expected_total) in [
        (ADMIN_COMPANIES, "&archived=false", 3),
        ("/api/v1/admin/billing/accounts", "", 2),
    ] {
        let (status, first_page) = app
            .get(owner, &format!("{path}?page=1&per_page=1{filter}"))
            .await;
        let (next_status, second_page) = app
            .get(owner, &format!("{path}?page=2&per_page=1{filter}"))
            .await;
        assert_eq!(status, StatusCode::OK, "{first_page}");
        assert_eq!(next_status, StatusCode::OK, "{second_page}");
        assert_eq!(first_page["total"], expected_total);
        assert_eq!(second_page["total"], expected_total);
        assert_eq!(first_page["items"].as_array().unwrap().len(), 1);
        assert_eq!(second_page["items"].as_array().unwrap().len(), 1);
        assert_ne!(first_page["items"][0]["id"], second_page["items"][0]["id"]);
    }
    let dedicated = accounts
        .iter()
        .find(|account| account["company_id"] == first.1["id"])
        .unwrap();
    assert_eq!(dedicated["name"], first.1["name"]);
    assert_eq!(dedicated["manager_user_id"], json!(owner.id));
    assert_eq!(dedicated["companies"][0]["id"], first.1["id"]);
    let account_path = format!(
        "/api/v1/admin/billing/accounts/{}",
        dedicated["id"].as_str().unwrap()
    );
    assert_eq!(
        app.put(
            owner,
            &account_path,
            json!({"name":"Perfil uno", "manager_user_id":owner.id,"company_ids":[second.1["id"]]})
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    let first_path = path(&first.1);
    let second_path = path(&second.1);
    let first_default = format!("{first_path}/default");
    let second_default = format!("{second_path}/default");
    let (set_first, set_second) = tokio::join!(
        app.post(owner, &first_default, json!({})),
        app.post(owner, &second_default, json!({})),
    );
    assert_eq!(set_first.0, StatusCode::OK);
    assert_eq!(set_second.0, StatusCode::OK);
    let (status, list) = app.get(owner, ADMIN_COMPANIES).await;
    assert_eq!(status, StatusCode::OK);
    let items: Vec<_> = list["items"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|item| item["id"] == first.1["id"] || item["id"] == second.1["id"])
        .collect();
    assert_eq!(items.len(), 2);
    assert_eq!(
        items
            .iter()
            .filter(|item| item["is_default"] == true)
            .count(),
        1
    );
    let active_default = path(items[0]);
    let remaining = path(items[1]);
    let (status, list) = app.get(other, COMPANIES).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(error_code(&list), "ACCESS_PENDING");
    sqlx::query("UPDATE yzy_contracts.access_identities SET enabled_at = now() WHERE user_id = $1")
        .bind(other.id)
        .execute(&app.admin)
        .await
        .unwrap();
    let (status, list) = app.get(other, COMPANIES).await;
    assert_eq!(status, StatusCode::OK, "{list}");
    assert!(
        list["items"]
            .as_array()
            .unwrap()
            .iter()
            .all(|item| item["can_manage"] == false)
    );
    assert_eq!(app.get(other, &first_path).await.0, StatusCode::OK);
    let (status, reassigned) = app
        .put(
            owner,
            &account_path,
            json!({"name":"Perfil uno", "manager_user_id":other.id,"company_ids":[first.1["id"]]}),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{reassigned}");
    assert_eq!(reassigned["manager_user_id"], json!(other.id));
    let (status, billing) = app.get(other, "/api/v1/billing").await;
    assert_eq!(status, StatusCode::OK, "{billing}");
    assert_eq!(billing["accounts"].as_array().unwrap().len(), 1);
    assert_eq!(billing["accounts"][0]["company_id"], first.1["id"]);
    assert_eq!(
        app.put(
            owner,
            &account_path,
            json!({"name":"Perfil uno", "manager_user_id":owner.id,"company_ids":[first.1["id"]]}),
        )
        .await
        .0,
        StatusCode::OK
    );
    for (method, route, body) in [
        (
            Method::PUT,
            first_path.clone(),
            Some(profile("Copia", "Entidad sintética")),
        ),
        (Method::POST, first_default, None),
        (Method::POST, format!("{first_path}/archive"), None),
        (Method::POST, format!("{first_path}/restore"), None),
    ] {
        let expected = if method == Method::PUT {
            "BILLING_REQUIRED"
        } else {
            "ADMIN_REQUIRED"
        };
        let (status, error) = app
            .request(method, &route, Some(&token_for(other.id)), body)
            .await;
        assert_eq!(status, StatusCode::FORBIDDEN);
        assert_eq!(error_code(&error), expected);
    }

    let (status, archived) = app
        .post(owner, &format!("{active_default}/archive"), json!({}))
        .await;
    assert_eq!(status, StatusCode::OK);
    assert!(archived["archived_at"].is_string());
    assert_eq!(archived["is_default"], false);
    let accounts = app.get(owner, "/api/v1/admin/billing/accounts").await.1;
    let archived_account = accounts["items"]
        .as_array()
        .unwrap()
        .iter()
        .find(|account| account["company_id"] == archived["id"])
        .unwrap();
    assert_eq!(archived_account["companies"], json!([]));
    assert_eq!(archived_account["monthly_total_minor"], 0);
    let (_, current) = app.get(owner, &remaining).await;
    assert_eq!(current["is_default"], true);
    let (_, active) = app.get(owner, COMPANIES).await;
    let active_ids: Vec<_> = active["items"]
        .as_array()
        .unwrap()
        .iter()
        .map(|item| item["id"].as_str().unwrap())
        .collect();
    assert_eq!(active_ids.len(), 2);
    assert!(active_ids.contains(&historical.to_string().as_str()));
    assert!(active_ids.contains(&remaining.rsplit('/').next().unwrap()));
    let (_, all) = app.get(owner, ADMIN_COMPANIES).await;
    assert_eq!(all["items"].as_array().unwrap().len(), 3);

    let (status, error) = app
        .put(owner, &active_default, profile("Otro", "Otra entidad"))
        .await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(error_code(&error), "COMPANY_ARCHIVED");
    let (status, _) = app
        .post(owner, &format!("{remaining}/archive"), json!({}))
        .await;
    assert_eq!(status, StatusCode::OK);
    let (status, restored) = app
        .post(owner, &format!("{active_default}/restore"), json!({}))
        .await;
    assert_eq!(status, StatusCode::OK);
    assert!(restored["archived_at"].is_null());
    assert_eq!(restored["is_default"], true);
    let accounts = app.get(owner, "/api/v1/admin/billing/accounts").await.1;
    let restored_account = accounts["items"]
        .as_array()
        .unwrap()
        .iter()
        .find(|account| account["company_id"] == restored["id"])
        .unwrap();
    assert_eq!(restored_account["id"], archived_account["id"]);
    assert_eq!(restored_account["companies"][0]["id"], restored["id"]);
    let (status, updated) = app
        .put(owner, &active_default, profile("Cambio", "Entidad nueva"))
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(updated["name"], "Cambio");
    assert_eq!(updated["values"]["empresa_nombre"], "Entidad nueva");
}

#[tokio::test]
async fn rejects_invalid_company_fields_without_creating_profiles() {
    let app = TestApp::start().await;
    let owner = app.superadmin().await;
    for values in [
        json!({}),
        json!({"empresa_razon_social": "   "}),
        json!({"empresa_razon_social": "Entidad", "empresa_nombre": "Otro"}),
        json!({"empresa_razon_social": "Entidad", "cliente_nombre": "Cliente"}),
        json!({"empresa_razon_social": "Entidad", "empresa_Cuenta": "001"}),
        json!({"empresa_razon_social": "Entidad", "empresa_": "001"}),
        json!({"empresa_razon_social": "Entidad", "empresa_cuenta": "00\u{000b}1"}),
        json!({"empresa_razon_social": "Entidad", "empresa_direccion": "a".repeat(1001)}),
    ] {
        let (status, error) = app
            .post(
                owner,
                COMPANIES,
                json!({"name": "Perfil", "values": values}),
            )
            .await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{error}");
        assert_eq!(error_code(&error), "VALIDATION_ERROR");
    }
    let (_, list) = app.get(owner, ADMIN_COMPANIES).await;
    assert_eq!(list["items"], json!([]));
}

#[tokio::test]
async fn superadmin_deletes_only_archived_unused_companies() {
    let app = TestApp::start().await;
    let owner = app.superadmin().await;
    let other = app.user().await;
    let (status, keep) = app
        .post(
            owner,
            COMPANIES,
            profile("Se queda", "Entidad sintética fija"),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{keep}");
    let (status, company) = app
        .post(
            owner,
            COMPANIES,
            profile("Temporal", "Entidad sintética temporal"),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{company}");
    let company_path = path(&company);

    let (status, _) = app
        .request(
            Method::DELETE,
            &company_path,
            Some(&token_for(other.id)),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, error) = app.delete(owner, &company_path).await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(error_code(&error), "COMPANY_NOT_ARCHIVED");

    let (status, link) = app
        .post(
            owner,
            &format!("{company_path}/prospect-links"),
            json!({"identity": "000-0000001-1"}),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{link}");

    let (status, _) = app
        .post(owner, &format!("{company_path}/archive"), json!({}))
        .await;
    assert_eq!(status, StatusCode::OK);
    let (status, _) = app
        .request(
            Method::POST,
            "/api/v1/public/prospect-links/check",
            None,
            Some(json!({"token": link["token"], "identity": "000-0000001-1"})),
        )
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, _) = app.delete(owner, &company_path).await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let (status, error) = app.get(owner, &company_path).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(error_code(&error), "COMPANY_NOT_FOUND");
    let remaining: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM yzy_contracts.billing_accounts WHERE company_id = $1::uuid",
    )
    .bind(company["id"].as_str().unwrap())
    .fetch_one(&app.admin)
    .await
    .unwrap();
    assert_eq!(remaining, 0);
    let (status, kept) = app.get(owner, &path(&keep)).await;
    assert_eq!(status, StatusCode::OK, "{kept}");
}
