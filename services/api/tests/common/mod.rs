//! Test harness: a real PostgreSQL database per test, an HTTP JWKS and extractor
//! served by wiremock, and in-memory object storage. Mocks live only under tests/.

#![allow(dead_code)]

use std::{
    collections::{BTreeSet, HashMap},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use anyhow::bail;
use async_trait::async_trait;
use axum::{
    Router,
    body::Body,
    http::{Method, Request, StatusCode, header},
};
use http_body_util::BodyExt;
use jsonwebtoken::{Algorithm, EncodingKey, Header, encode};
use serde_json::{Value, json};
use sqlx::{
    Connection, Executor, PgConnection, PgPool,
    postgres::{PgConnectOptions, PgPoolOptions},
};
use tokio::sync::OnceCell;
use tower::ServiceExt;
use uuid::Uuid;
use wiremock::{
    Mock, MockServer, ResponseTemplate,
    matchers::{method, path},
};
use yzy_contracts_api::{
    app,
    app_state::AppState,
    config::{Config, ExtractorConfig, JwtConfig, R2Config},
    infrastructure::{
        database,
        document_renderer::DocumentRenderer,
        extractor::ExtractorClient,
        openrouter::DocumentReader,
        schema::{DatabaseSchema, development_sql},
        storage::{ObjectMetadata, ObjectStorage, PresignedRequest},
    },
    modules::auth::jwt::JwtVerifier,
    workers::conversion::ConversionWorker,
};

pub const ADMIN_ID: Uuid = Uuid::from_u128(0x11000000000000000000000000000001);
pub const PDF_MIME: &str = "application/pdf";
pub const DOCX_MIME: &str =
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
pub const PDF_BYTES: &[u8] = b"%PDF-1.7 synthetic";
pub const ISSUER: &str = "http://127.0.0.1:8000/auth/v1";
pub const AUDIENCE: &str = "authenticated";
pub const KID: &str = "test-key-1";
pub const TEMPLATE_MAX_BYTES: usize = 4096;
pub const APP_ROLE_PASSWORD: &str = "test-only-app-password";
pub const EXTRACT_PATH: &str = "/internal/v1/extract";
pub const EXTRACTOR_KEY: &str = "synthetic-extractor-token";
pub const OPENROUTER_KEY: &str = "synthetic-openrouter-key";
pub const OPENROUTER_MODEL: &str = "synthetic/vision-model";

// Synthetic keys generated for this test suite. They protect nothing.
pub const SIGNING_KEY: &str = "-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgKgT6Omf5huQnB6sR
fi2eT6qFldYuOat2FX8N69AO+sKhRANCAASFCdgIBWyg0K5qaa9E0HO7aqpTDqCI
PJlSpmg/pC2FZ2R7wtfyqkVEA/7dK6eDETJ+suU9RYjX2NOkJy2oHMfi
-----END PRIVATE KEY-----
";
pub const UNTRUSTED_KEY: &str = "-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgsbtjOs8sJ/f66IMQ
vSzngGLZ02RABuN4Cd4Re1C5Pe2hRANCAAQWUFxCRCmRLXQpLZKEJc36fGLon3vd
V/ud1px/oQeLeXLklm27a8hq+N8frz+/otm2zNaTptIFnxNZZc5x1jG8
-----END PRIVATE KEY-----
";
const JWK_X: &str = "hQnYCAVsoNCuammvRNBzu2qqUw6giDyZUqZoP6QthWc";
const JWK_Y: &str = "ZHvC1_KqRUQD_t0rp4MRMn6y5T1FiNfY06QnLagcx-I";

static TEMPLATE_DB: OnceCell<String> = OnceCell::const_new();

fn admin_options() -> PgConnectOptions {
    let url = std::env::var("TEST_DATABASE_URL")
        .expect("TEST_DATABASE_URL is required; see services/api/README.md");
    url.parse().expect("TEST_DATABASE_URL must be a valid URL")
}

/// One fully migrated database per test run, cloned per test. The worker claims
/// from a global queue, so tests must not share a database.
async fn template_database() -> &'static str {
    TEMPLATE_DB
        .get_or_init(|| async {
            let mut admin = PgConnection::connect_with(&admin_options())
                .await
                .expect("connect to the test server");
            let stale: Vec<String> =
                sqlx::query_scalar("SELECT datname FROM pg_database WHERE datname LIKE 'yzy_ct_%'")
                    .fetch_all(&mut admin)
                    .await
                    .expect("list stale databases");
            for name in stale {
                let _ = admin
                    .execute(sqlx::AssertSqlSafe(format!(
                        "DROP DATABASE IF EXISTS \"{name}\" WITH (FORCE)"
                    )))
                    .await;
            }

            let name = format!("yzy_ct_tpl_{}", Uuid::new_v4().simple());
            admin
                .execute(sqlx::AssertSqlSafe(format!(
                    "CREATE DATABASE \"{name}\" TEMPLATE template0"
                )))
                .await
                .expect("create the template database");

            let options = admin_options().database(&name);
            let pool = PgPoolOptions::new()
                .max_connections(1)
                .connect_with(options)
                .await
                .expect("connect to the template database");
            sqlx::raw_sql(include_str!("../../../../supabase/local/bootstrap.sql"))
                .execute(&pool)
                .await
                .expect("bootstrap");
            database::migrator(DatabaseSchema::Production)
                .run(&pool)
                .await
                .expect("migrate");
            // The DEV schema lives in the same database, built from the same
            // bootstrap and migrations with the DEV rename, as the shared host does.
            sqlx::raw_sql(sqlx::AssertSqlSafe(development_sql(include_str!(
                "../../../../supabase/local/bootstrap.sql"
            ))))
            .execute(&pool)
            .await
            .expect("bootstrap DEV");
            database::migrator(DatabaseSchema::Development)
                .run(&pool)
                .await
                .expect("migrate DEV");
            for role in ["yzy_contracts_app", "yzy_contracts_dev_app"] {
                sqlx::raw_sql(sqlx::AssertSqlSafe(format!(
                    "ALTER ROLE {role} LOGIN PASSWORD '{APP_ROLE_PASSWORD}'"
                )))
                .execute(&pool)
                .await
                .expect("enable the app role");
            }
            pool.close().await;
            admin.close().await.expect("close admin connection");
            name
        })
        .await
}

