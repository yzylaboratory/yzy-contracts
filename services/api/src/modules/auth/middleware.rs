use axum::{
    extract::{Request, State},
    http::{HeaderMap, header},
    middleware::Next,
    response::Response,
};
use sqlx::PgPool;
use uuid::Uuid;

use super::jwt::JwtError;
use crate::{app_state::AppState, error::ApiError};

/// The verified caller, inserted by [`require_auth`] on every private route.
#[derive(Debug, Clone)]
pub struct AuthUser {
    pub id: Uuid,
    pub email: Option<String>,
    pub superadmin: bool,
    /// The superadministrator enabled this person. Enabled people work in every active company.
    pub enabled: bool,
}

pub async fn require_auth(
    State(state): State<AppState>,
    mut request: Request,
    next: Next,
) -> Result<Response, ApiError> {
    let token = bearer_token(request.headers()).ok_or(ApiError::Unauthenticated)?;
    let verified = state.jwt.verify(token).await.map_err(|error| match error {
        JwtError::Invalid => ApiError::Unauthenticated,
        JwtError::KeysUnavailable => ApiError::AuthUnavailable,
    })?;
    let superadmin = state.config.superadmin_id == Some(verified.user_id);
    let email = crate::modules::access::confirmed_email(&state.db, verified.user_id)
        .await?
        .filter(|email| {
            verified
                .email
                .as_ref()
                .is_some_and(|signed| email.eq_ignore_ascii_case(signed))
        });
    if superadmin
        && !email
            .as_deref()
            .zip(state.config.superadmin_email.as_deref())
            .is_some_and(|(confirmed, configured)| confirmed.eq_ignore_ascii_case(configured))
    {
        return Err(ApiError::AdminRequired);
    }
    ensure_active_profile(&state.db, verified.user_id).await?;
    let enabled = superadmin
        || match email.as_deref() {
            Some(email) => record_identity(&state.db, verified.user_id, email).await?,
            None => false,
        };
    // A person waiting for the superadministrator can only read their own status.
    if !enabled && request.uri().path() != "/api/v1/me" {
        return Err(ApiError::AccessPending);
    }
    request.extensions_mut().insert(AuthUser {
        id: verified.user_id,
        email,
        superadmin,
        enabled,
    });
    Ok(next.run(request).await)
}

/// Lists the person for the superadministrator and returns whether access is enabled.
async fn record_identity(db: &PgPool, user_id: Uuid, email: &str) -> Result<bool, ApiError> {
    Ok(sqlx::query_scalar(
        "INSERT INTO yzy_contracts.access_identities (user_id, email, requested_at)
         VALUES ($1, $2, now())
         ON CONFLICT (user_id) DO UPDATE SET email = EXCLUDED.email,
           requested_at = COALESCE(yzy_contracts.access_identities.requested_at, EXCLUDED.requested_at)
         RETURNING enabled_at IS NOT NULL AND NOT suspended",
    )
    .bind(user_id)
    .bind(email)
    .fetch_one(db)
    .await?)
}

fn bearer_token(headers: &HeaderMap) -> Option<&str> {
    let value = headers.get(header::AUTHORIZATION)?.to_str().ok()?;
    let (scheme, token) = value.split_once(' ')?;
    (scheme.eq_ignore_ascii_case("bearer") && !token.is_empty()).then_some(token)
}

/// The login is shared across YZY products, so enrollment is per product. A
/// tombstoned Contracts account keeps its login but loses access here.
async fn ensure_active_profile(db: &PgPool, user_id: Uuid) -> Result<(), ApiError> {
    let status: Option<String> =
        sqlx::query_scalar("SELECT account_status FROM yzy_contracts.profiles WHERE user_id = $1")
            .bind(user_id)
            .fetch_optional(db)
            .await?;

    let status = match status {
        Some(status) => status,
        None => {
            let inserted = sqlx::query(
                "INSERT INTO yzy_contracts.profiles (user_id) VALUES ($1)
                 ON CONFLICT (user_id) DO NOTHING",
            )
            .bind(user_id)
            .execute(db)
            .await;
            if let Err(error) = inserted {
                // A valid signature for a subject missing from auth.users.
                if error
                    .as_database_error()
                    .is_some_and(|db_error| db_error.is_foreign_key_violation())
                {
                    return Err(ApiError::Unauthenticated);
                }
                return Err(error.into());
            }
            sqlx::query_scalar(
                "SELECT account_status FROM yzy_contracts.profiles WHERE user_id = $1",
            )
            .bind(user_id)
            .fetch_one(db)
            .await?
        }
    };

    if status == "active" {
        Ok(())
    } else {
        Err(ApiError::AccountDeleted)
    }
}
