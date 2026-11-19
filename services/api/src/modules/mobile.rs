//! Public download of the Android app. The signed APK lives in the product bucket;
//! this endpoint only redirects to a short-lived download URL for it.

use std::time::Duration;

use axum::{
    extract::State,
    http::{HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
};

use crate::{
    app_state::AppState,
    error::{ApiError, ErrorEnvelope},
};
use utoipa_axum::{router::OpenApiRouter, routes};

/// Object key of the current Android release in the product bucket.
pub const ANDROID_APK_KEY: &str = "mobile/android/yzy-contracts.apk";
const ANDROID_APK_FILE_NAME: &str = "yzy-contracts.apk";
const DOWNLOAD_URL_TTL: Duration = Duration::from_secs(10 * 60);

pub fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new().routes(routes!(android_download))
}

/// Redirects to a temporary download URL for the current Android app.
#[utoipa::path(
    get,
    path = "/api/v1/mobile/android",
    tag = "Mobile",
    responses(
        (status = 302, description = "Redirect to a temporary download URL for the APK"),
        (status = 404, description = "No Android release has been published", body = ErrorEnvelope),
        (status = 503, description = "Storage is unavailable", body = ErrorEnvelope),
    )
)]
pub async fn android_download(State(state): State<AppState>) -> Result<Response, ApiError> {
    let exists = state.storage.head(ANDROID_APK_KEY).await.map_err(|error| {
        tracing::error!(
            error = format!("{error:#}"),
            "could not read the Android release"
        );
        ApiError::Unavailable
    })?;
    if exists.is_none() {
        return Err(ApiError::AppDownloadNotFound);
    }
    let url = state
        .storage
        .presign_get(
            ANDROID_APK_KEY,
            Some(ANDROID_APK_FILE_NAME),
            DOWNLOAD_URL_TTL,
        )
        .await
        .map_err(|error| {
            tracing::error!(
                error = format!("{error:#}"),
                "could not sign the Android download"
            );
            ApiError::Unavailable
        })?;
    let location = HeaderValue::from_str(&url).map_err(|_| ApiError::Unavailable)?;
    Ok((
        StatusCode::FOUND,
        [
            (header::LOCATION, location),
            (header::CACHE_CONTROL, HeaderValue::from_static("no-store")),
        ],
    )
        .into_response())
}