#[derive(Clone)]
pub struct StoredObject {
    pub bytes: Vec<u8>,
    pub content_type: String,
    pub etag: String,
}

/// In-memory storage. Only tests may use it.
#[derive(Default)]
pub struct FakeStorage {
    pub objects: Mutex<HashMap<String, StoredObject>>,
    pub unavailable: AtomicBool,
}

impl FakeStorage {
    pub fn put(&self, key: &str, bytes: &[u8], content_type: &str) {
        self.objects.lock().expect("lock").insert(
            key.to_owned(),
            StoredObject {
                bytes: bytes.to_vec(),
                content_type: content_type.to_owned(),
                etag: format!("etag-{}", Uuid::new_v4()),
            },
        );
    }

    pub fn contains(&self, key: &str) -> bool {
        self.objects.lock().expect("lock").contains_key(key)
    }

    fn check_available(&self) -> anyhow::Result<()> {
        if self.unavailable.load(Ordering::SeqCst) {
            bail!("storage unavailable");
        }
        Ok(())
    }
}

#[async_trait]
impl ObjectStorage for FakeStorage {
    async fn presign_put(
        &self,
        key: &str,
        mime_type: &str,
        _size_bytes: i64,
        ttl: Duration,
    ) -> anyhow::Result<PresignedRequest> {
        self.check_available()?;
        Ok(PresignedRequest {
            url: format!("https://storage.test/{key}?op=put&ttl={}", ttl.as_secs()),
            headers: vec![("content-type".to_owned(), mime_type.to_owned())],
        })
    }

    async fn presign_get(
        &self,
        key: &str,
        _attachment_file_name: Option<&str>,
        ttl: Duration,
    ) -> anyhow::Result<String> {
        self.check_available()?;
        Ok(format!(
            "https://storage.test/{key}?op=get&ttl={}",
            ttl.as_secs()
        ))
    }

