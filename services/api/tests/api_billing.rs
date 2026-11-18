mod common;

use axum::{
    body::Body,
    http::{Method, Request, StatusCode, header},
};
use common::{TestApp, TestUser, error_code, token_for};
use serde_json::{Value, json};
use tower::ServiceExt;
use uuid::Uuid;

const ACCOUNTS: &str = "/api/v1/admin/billing/accounts";
const BANK_ACCOUNT: &str = "/api/v1/admin/billing/bank-account";
const PRICING: &str = "/api/v1/admin/billing/pricing";
const BILLING: &str = "/api/v1/billing";
const INVOICES: &str = "/api/v1/admin/billing/invoices";
const DASHBOARD: &str = "/api/v1/admin/dashboard";
const ME: &str = "/api/v1/me";

#[tokio::test]
async fn dashboard_activity_counts_unique_daily_visitors_and_ranks_screens() {
    let app = TestApp::start().await;
    let admin = app.superadmin().await;
    let first = app.user().await;
    let second = app.user().await;
    for user in [admin, first, second] {
        assert_eq!(app.get(user, ME).await.0, StatusCode::OK);
    }

    sqlx::query(
        "INSERT INTO yzy_contracts.portal_activity_events
            (user_id, client_event_id, event, screen, result, occurred_at)
         SELECT user_id, gen_random_uuid(), event, screen, 'observed',
            ((today - days_ago)::timestamp AT TIME ZONE 'America/Santo_Domingo')
         FROM (VALUES
            ($1::uuid, 'portal_visit', 'clients', 0),
            ($1, 'portal_visit', 'clients', 0),
            ($2, 'portal_visit', 'dashboard', 0),
            ($1, 'portal_visit', 'settings', 6),
            ($1, 'portal_visit', 'not_found', 7),
            ($1, 'portal_redirect', 'administration', 0),
            ($3, 'portal_visit', 'administration', 0)
         ) AS fixtures(user_id, event, screen, days_ago)
         CROSS JOIN (SELECT (now() AT TIME ZONE 'America/Santo_Domingo')::date AS today) boundary",
    )
    .bind(first.id)
    .bind(second.id)
    .bind(admin.id)
    .execute(&app.admin)
    .await
    .unwrap();

    let (status, dashboard) = app.get(admin, DASHBOARD).await;
    assert_eq!(status, StatusCode::OK, "{dashboard}");
    let activity = &dashboard["activity"];
    let daily = activity["daily_users"].as_array().unwrap();
    assert_eq!(daily.len(), 7);
    assert_eq!(daily[0]["users"], 1);
    assert_eq!(daily[1]["users"], 0);
    assert_eq!(daily[6]["users"], 2);
    assert_eq!(
        activity["top_screens"],
        json!([
            {"screen": "clients", "visits": 2},
            {"screen": "dashboard", "visits": 1},
            {"screen": "settings", "visits": 1}
        ])
    );
}

fn account(name: &str, manager: TestUser, companies: &[Uuid]) -> Value {
    json!({"name": name, "manager_user_id": manager.id, "company_ids": companies})
}

fn bank_account_input(number: &str, revision: Value) -> Value {
    json!({
        "bank_name": "Banco de prueba",
        "account_holder": "Titular de prueba",
        "account_type": "Corriente",
        "account_number": number,
        "expected_revision": revision,
    })
}

async fn move_start_back_one_month(app: &TestApp, account_id: &Value) {
    let id: Uuid = serde_json::from_value(account_id.clone()).unwrap();
    let mut tx = app.admin.begin().await.unwrap();
    sqlx::query("UPDATE yzy_contracts.billing_accounts SET starts_on = (date_trunc('month', now() AT TIME ZONE 'America/Santo_Domingo') - interval '1 month')::date WHERE id = $1")
        .bind(id).execute(&mut *tx).await.unwrap();
    sqlx::query("UPDATE yzy_contracts.billing_account_companies SET starts_on = (date_trunc('month', now() AT TIME ZONE 'America/Santo_Domingo') - interval '1 month')::date WHERE account_id = $1")
        .bind(id).execute(&mut *tx).await.unwrap();
    tx.commit().await.unwrap();
}

