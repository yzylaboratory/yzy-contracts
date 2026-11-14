use std::{env, fmt, net::SocketAddr, str::FromStr, time::Duration};

use anyhow::{Context, bail};

use crate::modules::billing::dto::BankAccount;

/// Required values stop startup if missing. Optional features are explicitly
/// disabled until their configuration is provided.
#[derive(Clone)]
pub struct Config {
    pub http_bind_addr: SocketAddr,
    pub database_url: String,
    pub database_max_connections: u32,
    pub jwt: JwtConfig,
    pub superadmin_id: Option<uuid::Uuid>,
    pub superadmin_email: Option<String>,
    pub billing_bank_account: Option<BankAccount>,
    pub cors_allowed_origins: Vec<String>,
    pub r2: R2Config,
    pub upload_max_bytes: i64,
    pub presign_upload_ttl: Duration,
    pub presign_download_ttl: Duration,
    pub template_max_bytes: usize,
    pub extractor: ExtractorConfig,
    pub conversion_max_attempts: i32,
    pub worker_poll_interval: Duration,
    pub request_timeout: Duration,
}

#[derive(Clone)]
pub struct JwtConfig {
    pub jwks_url: String,
    pub issuer: String,
    pub audience: String,
}

#[derive(Clone)]
pub struct R2Config {
    pub endpoint: String,
    pub bucket: String,
    pub access_key_id: String,
    pub secret_access_key: String,
    pub force_path_style: bool,
}

#[derive(Clone)]
pub struct ExtractorConfig {
    pub url: String,
    pub api_token: String,
    pub timeout: Duration,
}

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        let upload_max_bytes: i64 = parse("UPLOAD_MAX_BYTES")?;
        if upload_max_bytes <= 0 {
            bail!("UPLOAD_MAX_BYTES must be positive");
        }
        let conversion_max_attempts: i32 = parse("CONVERSION_MAX_ATTEMPTS")?;
        if conversion_max_attempts < 1 {
            bail!("CONVERSION_MAX_ATTEMPTS must be at least 1");
        }
        let cors_allowed_origins = required("CORS_ALLOWED_ORIGINS")?
            .split(',')
            .map(|origin| origin.trim().to_owned())
            .filter(|origin| !origin.is_empty())
            .collect::<Vec<_>>();
        if cors_allowed_origins.is_empty() {
            bail!("CORS_ALLOWED_ORIGINS must list at least one origin");
        }
        if cors_allowed_origins.iter().any(|origin| origin == "*") {
            bail!("CORS_ALLOWED_ORIGINS must list explicit origins, not *");
        }

        Ok(Self {
            http_bind_addr: parse("HTTP_BIND_ADDR")?,
            database_url: required("DATABASE_URL")?,
            database_max_connections: parse("DATABASE_MAX_CONNECTIONS")?,
            jwt: JwtConfig {
                jwks_url: required("SUPABASE_JWKS_URL")?,
                issuer: required("SUPABASE_JWT_ISSUER")?,
                audience: required("SUPABASE_JWT_AUDIENCE")?,
            },
            superadmin_id: env::var("CONTRACTS_SUPERADMIN_ID")
                .ok()
                .filter(|value| !value.is_empty())
                .map(|value| value.parse())
                .transpose()
                .context("CONTRACTS_SUPERADMIN_ID must be a UUID")?,
            superadmin_email: env::var("CONTRACTS_SUPERADMIN_EMAIL")
                .ok()
                .map(|value| value.trim().to_owned())
                .filter(|value| !value.is_empty()),
            billing_bank_account: billing_bank_account(),
            cors_allowed_origins,
            r2: R2Config {
                endpoint: required("R2_ENDPOINT")?,
                bucket: required("R2_BUCKET")?,
                access_key_id: required("R2_ACCESS_KEY_ID")?,
                secret_access_key: required("R2_SECRET_ACCESS_KEY")?,
                force_path_style: parse("R2_FORCE_PATH_STYLE")?,
            },
            upload_max_bytes,
            presign_upload_ttl: seconds("PRESIGN_UPLOAD_TTL_SECS")?,
            presign_download_ttl: seconds("PRESIGN_DOWNLOAD_TTL_SECS")?,
            template_max_bytes: parse("TEMPLATE_MAX_BYTES")?,
            extractor: ExtractorConfig {
                url: required("EXTRACTOR_URL")?,
                api_token: required("EXTRACTOR_API_TOKEN")?,
                timeout: seconds("EXTRACTOR_TIMEOUT_SECS")?,
            },
            conversion_max_attempts,
            worker_poll_interval: seconds("WORKER_POLL_INTERVAL_SECS")?,
            request_timeout: seconds("REQUEST_TIMEOUT_SECS")?,
        })
    }
}

/// Secrets must not reach logs through a stray `{:?}`.
impl fmt::Debug for Config {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Config")
            .field("http_bind_addr", &self.http_bind_addr)
            .field("jwks_url", &self.jwt.jwks_url)
            .field("r2_bucket", &self.r2.bucket)
            .field("extractor_url", &self.extractor.url)
            .finish_non_exhaustive()
    }
}

fn billing_bank_account() -> Option<BankAccount> {
    let [bank_name, account_holder, account_type, account_number] = [
        "CONTRACTS_BILLING_BANK_NAME",
        "CONTRACTS_BILLING_ACCOUNT_HOLDER",
        "CONTRACTS_BILLING_ACCOUNT_TYPE",
        "CONTRACTS_BILLING_ACCOUNT_NUMBER",
    ]
    .map(|name| {
        env::var(name)
            .ok()
            .map(|value| value.trim().to_owned())
            .filter(|value| !value.is_empty())
    });
    match (bank_name, account_holder, account_type, account_number) {
        (None, None, None, None) => None,
        (Some(bank_name), Some(account_holder), Some(account_type), Some(account_number)) => {
            Some(BankAccount {
                bank_name,
                account_holder,
                account_type,
                account_number,
            })
        }
        _ => {
            tracing::warn!(
                "Billing transfer destination unavailable: configure all four CONTRACTS_BILLING_* bank variables"
            );
            None
        }
    }
}

fn required(name: &str) -> anyhow::Result<String> {
    let value = env::var(name).with_context(|| format!("{name} is required"))?;
    if value.trim().is_empty() {
        bail!("{name} must not be empty");
    }
    Ok(value)
}

fn parse<T>(name: &str) -> anyhow::Result<T>
where
    T: FromStr,
    T::Err: std::error::Error + Send + Sync + 'static,
{
    required(name)?
        .parse()
        .with_context(|| format!("{name} has an invalid value"))
}

fn seconds(name: &str) -> anyhow::Result<Duration> {
    let value: u64 = parse(name)?;
    if value == 0 {
        bail!("{name} must be positive");
    }
    Ok(Duration::from_secs(value))
}