    async fn head(&self, key: &str) -> anyhow::Result<Option<ObjectMetadata>> {
        self.check_available()?;
        Ok(self
            .objects
            .lock()
            .expect("lock")
            .get(key)
            .map(|object| ObjectMetadata {
                size_bytes: object.bytes.len() as i64,
                content_type: Some(object.content_type.clone()),
                etag: object.etag.clone(),
            }))
    }

    async fn read_prefix(&self, key: &str, length: u32) -> anyhow::Result<Vec<u8>> {
        self.check_available()?;
        let objects = self.objects.lock().expect("lock");
        let object = objects
            .get(key)
            .ok_or_else(|| anyhow::anyhow!("no such object"))?;
        Ok(object.bytes.iter().take(length as usize).copied().collect())
    }

    async fn read_matching(
        &self,
        key: &str,
        metadata: &ObjectMetadata,
    ) -> anyhow::Result<Option<Vec<u8>>> {
        self.check_available()?;
        Ok(self
            .objects
            .lock()
            .expect("lock")
            .get(key)
            .filter(|object| {
                object.etag == metadata.etag && object.bytes.len() as i64 == metadata.size_bytes
            })
            .map(|object| object.bytes.clone()))
    }

    async fn delete(&self, key: &str) -> anyhow::Result<()> {
        self.check_available()?;
        self.objects.lock().expect("lock").remove(key);
        Ok(())
    }
}

pub struct TestApp {
    pub router: Router,
    pub state: AppState,
    pub storage: Arc<FakeStorage>,
    /// Owner connection, for arranging state and inspecting rows.
    pub admin: PgPool,
    pub jwks: MockServer,
    pub extractor: MockServer,
    pub worker: ConversionWorker,
    pub database: String,
}

#[derive(Debug, Clone, Copy)]
pub struct TestUser {
    pub id: Uuid,
}

pub fn jwks_body() -> Value {
    json!({"keys": [{
        "alg": "ES256", "crv": "P-256", "kid": KID, "kty": "EC", "use": "sig",
        "x": JWK_X, "y": JWK_Y
    }]})
}

impl TestApp {
    pub async fn start() -> Self {
        Self::start_with_extractor_timeout(Duration::from_secs(5)).await
    }

    pub async fn start_with_extractor_timeout(extractor_timeout: Duration) -> Self {
        Self::start_with_limits(extractor_timeout, 1024).await
    }

    /// The DEV instance: the DEV schema, the DEV runtime role and the given allowlist.
    pub async fn start_development(allowed_user_ids: &[Uuid]) -> Self {
        Self::start_inner(
            Duration::from_secs(5),
            1024,
            DatabaseSchema::Development,
            Some(allowed_user_ids.iter().copied().collect()),
        )
        .await
    }

    #[allow(dead_code)]
    pub async fn start_with_upload_limit(upload_max_bytes: i64) -> Self {
        Self::start_with_limits(Duration::from_secs(5), upload_max_bytes).await
    }

    async fn start_with_limits(extractor_timeout: Duration, upload_max_bytes: i64) -> Self {
        Self::start_inner(
            extractor_timeout,
            upload_max_bytes,
            DatabaseSchema::Production,
            None,
        )
        .await
    }