#[tokio::test]
async fn enabled_members_cannot_access_billing() {
    let app = TestApp::start().await;
    let admin = app.superadmin().await;
    let member = app.pending_user().await;
    assert_eq!(app.get(member, ME).await.0, StatusCode::OK);
    let access = format!("/api/v1/admin/users/{}/access", member.id);
    let (status, user) = app.put(admin, &access, json!({"enabled": true})).await;
    assert_eq!(status, StatusCode::OK, "{user}");

    let (status, identity) = app.get(member, ME).await;
    assert_eq!(status, StatusCode::OK, "{identity}");
    assert_eq!(identity["access"], "active");
    assert_eq!(identity["can_manage_billing"], false);
    assert_eq!(app.get(admin, ME).await.1["can_manage_billing"], true);
    assert_eq!(app.get(admin, BILLING).await.0, StatusCode::OK);

    let id = Uuid::new_v4();
    let token = token_for(member.id);
    let requests = [
        (Method::GET, BILLING.to_owned(), None),
        (
            Method::POST,
            format!("{BILLING}/accounts/{id}/renewal-invoice"),
            None,
        ),
        (
            Method::PUT,
            format!("{BILLING}/invoices/{id}/transfer"),
            Some(json!({"reference": "REF-SINT"})),
        ),
    ];
    for (method, route, body) in requests {
        let (status, denied) = app.request(method, &route, Some(&token), body).await;
        assert_eq!(status, StatusCode::FORBIDDEN, "{route}: {denied}");
        assert_eq!(error_code(&denied), "BILLING_REQUIRED");
    }
}

