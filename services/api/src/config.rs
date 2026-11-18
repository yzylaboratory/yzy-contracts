use std::{collections::BTreeSet, env, fmt, net::SocketAddr, str::FromStr, time::Duration};

use anyhow::{Context, bail};

use uuid::Uuid;

use crate::{infrastructure::schema::DatabaseSchema, modules::billing::dto::BankAccount};

/// Required values stop startup if missing. Optional features are explicitly
/// disabled until their configuration is provided.
#[derive(Clone)]
pub struct Config {
    pub http_bind_addr: SocketAddr,
    pub database_url: String,
    pub database_max_connections: u32,
    /// Product schema and runtime role, from CONTRACTS_DATABASE_SCHEMA.
    pub database_schema: DatabaseSchema,
    /// From CONTRACTS_ALLOWED_USER_IDS. When set, only these accounts may reach the API.
    pub allowed_user_ids: Option<BTreeSet<Uuid>>,
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
    pub billing_mail: Option<BillingMailConfig>,
}

#[derive(Clone)]
pub struct BillingMailConfig {
    /// Base URL of yzy-notifications (no trailing slash), e.g. http://yzy-notifications:3000
    pub notifications_url: String,
    pub service_token: String,
    /// Allowlisted product id in yzy-notifications PRODUCT_FROM_JSON.
    pub product: String,
    pub portal_url: String,
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
    pub internal_endpoint: Option<String>,
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

        let database_schema = DatabaseSchema::from_env()?;
        let allowed_user_ids = allowed_user_ids()?;
        let superadmin_id: Option<Uuid> = env::var("CONTRACTS_SUPERADMIN_ID")
            .ok()
            .filter(|value| !value.is_empty())
            .map(|value| value.parse())
            .transpose()
            .context("CONTRACTS_SUPERADMIN_ID must be a UUID")?;
        check_access_policy(database_schema, superadmin_id, allowed_user_ids.as_ref())?;

        Ok(Self {
            http_bind_addr: parse("HTTP_BIND_ADDR")?,
            database_url: required("DATABASE_URL")?,
            database_max_connections: parse("DATABASE_MAX_CONNECTIONS")?,
            database_schema,
            allowed_user_ids,
            jwt: JwtConfig {
                jwks_url: required("SUPABASE_JWKS_URL")?,
                issuer: required("SUPABASE_JWT_ISSUER")?,
                audience: required("SUPABASE_JWT_AUDIENCE")?,
            },
            superadmin_id,
            superadmin_email: env::var("CONTRACTS_SUPERADMIN_EMAIL")
                .ok()
                .map(|value| value.trim().to_owned())
                .filter(|value| !value.is_empty()),
            billing_bank_account: billing_bank_account(),
            cors_allowed_origins,
            r2: R2Config {
                endpoint: required("R2_ENDPOINT")?,
                internal_endpoint: env::var("R2_INTERNAL_ENDPOINT")
                    .ok()
                    .filter(|value| !value.trim().is_empty()),
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
            billing_mail: billing_mail_config()?,
        })
    }
}

/// DEV must name its accounts. The superadministrator must be one of them, or
/// the environment could not be administered.
fn check_access_policy(
    schema: DatabaseSchema,
    superadmin_id: Option<Uuid>,
    allowed: Option<&BTreeSet<Uuid>>,
) -> anyhow::Result<()> {
    match (schema, allowed) {
        (DatabaseSchema::Development, None) => bail!(
            "CONTRACTS_ALLOWED_USER_IDS is required when CONTRACTS_DATABASE_SCHEMA is {}",
            schema.name()
        ),
        (_, Some(allowed)) => {
            if let Some(superadmin) = superadmin_id.filter(|id| !allowed.contains(id)) {
                bail!(
                    "CONTRACTS_ALLOWED_USER_IDS must include the superadministrator {superadmin}"
                );
            }
            Ok(())
        }
        (DatabaseSchema::Production, None) => Ok(()),
    }
}

/// Unset means no allowlist. Set but empty is an error, never allow-all.
fn allowed_user_ids() -> anyhow::Result<Option<BTreeSet<Uuid>>> {
    match env::var("CONTRACTS_ALLOWED_USER_IDS") {
        Err(env::VarError::NotPresent) => Ok(None),
        Err(error) => Err(error.into()),
        Ok(value) => parse_allowed_user_ids(&value).map(Some),
    }
}