    async fn start_inner(
        extractor_timeout: Duration,
        upload_max_bytes: i64,
        schema: DatabaseSchema,
        allowed_user_ids: Option<BTreeSet<Uuid>>,
    ) -> Self {
        let template = template_database().await;
        let database = format!("yzy_ct_{}", Uuid::new_v4().simple());
        let mut admin_connection = PgConnection::connect_with(&admin_options())
            .await
            .expect("connect to the test server");
        admin_connection
            .execute(sqlx::AssertSqlSafe(format!(
                "CREATE DATABASE \"{database}\" TEMPLATE \"{template}\""
            )))
            .await
            .expect("clone the template database");
        admin_connection.close().await.expect("close");

        // The owner searches the same schema as the app, so repository helpers work on both.
        let admin = PgPoolOptions::new()
            .max_connections(3)
            .after_connect(move |connection, _| {
                Box::pin(async move {
                    sqlx::query("SELECT set_config('search_path', $1, false)")
                        .bind(schema.name())
                        .execute(connection)
                        .await?;
                    Ok(())
                })
            })
            .connect_with(admin_options().database(&database))
            .await
            .expect("connect as owner");
        let jwks = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/jwks"))
            .respond_with(ResponseTemplate::new(200).set_body_json(jwks_body()))
            .mount(&jwks)
            .await;
        let extractor = MockServer::start().await;

        let config = Config {
            http_bind_addr: "127.0.0.1:0".parse().expect("address"),
            // The pool is built from the options below through database::connect_with_options.
            database_url: "postgres://unused-in-tests".to_owned(),
            database_max_connections: 5,
            database_schema: schema,
            allowed_user_ids,
            superadmin_id: Some(ADMIN_ID),
            superadmin_email: Some(test_email(ADMIN_ID)),
            billing_bank_account: Some(yzy_contracts_api::modules::billing::dto::BankAccount {
                bank_name: "Banco sintético".to_owned(),
                account_holder: "Empresa de prueba".to_owned(),
                account_type: "Corriente".to_owned(),
                account_number: "CUENTA-DE-PRUEBA".to_owned(),
            }),
            jwt: JwtConfig {
                jwks_url: format!("{}/jwks", jwks.uri()),
                issuer: ISSUER.to_owned(),
                audience: AUDIENCE.to_owned(),
            },
            cors_allowed_origins: vec!["http://localhost:3000".to_owned()],
            r2: R2Config {
                endpoint: "https://storage.test".to_owned(),
                internal_endpoint: None,
                bucket: "contracts".to_owned(),
                access_key_id: "synthetic".to_owned(),
                secret_access_key: "synthetic".to_owned(),
                force_path_style: true,
            },
            upload_max_bytes,
            presign_upload_ttl: Duration::from_secs(300),
            presign_download_ttl: Duration::from_secs(120),
            template_max_bytes: TEMPLATE_MAX_BYTES,
            extractor: ExtractorConfig {
                url: extractor.uri(),
                api_token: EXTRACTOR_KEY.to_owned(),
                timeout: extractor_timeout,
            },
            conversion_max_attempts: 3,
            worker_poll_interval: Duration::from_secs(1),
            request_timeout: Duration::from_secs(10),
            billing_mail: None,
        };

        // The API runs as the schema's least-privilege role, as it does in production.
        let db = database::connect_with_options(
            admin_options()
                .database(&database)
                .username(schema.role())
                .password(APP_ROLE_PASSWORD),
            &config,
        )
        .await
        .expect("connect as the app role");

        let storage = Arc::new(FakeStorage::default());
        let state = AppState {
            db,
            storage: storage.clone(),
            jwt: Arc::new(JwtVerifier::new(config.jwt.clone()).expect("verifier")),
            document_renderer: Some(
                DocumentRenderer::new(&extractor.uri(), EXTRACTOR_KEY, config.request_timeout)
                    .expect("renderer client"),
            ),
            document_reader: Some(
                DocumentReader::new(
                    &format!("{}/openrouter", extractor.uri()),
                    OPENROUTER_KEY,
                    OPENROUTER_MODEL,
                    config.request_timeout,
                )
                .expect("document reader client"),
            ),
            config: Arc::new(config.clone()),
        };
        let router = app::build_router(state.clone()).expect("router");
        let worker = ConversionWorker::new(
            state.clone(),
            ExtractorClient::new(&config.extractor).expect("extractor client"),
        );

        Self {
            router,
            state,
            storage,
            admin,
            jwks,
            extractor,
            worker,
            database,
        }
    }

    /// Owner-level connection options for this test database, for connecting as other roles.
    pub fn server_options(&self) -> PgConnectOptions {
        admin_options().database(&self.database)
    }

    /// A second worker process over the same database.
    pub fn another_worker(&self) -> ConversionWorker {
        ConversionWorker::new(
            self.state.clone(),
            ExtractorClient::new(&self.state.config.extractor).expect("extractor client"),
        )
    }

    pub async fn user(&self) -> TestUser {
        let user = self.pending_user().await;
        self.legacy_company(user, "Empresa de pruebas").await;
        user
    }

    pub async fn pending_user(&self) -> TestUser {
        let id = Uuid::new_v4();
        self.auth_user(id, &test_email(id)).await
    }

    pub async fn superadmin(&self) -> TestUser {
        self.auth_user(ADMIN_ID, &test_email(ADMIN_ID)).await
    }

