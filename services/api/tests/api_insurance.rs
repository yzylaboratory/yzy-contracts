mod common;

use axum::http::StatusCode;
use chrono::{Days, NaiveDate};
use common::{ADMIN_ID, TestApp, test_email};
use serde_json::json;
use uuid::Uuid;

async fn company(app: &TestApp, name: &str) -> String {
    sqlx::query_scalar::<_, Uuid>(
        "INSERT INTO yzy_contracts_dev.companies (owner_id, name, variable_values)
         VALUES ($1, $2, jsonb_build_object('empresa_razon_social', $2::text)) RETURNING id",
    )
    .bind(ADMIN_ID)
    .bind(name)
    .fetch_one(&app.admin)
    .await
    .unwrap()
    .to_string()
}

#[tokio::test]
async fn company_scope_and_dev_gate() {
    let pending_id = Uuid::new_v4();
    let app = TestApp::start_development(&[ADMIN_ID, pending_id]).await;
    let admin = app.superadmin().await;
    let pending = app.auth_user(pending_id, &test_email(pending_id)).await;
    let a = company(&app, "Empresa sintética A").await;
    let b = company(&app, "Empresa sintética B").await;
    let company_a: Uuid = a.parse().unwrap();
    let a = format!("/api/v1/companies/{a}/insurance");
    let b = format!("/api/v1/companies/{b}/insurance");

    assert_eq!(app.get(pending, &a).await.0, StatusCode::FORBIDDEN);
    let (status, carrier) = app
        .post(
            admin,
            &format!("{a}/carriers"),
            json!({"name": "Seguros Prueba"}),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{carrier}");
    assert_eq!(
        app.post(
            admin,
            &format!("{a}/carriers"),
            json!({"name": "  seguros prueba  "})
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    assert_eq!(app.get(admin, &b).await.1["carriers"], json!([]));

    let (status, client) = app
        .post(
            admin,
            "/api/v1/clients",
            json!({"name": "Cliente sintético"}),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{client}");
    let body = json!({
        "carrier_id": carrier["id"], "client_id": client["id"], "number": "POL-101",
        "first_due_on": "2024-01-31", "installment_count": 2, "installment_minor": 100001,
        "renewal_on": "2025-01-31", "renewal_minor": 200002
    });
    assert_eq!(
        app.post(admin, &format!("{b}/policies"), body.clone())
            .await
            .0,
        StatusCode::UNPROCESSABLE_ENTITY
    );
    let (status, policy) = app.post(admin, &format!("{a}/policies"), body).await;
    assert_eq!(status, StatusCode::CREATED, "{policy}");
    let policy_id = policy["policy"]["id"].as_str().unwrap();
    assert_eq!(
        app.get(admin, &format!("{b}/policies/{policy_id}")).await.0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(app.get(admin, &b).await.1["policies"], json!([]));

    sqlx::query(
        "UPDATE yzy_contracts_dev.access_identities SET enabled_at = now() WHERE user_id = $1",
    )
    .bind(pending_id)
    .execute(&app.admin)
    .await
    .unwrap();
    assert_eq!(app.get(pending, &a).await.1["carriers"], json!([carrier]));

    sqlx::query("UPDATE yzy_contracts_dev.companies SET archived_at = now() WHERE id = $1")
        .bind(company_a)
        .execute(&app.admin)
        .await
        .unwrap();
    assert_eq!(app.get(pending, &a).await.0, StatusCode::NOT_FOUND);

    let prod = TestApp::start().await;
    let admin = prod.superadmin().await;
    assert_eq!(prod.get(admin, &a).await.0, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn local_dates_payment_idempotency_and_schedule_history() {
    let app = TestApp::start_development(&[ADMIN_ID]).await;
    let admin = app.superadmin().await;
    let company = company(&app, "Empresa sintética").await;
    let base = format!("/api/v1/companies/{company}/insurance");
    let (status, carrier) = app
        .post(
            admin,
            &format!("{base}/carriers"),
            json!({"name": "Seguros Prueba"}),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{carrier}");
    let (status, client) = app
        .post(
            admin,
            "/api/v1/clients",
            json!({"name": "Cliente sintético"}),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{client}");
    let (_, overview) = app.get(admin, &base).await;
    let today: NaiveDate = overview["today"].as_str().unwrap().parse().unwrap();
    let boundary = today.checked_add_days(Days::new(7)).unwrap();
    let body = json!({
        "carrier_id": carrier["id"], "client_id": client["id"], "number": "POL-101",
        "first_due_on": "2024-01-31", "installment_count": 3, "installment_minor": 100001,
        "renewal_on": boundary, "renewal_minor": 200002
    });
    let (status, policy) = app
        .post(admin, &format!("{base}/policies"), body.clone())
        .await;
    assert_eq!(status, StatusCode::CREATED, "{policy}");
    let dues = policy["dues"].as_array().unwrap();
    assert_eq!(dues[0]["due_on"], boundary.to_string());
    assert_eq!(dues[0]["slot"], 0);
    assert_eq!(dues[1]["due_on"], "2024-01-31");
    assert_eq!(dues[2]["due_on"], "2024-02-29");
    assert_eq!(dues[3]["due_on"], "2024-03-31");
    assert_eq!(dues[1]["amount_minor"], 100001);

    let detail = format!(
        "{base}/policies/{}",
        policy["policy"]["id"].as_str().unwrap()
    );
    let payment = format!("{detail}/dues/{}/payment", dues[1]["id"].as_str().unwrap());
    let replaced = format!("{detail}/dues/{}/payment", dues[2]["id"].as_str().unwrap());
    let (status, window) = app
        .get(admin, &format!("{base}?include_overdue=false"))
        .await;
    assert_eq!(status, StatusCode::OK, "{window}");
    assert_eq!(window["dues"], json!([dues[0]]));
    assert_eq!(
        app.get(admin, &format!("{base}?days=6&include_overdue=false"))
            .await
            .1["dues"],
        json!([])
    );

    let pay = json!({"paid_on": today});
    let (first, retry) = tokio::join!(
        app.put(admin, &payment, pay.clone()),
        app.put(admin, &payment, pay.clone())
    );
    assert_eq!(first.0, StatusCode::OK, "{}", first.1);
    assert_eq!(first, retry);
    assert_eq!(first.1["paid_on"], today.to_string());
    assert_eq!(
        app.put(admin, &payment, json!({"paid_on": today.succ_opt()}))
            .await
            .0,
        StatusCode::UNPROCESSABLE_ENTITY
    );
    assert_eq!(
        app.put(admin, &payment, json!({"paid_on": today.pred_opt()}))
            .await
            .0,
        StatusCode::CONFLICT
    );

    let mut edit = body;
    edit["revision"] = policy["policy"]["revision"].clone();
    edit["installment_minor"] = json!(300003);
    let (status, updated) = app.put(admin, &detail, edit.clone()).await;
    assert_eq!(status, StatusCode::OK, "{updated}");
    let updated = updated["dues"].as_array().unwrap();
    assert!(updated.contains(&first.1), "{updated:?}");
    assert!(updated.iter().any(|due| due["id"] == dues[2]["id"]
        && due["replaced"] == true
        && due["amount_minor"] == 100001));
    assert!(
        updated.iter().any(|due| due["slot"] == 2
            && due["replaced"] == false
            && due["amount_minor"] == 300003)
    );
    assert_eq!(app.put(admin, &detail, edit).await.0, StatusCode::CONFLICT);
    assert_eq!(app.put(admin, &replaced, pay).await.0, StatusCode::CONFLICT);

    let (status, overview) = app.get(admin, &base).await;
    assert_eq!(status, StatusCode::OK, "{overview}");
    assert_eq!(overview["dues"].as_array().unwrap().len(), 3);
    assert!(
        overview["dues"]
            .as_array()
            .unwrap()
            .iter()
            .all(|due| due["paid_on"].is_null() && due["replaced"] == false)
    );
}