fn parse_allowed_user_ids(value: &str) -> anyhow::Result<BTreeSet<Uuid>> {
    let mut ids = BTreeSet::new();
    for entry in value.split(',') {
        let id: Uuid = entry
            .trim()
            .parse()
            .context("CONTRACTS_ALLOWED_USER_IDS must be a comma-separated list of UUIDs")?;
        ids.insert(id);
    }
    if ids.is_empty() {
        bail!("CONTRACTS_ALLOWED_USER_IDS must list at least one UUID");
    }
    Ok(ids)
}

fn billing_mail_config() -> anyhow::Result<Option<BillingMailConfig>> {
    let notifications_url = env::var("YZY_NOTIFICATIONS_URL")
        .ok()
        .map(|value| value.trim().trim_end_matches('/').to_owned())
        .filter(|value| !value.is_empty());
    let service_token = env::var("YZY_NOTIFICATIONS_TOKEN")
        .ok()
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty());
    let portal_url = env::var("BILLING_PORTAL_URL")
        .ok()
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty());
    let product = env::var("YZY_NOTIFICATIONS_PRODUCT")
        .ok()
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "yzy-contracts".to_owned());
    match (notifications_url, service_token, portal_url) {
        (None, None, None) => Ok(None),
        (Some(notifications_url), Some(service_token), Some(portal_url)) => {
            Ok(Some(BillingMailConfig {
                notifications_url,
                service_token,
                product,
                portal_url,
            }))
        }
        _ => bail!(
            "Billing mail requires YZY_NOTIFICATIONS_URL, YZY_NOTIFICATIONS_TOKEN and BILLING_PORTAL_URL together"
        ),
    }
}

/// Secrets must not reach logs through a stray `{:?}`.
impl fmt::Debug for Config {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Config")
            .field("http_bind_addr", &self.http_bind_addr)
            .field("database_schema", &self.database_schema.name())
            .field(
                "allowed_users",
                &self.allowed_user_ids.as_ref().map(BTreeSet::len),
            )
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

#[cfg(test)]
mod tests {
    use super::*;

    const SUPERADMIN: &str = "11000000-0000-0000-0000-000000000001";
    const OTHER: &str = "22000000-0000-0000-0000-000000000002";

    fn uuid(value: &str) -> Uuid {
        value.parse().expect("uuid")
    }

    #[test]
    fn allowlist_accepts_a_list_and_rejects_empty_or_invalid_values() {
        let parsed = parse_allowed_user_ids(&format!(" {SUPERADMIN} , {OTHER}")).unwrap();
        assert_eq!(parsed.len(), 2);
        // Malformed entries are errors, not silently dropped.
        assert!(parse_allowed_user_ids(&format!("{OTHER},")).is_err());
        assert!(parse_allowed_user_ids("").is_err());
        assert!(parse_allowed_user_ids(" , ").is_err());
        assert!(parse_allowed_user_ids("not-a-uuid").is_err());
    }

    #[test]
    fn development_requires_an_allowlist_that_includes_the_superadministrator() {
        let superadmin = Some(uuid(SUPERADMIN));
        assert!(
            check_access_policy(DatabaseSchema::Development, superadmin, None).is_err(),
            "DEV without allowlist must fail closed"
        );
        let without_superadmin = parse_allowed_user_ids(OTHER).unwrap();
        assert!(
            check_access_policy(
                DatabaseSchema::Development,
                superadmin,
                Some(&without_superadmin)
            )
            .is_err()
        );
        let with_superadmin = parse_allowed_user_ids(&format!("{SUPERADMIN},{OTHER}")).unwrap();
        assert!(
            check_access_policy(
                DatabaseSchema::Development,
                superadmin,
                Some(&with_superadmin)
            )
            .is_ok()
        );
    }

    #[test]
    fn production_runs_without_an_allowlist_unless_one_is_given() {
        assert!(check_access_policy(DatabaseSchema::Production, None, None).is_ok());
        let only_other = parse_allowed_user_ids(OTHER).unwrap();
        assert!(
            check_access_policy(
                DatabaseSchema::Production,
                Some(uuid(SUPERADMIN)),
                Some(&only_other)
            )
            .is_err()
        );
    }
}