    pub async fn auth_user(&self, id: Uuid, email: &str) -> TestUser {
        sqlx::query(
            "INSERT INTO auth.users (id, email, email_confirmed_at) VALUES ($1, $2, now())",
        )
        .bind(id)
        .bind(email)
        .execute(&self.admin)
        .await
        .expect("create auth user");
        TestUser { id }
    }

    pub async fn legacy_company(&self, owner: TestUser, name: &str) -> Uuid {
        let id: Uuid = sqlx::query_scalar(
            "INSERT INTO yzy_contracts.companies (owner_id, name, variable_values)
             VALUES ($1, $2, $3) RETURNING id",
        )
        .bind(owner.id)
        .bind(name)
        .bind(sqlx::types::Json(json!({"empresa_razon_social": name})))
        .fetch_one(&self.admin)
        .await
        .expect("create test company");
        sqlx::query(
            "INSERT INTO yzy_contracts.company_memberships (user_id, company_id) VALUES ($1, $2)",
        )
        .bind(owner.id)
        .bind(id)
        .execute(&self.admin)
        .await
        .expect("seed test membership");
        id
    }

    pub async fn request(
        &self,
        method: Method,
        uri: &str,
        token: Option<&str>,
        body: Option<Value>,
    ) -> (StatusCode, Value) {
        let mut builder = Request::builder().method(method).uri(uri);
        if let Some(token) = token {
            builder = builder.header(header::AUTHORIZATION, format!("Bearer {token}"));
        }
        let request = match body {
            Some(body) => builder
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(body.to_string())),
            None => builder.body(Body::empty()),
        }
        .expect("request");
        let response = self
            .router
            .clone()
            .oneshot(request)
            .await
            .expect("response");
        let status = response.status();
        let bytes = response
            .into_body()
            .collect()
            .await
            .expect("body")
            .to_bytes();
        let value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
        (status, value)
    }

    pub async fn get(&self, user: TestUser, uri: &str) -> (StatusCode, Value) {
        self.request(Method::GET, uri, Some(&token_for(user.id)), None)
            .await
    }

    pub async fn post(&self, user: TestUser, uri: &str, body: Value) -> (StatusCode, Value) {
        self.request(Method::POST, uri, Some(&token_for(user.id)), Some(body))
            .await
    }

    pub async fn patch(&self, user: TestUser, uri: &str, body: Value) -> (StatusCode, Value) {
        self.request(Method::PATCH, uri, Some(&token_for(user.id)), Some(body))
            .await
    }

    pub async fn put(&self, user: TestUser, uri: &str, body: Value) -> (StatusCode, Value) {
        self.request(Method::PUT, uri, Some(&token_for(user.id)), Some(body))
            .await
    }

    pub async fn delete(&self, user: TestUser, uri: &str) -> (StatusCode, Value) {
        self.request(Method::DELETE, uri, Some(&token_for(user.id)), None)
            .await
    }

    /// Requests an upload URL and returns `(upload_id, object_key)`.
    pub async fn reserve_upload(&self, user: TestUser, size: i64) -> (String, String) {
        let (status, body) = self
            .post(
                user,
                "/api/v1/files/upload-url",
                json!({"file_name": "contrato.pdf", "mime_type": PDF_MIME, "size_bytes": size}),
            )
            .await;
        assert_eq!(status, StatusCode::CREATED, "{body}");
        let upload_id = body["upload_id"].as_str().expect("upload_id").to_owned();
        let key =
            sqlx::query_scalar("SELECT object_key FROM yzy_contracts.file_uploads WHERE id = $1")
                .bind(Uuid::parse_str(&upload_id).expect("uuid"))
                .fetch_one(&self.admin)
                .await
                .expect("object key");
        (upload_id, key)
    }

    /// Runs the upload flow end to end and returns the contract JSON.
    pub async fn create_contract(&self, user: TestUser, name: &str) -> Value {
        let (upload_id, key) = self.reserve_upload(user, PDF_BYTES.len() as i64).await;
        self.storage.put(&key, PDF_BYTES, PDF_MIME);
        let (status, body) = self
            .post(
                user,
                "/api/v1/contracts",
                json!({"upload_id": upload_id, "name": name}),
            )
            .await;
        assert_eq!(status, StatusCode::CREATED, "{body}");
        body
    }

    pub async fn mock_extractor_success(&self, markdown: &str) {
        self.mock_extractor_output(markdown, Some(2), json!([]))
            .await;
    }

    /// Answers like doc-extractor-api, echoing the job id it was given.
    pub async fn mock_extractor_output(
        &self,
        markdown: &str,
        page_count: Option<i32>,
        warnings: Value,
    ) {
        Mock::given(method("POST"))
            .and(path(EXTRACT_PATH))
            .respond_with(extract_response(markdown, page_count, warnings))
            .mount(&self.extractor)
            .await;
    }

    pub async fn mock_extractor_status(&self, status: u16, body: Value) {
        Mock::given(method("POST"))
            .and(path(EXTRACT_PATH))
            .respond_with(ResponseTemplate::new(status).set_body_json(body))
            .mount(&self.extractor)
            .await;
    }

    /// Makes a job in backoff due immediately.
    pub async fn make_jobs_due(&self) {
        sqlx::query(
            "UPDATE yzy_contracts.conversion_jobs SET next_attempt_at = now() - interval '1 second'
             WHERE status = 'pending'",
        )
        .execute(&self.admin)
        .await
        .expect("make jobs due");
    }

    /// Simulates the death of the worker holding a job.
    pub async fn expire_leases(&self) {
        sqlx::query(
            "UPDATE yzy_contracts.conversion_jobs SET locked_until = now() - interval '1 second'
             WHERE status = 'processing'",
        )
        .execute(&self.admin)
        .await
        .expect("expire leases");
    }
}

