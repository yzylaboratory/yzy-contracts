use std::{
    collections::HashMap,
    time::{Duration, Instant},
};

use anyhow::Context;
use jsonwebtoken::{
    Algorithm, DecodingKey, Validation, decode, decode_header,
    jwk::{JwkSet, KeyAlgorithm},
};
use serde::Deserialize;
use tokio::sync::RwLock;
use uuid::Uuid;

use crate::config::JwtConfig;

/// Supabase signing-key algorithms this API accepts. Symmetric algorithms are
/// excluded on purpose: this service holds no shared secret.
const ALLOWED_ALGORITHMS: [Algorithm; 2] = [Algorithm::ES256, Algorithm::RS256];
const KEYS_TTL: Duration = Duration::from_secs(600);
/// A token with an unknown `kid` may mean a rotation, but must not let anyone
/// force a JWKS request per attempt.
const MIN_REFRESH_INTERVAL: Duration = Duration::from_secs(30);
const JWKS_TIMEOUT: Duration = Duration::from_secs(5);
const REQUIRED_ROLE: &str = "authenticated";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VerifiedToken {
    pub user_id: Uuid,
    pub email: Option<String>,
}

#[derive(Debug, PartialEq, Eq, thiserror::Error)]
pub enum JwtError {
    #[error("the token is invalid")]
    Invalid,
    #[error("the signing keys are unavailable")]
    KeysUnavailable,
}

#[derive(Debug, Deserialize)]
struct Claims {
    sub: Uuid,
    role: String,
    email: Option<String>,
}

#[derive(Default)]
struct KeyCache {
    keys: HashMap<String, CachedKey>,
    fetched_at: Option<Instant>,
}

struct CachedKey {
    key: DecodingKey,
    algorithm: Algorithm,
}

pub struct JwtVerifier {
    http: reqwest::Client,
    config: JwtConfig,
    cache: RwLock<KeyCache>,
}

impl JwtVerifier {
    pub fn new(config: JwtConfig) -> anyhow::Result<Self> {
        let http = reqwest::Client::builder()
            .timeout(JWKS_TIMEOUT)
            .build()
            .context("could not build the JWKS HTTP client")?;
        Ok(Self {
            http,
            config,
            cache: RwLock::new(KeyCache::default()),
        })
    }

    pub async fn verify(&self, token: &str) -> Result<VerifiedToken, JwtError> {
        let header = decode_header(token).map_err(|_| JwtError::Invalid)?;
        if !ALLOWED_ALGORITHMS.contains(&header.alg) {
            return Err(JwtError::Invalid);
        }
        let kid = header.kid.ok_or(JwtError::Invalid)?;

        let mut validation = Validation::new(header.alg);
        validation.set_required_spec_claims(&["exp", "iss", "aud", "sub"]);
        validation.set_issuer(&[&self.config.issuer]);
        validation.set_audience(&[&self.config.audience]);

        self.refresh_if_stale(&kid).await?;
        let cache = self.cache.read().await;
        let cached = cache.keys.get(&kid).ok_or(JwtError::Invalid)?;
        // The key dictates the algorithm: a token cannot pick a different one.
        if cached.algorithm != header.alg {
            return Err(JwtError::Invalid);
        }
        let claims = decode::<Claims>(token, &cached.key, &validation)
            .map_err(|_| JwtError::Invalid)?
            .claims;
        // Supabase also signs anon and service_role tokens; neither is a user.
        if claims.role != REQUIRED_ROLE {
            return Err(JwtError::Invalid);
        }
        Ok(VerifiedToken {
            user_id: claims.sub,
            email: claims.email,
        })
    }

    async fn refresh_if_stale(&self, kid: &str) -> Result<(), JwtError> {
        {
            let cache = self.cache.read().await;
            if let Some(fetched_at) = cache.fetched_at
                && fetched_at.elapsed() < KEYS_TTL
                && (cache.keys.contains_key(kid) || fetched_at.elapsed() < MIN_REFRESH_INTERVAL)
            {
                return Ok(());
            }
        }

        let mut cache = self.cache.write().await;
        // Another request may have refreshed while this one waited for the lock.
        if let Some(fetched_at) = cache.fetched_at
            && fetched_at.elapsed() < MIN_REFRESH_INTERVAL
        {
            return Ok(());
        }
        // A failed refresh drops the old keys: past the TTL a revoked key must
        // stop working, so verification fails closed.
        cache.keys.clear();
        cache.fetched_at = None;
        let keys = self.fetch_keys().await.map_err(|error| {
            tracing::error!(error = format!("{error:#}"), "could not refresh the JWKS");
            JwtError::KeysUnavailable
        })?;
        cache.keys = keys;
        cache.fetched_at = Some(Instant::now());
        Ok(())
    }

    async fn fetch_keys(&self) -> anyhow::Result<HashMap<String, CachedKey>> {
        let set: JwkSet = self
            .http
            .get(&self.config.jwks_url)
            .send()
            .await
            .context("the JWKS request failed")?
            .error_for_status()
            .context("the JWKS endpoint returned an error")?
            .json()
            .await
            .context("the JWKS response is not valid")?;

        let mut keys = HashMap::new();
        for jwk in &set.keys {
            let Some(kid) = jwk.common.key_id.clone() else {
                continue;
            };
            let algorithm = match jwk.common.key_algorithm {
                Some(KeyAlgorithm::ES256) => Algorithm::ES256,
                Some(KeyAlgorithm::RS256) => Algorithm::RS256,
                _ => continue,
            };
            let key = DecodingKey::from_jwk(jwk).context("the JWKS contains an invalid key")?;
            keys.insert(kid, CachedKey { key, algorithm });
        }
        Ok(keys)
    }
}