#[tokio::test]
async fn an_overdue_company_does_not_block_the_superadmin_workspace() {
    let app = TestApp::start().await;
    let admin = app.superadmin().await;
    let historical = app.user().await;
    let company = app
        .legacy_company(historical, "Empresa sintética con factura vencida")
        .await;
    let (status, billing_account) = app
        .post(
            admin,
            ACCOUNTS,
            account("Prueba de acceso", admin, &[company]),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{billing_account}");
    move_start_back_one_month(&app, &billing_account["id"]).await;
    let (status, billing) = app.get(admin, BILLING).await;
    assert_eq!(status, StatusCode::OK, "{billing}");
    assert!(
        billing["invoices"]
            .as_array()
            .unwrap()
            .iter()
            .any(|invoice| invoice["is_overdue"] == true)
    );

    let (status, me) = app.get(admin, ME).await;
    assert_eq!(status, StatusCode::OK, "{me}");
    assert_eq!(me["overdue_company_ids"], json!([]));
    assert_eq!(app.get(admin, "/api/v1/clients").await.0, StatusCode::OK);

    let contract = app.create_contract(admin, "Modelo de operación").await;
    let contract_id = contract["id"].as_str().unwrap();
    let contract_path = format!("/api/v1/contracts/{contract_id}");
    let (status, scoped) = app
        .patch(admin, &contract_path, json!({"company_id":company}))
        .await;
    assert_eq!(status, StatusCode::OK, "{scoped}");
    assert_eq!(
        app.get(
            admin,
            &format!("{contract_path}/generation-access?company_id={company}")
        )
        .await
        .0,
        StatusCode::NO_CONTENT
    );
    let (status, denied) = app.get(historical, BILLING).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(error_code(&denied), "ACCESS_PENDING");
}

#[tokio::test]
async fn removing_an_assignment_preserves_past_debt_and_allows_a_nonoverlapping_move() {
    let app = TestApp::start().await;
    let admin = app.superadmin().await;
    let manager = admin;
    let company = app.legacy_company(manager, "Empresa de calendario").await;
    assert_eq!(app.get(manager, ME).await.0, StatusCode::OK);
    let (status, account_row) = app
        .post(
            admin,
            ACCOUNTS,
            account("Cliente anterior", manager, &[company]),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{account_row}");
    let route = format!("{ACCOUNTS}/{}", account_row["id"].as_str().unwrap());
    move_start_back_one_month(&app, &account_row["id"]).await;
    let (status, removed) = app
        .put(admin, &route, account("Cliente anterior", manager, &[]))
        .await;
    assert_eq!(status, StatusCode::OK, "{removed}");
    assert_eq!(removed["monthly_total_minor"], 0);

    let month: chrono::NaiveDate = sqlx::query_scalar(
        "SELECT date_trunc('month', now() AT TIME ZONE 'America/Santo_Domingo')::date",
    )
    .fetch_one(&app.admin)
    .await
    .unwrap();
    let mut overlap = account("Cliente nuevo", manager, &[company]);
    overlap["starts_on"] = json!(month);
    let (status, body) = app.post(admin, ACCOUNTS, overlap).await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
    assert_eq!(error_code(&body), "BILLING_CONFLICT");
    assert_eq!(
        app.post(
            admin,
            ACCOUNTS,
            account("Cliente nuevo", manager, &[company])
        )
        .await
        .0,
        StatusCode::CREATED
    );
    let (status, overview) = app.get(manager, BILLING).await;
    assert_eq!(status, StatusCode::OK, "{overview}");
    let invoices = overview["invoices"].as_array().unwrap();
    assert_eq!(invoices.len(), 2);
    assert!(
        invoices
            .iter()
            .all(|invoice| invoice["account_id"] == account_row["id"])
    );
}

#[tokio::test]
async fn billing_creation_requires_a_configured_transfer_destination() {
    let mut app = TestApp::start().await;
    let admin = app.superadmin().await;
    let manager = admin;
    let company = app.legacy_company(manager, "Empresa de prueba").await;
    assert_eq!(app.get(manager, ME).await.0, StatusCode::OK);
    let mut state = app.state.clone();
    std::sync::Arc::make_mut(&mut state.config).billing_bank_account = None;
    app.router = yzy_contracts_api::app::build_router(state).unwrap();
    let (status, body) = app
        .post(
            admin,
            ACCOUNTS,
            account("Cuenta de prueba", manager, &[company]),
        )
        .await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
    assert_eq!(error_code(&body), "BILLING_BANK_REQUIRED");
    assert_eq!(app.get(admin, ACCOUNTS).await.1["items"], json!([]));
    assert_eq!(
        app.get(admin, BANK_ACCOUNT).await.1,
        json!({"bank_account": null, "revision": null, "updated_at": null})
    );

    let (status, saved) = app
        .put(admin, BANK_ACCOUNT, bank_account_input("0010", Value::Null))
        .await;
    assert_eq!(status, StatusCode::OK, "{saved}");
    assert_eq!(
        app.post(
            admin,
            ACCOUNTS,
            account("Cuenta de prueba", manager, &[company]),
        )
        .await
        .0,
        StatusCode::CREATED
    );
    let (status, overview) = app.get(manager, BILLING).await;
    assert_eq!(status, StatusCode::OK, "{overview}");
    assert_eq!(overview["bank_account"], saved["bank_account"]);
}

#[tokio::test]
async fn admin_can_change_membership_price_and_exchange_rate() {
    let app = TestApp::start().await;
    let admin = app.superadmin().await;
    let manager = app.pending_user().await;
    let company = app
        .legacy_company(admin, "Empresa con precio personalizado")
        .await;
    assert_eq!(app.get(manager, ME).await.0, StatusCode::OK);
    assert_eq!(
        app.put(
            admin,
            &format!("/api/v1/admin/users/{}/access", manager.id),
            json!({"enabled": true}),
        )
        .await
        .0,
        StatusCode::OK
    );
    let (status, pricing) = app.get(admin, PRICING).await;
    assert_eq!(status, StatusCode::OK, "{pricing}");
    assert_eq!(pricing["price_usd_minor"], 15_000);
    assert_eq!(pricing["exchange_rate_milli"], 60_000);
    assert_eq!(pricing["unit_price_minor"], 900_000);
    assert_eq!(app.get(manager, PRICING).await.0, StatusCode::FORBIDDEN);

    let (status, updated) = app
        .put(
            admin,
            PRICING,
            json!({
                "price_usd_minor": 15_000,
                "exchange_rate_milli": 63_000,
                "expected_revision": pricing["revision"],
            }),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{updated}");
    assert_eq!(updated["unit_price_minor"], 945_000);
    assert_eq!(
        app.put(
            admin,
            PRICING,
            json!({
                "price_usd_minor": 20_000,
                "exchange_rate_milli": 63_000,
                "expected_revision": pricing["revision"],
            }),
        )
        .await
        .0,
        StatusCode::CONFLICT
    );

    let this_month: String = sqlx::query_scalar(
        "SELECT date_trunc('month', now() AT TIME ZONE 'America/Santo_Domingo')::date::text",
    )
    .fetch_one(&app.admin)
    .await
    .unwrap();
    let mut input = account("Cuenta con override", manager, &[company]);
    input["starts_on"] = json!(this_month);
    let (status, created) = app.post(admin, ACCOUNTS, input).await;
    assert_eq!(status, StatusCode::CREATED, "{created}");
    let (status, saved) = app
        .put(
            admin,
            &format!("{ACCOUNTS}/{}", created["id"].as_str().unwrap()),
            json!({
                "name": created["name"],
                "manager_user_id": manager.id,
                "company_ids": [company],
                "company_prices": [{"company_id": company, "price_usd_minor": 10000}],
            }),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{saved}");
    assert_eq!(saved["companies"][0]["price_usd_minor"], 10_000);
    assert_eq!(saved["companies"][0]["unit_price_minor"], 630_000);
    assert_eq!(saved["monthly_total_minor"], 630_000);
    let overview = app.get(manager, BILLING).await.1;
    assert_eq!(overview["pricing"]["unit_price_minor"], 945_000);
    assert_eq!(overview["invoices"][0]["total_minor"], 630_000);
}

#[tokio::test]
async fn only_admin_can_replace_the_transfer_destination_without_disturbing_reports() {
    let app = TestApp::start().await;
    let admin = app.superadmin().await;
    let manager = admin;
    let outsider = app.user().await;
    let company = app.legacy_company(manager, "Empresa de prueba").await;
    assert_eq!(app.get(manager, ME).await.0, StatusCode::OK);
    let (status, created) = app
        .post(
            admin,
            ACCOUNTS,
            account("Cuenta de prueba", manager, &[company]),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{created}");

    let input = bank_account_input(" 0001-234 ", Value::Null);
    for (method, body) in [(Method::GET, None), (Method::PUT, Some(input.clone()))] {
        assert_eq!(
            app.request(method.clone(), BANK_ACCOUNT, None, body.clone())
                .await
                .0,
            StatusCode::UNAUTHORIZED
        );
        assert_eq!(
            app.request(method, BANK_ACCOUNT, Some(&token_for(outsider.id)), body)
                .await
                .0,
            StatusCode::FORBIDDEN
        );
    }

    let (status, fallback) = app.get(admin, BANK_ACCOUNT).await;
    assert_eq!(status, StatusCode::OK, "{fallback}");
    assert_eq!(fallback["bank_account"]["bank_name"], "Banco sintético");
    assert_eq!(fallback["revision"], Value::Null);
    assert_eq!(fallback["updated_at"], Value::Null);

    let mut missing_revision = input.clone();
    missing_revision
        .as_object_mut()
        .unwrap()
        .remove("expected_revision");
    for invalid in [
        missing_revision,
        bank_account_input("  ", Value::Null),
        bank_account_input("00\n01", Value::Null),
        bank_account_input(&"0".repeat(65), Value::Null),
    ] {
        assert_eq!(
            app.put(admin, BANK_ACCOUNT, invalid).await.0,
            StatusCode::UNPROCESSABLE_ENTITY
        );
    }

    let (status, first) = app.put(admin, BANK_ACCOUNT, input.clone()).await;
    assert_eq!(status, StatusCode::OK, "{first}");
    assert_eq!(first["bank_account"]["account_number"], "0001-234");
    assert!(first["updated_at"].is_string());
    assert!(first["revision"].is_string());

    move_start_back_one_month(&app, &created["id"]).await;
    let (status, overview) = app.get(manager, BILLING).await;
    assert_eq!(status, StatusCode::OK, "{overview}");
    assert_eq!(overview["bank_account"], first["bank_account"]);
    let invoice = overview["invoices"][0]["id"].as_str().unwrap();
    let (status, reported) = app
        .put(
            manager,
            &format!("{BILLING}/invoices/{invoice}/transfer"),
            json!({"reference": "PRUEBA-DEPOSITO"}),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{reported}");

    let (status, second) = app
        .put(
            admin,
            BANK_ACCOUNT,
            bank_account_input("0011-987", first["revision"].clone()),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{second}");
    assert_ne!(first["revision"], second["revision"]);
    assert_eq!(second["bank_account"]["account_number"], "0011-987");
    for stale in [input, bank_account_input("0040", first["revision"].clone())] {
        let (status, body) = app.put(admin, BANK_ACCOUNT, stale).await;
        assert_eq!(status, StatusCode::CONFLICT, "{body}");
        assert_eq!(error_code(&body), "BILLING_BANK_CONFLICT");
    }

    let (status, updated) = app.get(manager, BILLING).await;
    assert_eq!(status, StatusCode::OK, "{updated}");
    assert_eq!(updated["bank_account"], second["bank_account"]);
    assert_eq!(updated["invoices"][0], reported);
    let (status, confirmed) = app
        .put(
            admin,
            &format!("{INVOICES}/{invoice}/verification"),
            json!({"report_id": reported["transfer_report_id"], "decision": "confirm"}),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{confirmed}");
    assert_eq!(confirmed["state"], "paid");

    let actor: Uuid = sqlx::query_scalar(
        "SELECT updated_by FROM yzy_contracts.billing_bank_destination WHERE id = 1",
    )
    .fetch_one(&app.admin)
    .await
    .unwrap();
    assert_eq!(actor, admin.id);

    for (uri, user) in [(BANK_ACCOUNT, admin), (BILLING, manager)] {
        let response = app
            .router
            .clone()
            .oneshot(
                Request::builder()
                    .uri(uri)
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
        assert_eq!(
            response.headers()[header::CACHE_CONTROL],
            "private, no-store"
        );
    }
}

#[tokio::test]
async fn billing_manager_can_access_only_assigned_accounts_and_companies() {
    let app = TestApp::start().await;
    let admin = app.superadmin().await;
    let historical = app.user().await;
    let company = app.legacy_company(historical, "Empresa anterior").await;
    let (status, body) = app
        .post(
            admin,
            ACCOUNTS,
            account("Cuenta inválida", historical, &[company]),
        )
        .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    let _ = app.get(historical, ME).await;
    let (status, _) = app
        .put(
            admin,
            &format!("/api/v1/admin/users/{}/access", historical.id),
            json!({"enabled": true}),
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    let (status, created) = app
        .post(
            admin,
            ACCOUNTS,
            account("Cuenta asignada", historical, &[company]),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{created}");
    let id = created["id"].as_str().unwrap();
    let other = app.legacy_company(admin, "Empresa independiente").await;
    let (status, separate) = app
        .post(admin, ACCOUNTS, account("Cuenta separada", admin, &[other]))
        .await;
    assert_eq!(status, StatusCode::CREATED, "{separate}");
    let overview = app.get(historical, BILLING).await;
    assert_eq!(overview.0, StatusCode::OK);
    assert_eq!(overview.1["accounts"].as_array().unwrap().len(), 1);
    assert_eq!(overview.1["accounts"][0]["id"], id);
    assert_eq!(
        app.get(admin, BILLING).await.1["accounts"]
            .as_array()
            .unwrap()
            .len(),
        2
    );
    let identity = app.get(historical, ME).await.1;
    assert_eq!(identity["can_manage_billing"], true);
    assert_eq!(identity["billing_company_ids"], json!([company]));
    let separated_id = separate["id"].as_str().unwrap();
    assert_eq!(
        app.post(
            historical,
            &format!("{BILLING}/accounts/{separated_id}/renewal-invoice"),
            json!({})
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    let profile =
        json!({"name":"Empresa editada","values":{"empresa_razon_social":"Empresa editada"}});
    assert_eq!(
        app.put(
            historical,
            &format!("/api/v1/companies/{company}"),
            profile.clone()
        )
        .await
        .0,
        StatusCode::OK
    );
    assert_eq!(
        app.put(historical, &format!("/api/v1/companies/{other}"), profile)
            .await
            .0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        app.put(
            admin,
            &format!("{ACCOUNTS}/{id}"),
            account("Cuenta reasignada", admin, &[company])
        )
        .await
        .0,
        StatusCode::OK
    );
    assert_eq!(app.get(historical, BILLING).await.0, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn renewal_reserves_months_and_covers_them_once_the_transfer_is_confirmed() {
    let app = TestApp::start().await;
    let admin = app.superadmin().await;
    let manager = app.pending_user().await;
    let first = app.legacy_company(admin, "Autos de prueba A").await;
    let second = app.legacy_company(admin, "Autos de prueba B").await;
    assert_eq!(app.get(manager, ME).await.0, StatusCode::OK);
    assert_eq!(
        app.put(
            admin,
            &format!("/api/v1/admin/users/{}/access", manager.id),
            json!({"enabled": true}),
        )
        .await
        .0,
        StatusCode::OK
    );
    let mut input = account("Renovación de prueba", manager, &[first, second]);
    let this_month: String = sqlx::query_scalar(
        "SELECT date_trunc('month', now() AT TIME ZONE 'America/Santo_Domingo')::date::text",
    )
    .fetch_one(&app.admin)
    .await
    .unwrap();
    input["starts_on"] = json!(this_month);
    let (status, created) = app.post(admin, ACCOUNTS, input).await;
    assert_eq!(status, StatusCode::CREATED, "{created}");
    let overview = app.get(manager, BILLING).await.1;
    let invoice = &overview["invoices"][0];
    // Default pricing: USD 150 × 60.000 DOP = RD$9,000 (900_000 minor) per company.
    assert_eq!(invoice["total_minor"], 1_800_000);
    assert_eq!(invoice["renewal_month_limit"], 12);
    let id = invoice["id"].as_str().unwrap();
    let report_url = format!("{BILLING}/invoices/{id}/transfer");
    let verification = format!("{INVOICES}/{id}/verification");

    let invalid =
        json!({"reference": "DEMO-RENOVACION", "months": 13, "expected_total_minor": 3_240_000});
    assert_eq!(
        app.put(manager, &report_url, invalid).await.0,
        StatusCode::UNPROCESSABLE_ENTITY
    );
    let wrong =
        json!({"reference": "DEMO-RENOVACION", "months": 2, "expected_total_minor": 3_600_000});
    assert_eq!(
        app.put(manager, &report_url, wrong).await.0,
        StatusCode::CONFLICT
    );
    let two_months =
        json!({"reference": "DEMO-RENOVACION", "months": 2, "expected_total_minor": 3_240_000});
    let (status, reported) = app.put(manager, &report_url, two_months.clone()).await;
    assert_eq!(status, StatusCode::OK, "{reported}");
    assert_eq!(reported["state"], "in_review");
    assert_eq!(reported["months"], 2);
    assert_eq!(reported["discount_minor"], 360_000);
    assert_eq!(reported["total_minor"], 3_240_000);
    assert!(reported["transfer_reported_at"].is_string());
    let first_report = &reported["transfer_report_id"];
    let (status, review_page) = app
        .get(
            admin,
            &format!("{INVOICES}?page=1&per_page=1&in_review=true"),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{review_page}");
    assert_eq!(review_page["total"], 1);
    assert_eq!(review_page["items"][0]["id"], id);
    let (status, empty_page) = app
        .get(
            admin,
            &format!("{INVOICES}?page=2&per_page=1&in_review=true"),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{empty_page}");
    assert_eq!(empty_page["total"], 1);
    assert_eq!(empty_page["items"], json!([]));
    let (status, non_review) = app
        .get(
            admin,
            &format!("{INVOICES}?page=1&per_page=10&in_review=false"),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{non_review}");
    assert!(
        non_review["items"]
            .as_array()
            .unwrap()
            .iter()
            .all(|row| row["state"] != "in_review")
    );
    let (status, dashboard_page) = app
        .get(admin, &format!("{DASHBOARD}?page=2&per_page=1"))
        .await;
    assert_eq!(status, StatusCode::OK, "{dashboard_page}");
    assert_eq!(dashboard_page["collections"]["recent_reports_total"], 1);
    assert_eq!(dashboard_page["collections"]["recent_reports"], json!([]));
    assert_eq!(app.get(manager, DASHBOARD).await.0, StatusCode::FORBIDDEN);
    assert_eq!(
        app.put(
            manager,
            &verification,
            json!({"decision":"confirm","report_id":first_report})
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    let (status, dashboard) = app.get(admin, DASHBOARD).await;
    assert_eq!(status, StatusCode::OK, "{dashboard}");
    let collections = &dashboard["collections"];
    assert_eq!(collections["transfers_to_review"], 1);
    assert_eq!(collections["transfers_to_review_minor"], 3_240_000);
    assert_eq!(collections["overdue_invoices"], 0);
    assert_eq!(collections["confirmed_this_month_minor"], 0);
    assert_eq!(
        collections["recent_reports"][0]["reported_at"],
        reported["transfer_reported_at"]
    );
    assert_eq!(dashboard["usage"]["active_companies"], 2);
    let repeated = app.put(manager, &report_url, two_months).await;
    assert_eq!(repeated.0, StatusCode::OK);
    assert_eq!(&repeated.1["transfer_report_id"], first_report);
    let covered_invoice: Uuid = sqlx::query_scalar(
        "SELECT invoice_id FROM yzy_contracts.billing_renewal_periods WHERE report_id = $1",
    )
    .bind(Uuid::parse_str(first_report.as_str().unwrap()).unwrap())
    .fetch_one(&app.admin)
    .await
    .unwrap();
    assert_eq!(
        app.put(
            manager,
            &format!("{BILLING}/invoices/{covered_invoice}/transfer"),
            json!({"reference": "NO-DUPLICAR"})
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    let visible = app.get(manager, BILLING).await.1;
    assert_eq!(visible["invoices"].as_array().unwrap().len(), 1);

    // A due reminder can already exist when the pending renewal is rejected.
    let original_invoice = Uuid::parse_str(id).unwrap();
    let reminders = sqlx::query(
        "INSERT INTO yzy_contracts.billing_reminders (invoice_id, kind, scheduled_for)
         SELECT id, 'issued', period FROM yzy_contracts.billing_invoices
         WHERE id = $1 OR (id = $2 AND renewal_generated)
         ON CONFLICT (invoice_id, kind) DO NOTHING",
    )
    .bind(original_invoice)
    .bind(covered_invoice)
    .execute(&app.admin)
    .await
    .unwrap();
    assert_eq!(reminders.rows_affected(), 2);

    let rejected = app
        .put(
            admin,
            &verification,
            json!({"decision":"reject","report_id":first_report}),
        )
        .await;
    assert_eq!(rejected.0, StatusCode::OK, "{}", rejected.1);
    assert_eq!(rejected.1["months"], 1);
    assert_eq!(rejected.1["total_minor"], 1_800_000);
    let remaining_draft: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM yzy_contracts.billing_invoices WHERE id = $1)",
    )
    .bind(covered_invoice)
    .fetch_one(&app.admin)
    .await
    .unwrap();
    assert!(!remaining_draft);
    let remaining_reminders: Vec<Uuid> = sqlx::query_scalar(
        "SELECT invoice_id FROM yzy_contracts.billing_reminders WHERE invoice_id = ANY($1)",
    )
    .bind([original_invoice, covered_invoice])
    .fetch_all(&app.admin)
    .await
    .unwrap();
    assert_eq!(remaining_reminders, [original_invoice]);

    let year = json!({"reference":"DEMO-DOCE-MESES","months":12,"expected_total_minor":19_440_000});
    let (status, reported) = app.put(manager, &report_url, year).await;
    assert_eq!(status, StatusCode::OK, "{reported}");
    assert_eq!(reported["discount_minor"], 2_160_000);
    assert_eq!(reported["total_minor"], 19_440_000);
    let confirmed = app
        .put(
            admin,
            &verification,
            json!({"decision":"confirm","report_id":reported["transfer_report_id"]}),
        )
        .await;
    assert_eq!(confirmed.0, StatusCode::OK, "{}", confirmed.1);
    assert_eq!(confirmed.1["state"], "paid");
    let (status, dashboard) = app.get(admin, DASHBOARD).await;
    assert_eq!(status, StatusCode::OK, "{dashboard}");
    assert_eq!(dashboard["collections"]["transfers_to_review"], 0);
    assert_eq!(
        dashboard["collections"]["confirmed_this_month_minor"],
        19_440_000
    );
    let account_id = Uuid::parse_str(created["id"].as_str().unwrap()).unwrap();
    let (count, paid): (i64, i64) = sqlx::query_as(
        "SELECT count(*), count(paid_at) FROM yzy_contracts.billing_invoices WHERE account_id = $1",
    )
    .bind(account_id)
    .fetch_one(&app.admin)
    .await
    .unwrap();
    assert_eq!((count, paid), (12, 12));
    let visible = app.get(manager, BILLING).await.1;
    assert_eq!(visible["invoices"].as_array().unwrap().len(), 1);
    assert_eq!(visible["invoices"][0]["state"], "paid");
    assert_eq!(visible["invoices"][0]["months"], 12);
    let next_url = format!("{BILLING}/accounts/{account_id}/renewal-invoice");
    let (status, next) = app.post(manager, &next_url, json!({})).await;
    assert_eq!(status, StatusCode::OK, "{next}");
    assert_eq!(next["total_minor"], 1_800_000);
    assert_eq!(next["renewal_month_limit"], 12);
    assert_eq!(next["state"], "pending");
    let expected_period: String =
        sqlx::query_scalar("SELECT ($1::date + interval '12 months')::date::text")
            .bind(this_month)
            .fetch_one(&app.admin)
            .await
            .unwrap();
    assert_eq!(next["period"], expected_period);
    assert_eq!(
        app.post(manager, &next_url, json!({})).await.1["id"],
        next["id"]
    );
}

#[tokio::test]
async fn admin_can_assign_additional_billing_managers_from_users() {
    let app = TestApp::start().await;
    let admin = app.superadmin().await;
    let primary = app.pending_user().await;
    let extra = app.pending_user().await;
    let company = app
        .legacy_company(admin, "Empresa con varios responsables")
        .await;
    for user in [primary, extra] {
        assert_eq!(app.get(user, ME).await.0, StatusCode::OK);
        assert_eq!(
            app.put(
                admin,
                &format!("/api/v1/admin/users/{}/access", user.id),
                json!({"enabled": true}),
            )
            .await
            .0,
            StatusCode::OK
        );
    }
    let (status, created) = app
        .post(
            admin,
            ACCOUNTS,
            account("Cuenta compartida", primary, &[company]),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{created}");
    assert_eq!(app.get(extra, BILLING).await.0, StatusCode::FORBIDDEN);
    assert_eq!(app.get(extra, ME).await.1["can_manage_billing"], false);

    let billing = format!("/api/v1/admin/users/{}/billing", extra.id);
    let (status, user) = app
        .put(admin, &billing, json!({"manages_billing": true}))
        .await;
    assert_eq!(status, StatusCode::OK, "{user}");
    assert_eq!(user["manages_billing"], true);
    assert_eq!(app.get(extra, ME).await.1["can_manage_billing"], true);
    assert_eq!(app.get(extra, BILLING).await.0, StatusCode::OK);
    assert_eq!(
        app.get(extra, BILLING).await.1["accounts"][0]["id"],
        created["id"]
    );

    let (status, user) = app
        .put(admin, &billing, json!({"manages_billing": false}))
        .await;
    assert_eq!(status, StatusCode::OK, "{user}");
    assert_eq!(user["manages_billing"], false);
    assert_eq!(app.get(extra, BILLING).await.0, StatusCode::FORBIDDEN);
    assert_eq!(app.get(primary, BILLING).await.0, StatusCode::OK);
}