#[derive(Clone)]
pub struct TokenSpec {
    pub sub: String,
    pub email: String,
    pub iss: String,
    pub aud: String,
    pub role: String,
    pub exp_offset_secs: i64,
    pub kid: Option<String>,
    pub key_pem: &'static str,
}

impl TokenSpec {
    pub fn valid(user_id: Uuid) -> Self {
        Self {
            sub: user_id.to_string(),
            email: test_email(user_id),
            iss: ISSUER.to_owned(),
            aud: AUDIENCE.to_owned(),
            role: "authenticated".to_owned(),
            exp_offset_secs: 3600,
            kid: Some(KID.to_owned()),
            key_pem: SIGNING_KEY,
        }
    }

    pub fn sign(&self) -> String {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_secs() as i64;
        let mut header = Header::new(Algorithm::ES256);
        header.kid = self.kid.clone();
        let claims = json!({
            "sub": self.sub, "iss": self.iss, "aud": self.aud, "role": self.role,
            "email": self.email, "iat": now, "exp": now + self.exp_offset_secs,
        });
        encode(
            &header,
            &claims,
            &EncodingKey::from_ec_pem(self.key_pem.as_bytes()).expect("key"),
        )
        .expect("sign")
    }
}

pub fn test_email(id: Uuid) -> String {
    if id == ADMIN_ID {
        "admin@ejemplo.test".to_owned()
    } else {
        format!("{id}@ejemplo.test")
    }
}

pub fn token_for(user_id: Uuid) -> String {
    TokenSpec::valid(user_id).sign()
}

/// A response in doc-extractor-api's format that echoes the request's job id.
pub fn extract_response(
    markdown: &str,
    page_count: Option<i32>,
    warnings: Value,
) -> impl Fn(&wiremock::Request) -> ResponseTemplate + use<> {
    let markdown = markdown.to_owned();
    move |request: &wiremock::Request| {
        let sent: Value = request.body_json().expect("request body");
        ResponseTemplate::new(200).set_body_json(json!({
            "job_id": sent["job_id"],
            "status": "completed",
            "document": {
                "filename": sent["document"]["filename"],
                "content_type": sent["document"]["content_type"],
                "page_count": page_count,
            },
            "extraction": {
                "markdown": markdown,
                "metadata": {"tables_detected": 0, "ocr_used": false, "duration_ms": 1},
                "warnings": warnings,
            },
        }))
    }
}

pub fn error_code(body: &Value) -> &str {
    body["error"]["code"].as_str().unwrap_or("<no code>")
}
