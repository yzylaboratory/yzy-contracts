mod common;

use axum::{
    body::Body,
    http::{Method, Request, StatusCode, header},
};
use common::*;
use tower::ServiceExt;
use yzy_contracts_api::modules::mobile::ANDROID_APK_KEY;

const ANDROID: &str = "/api/v1/mobile/android";

#[tokio::test]
async fn android_download_is_404_until_a_release_is_published() {
    let app = TestApp::start().await;
    let (status, body) = app.request(Method::GET, ANDROID, None, None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(error_code(&body), "APP_DOWNLOAD_NOT_FOUND");
}

#[tokio::test]
async fn android_download_is_public_and_redirects_to_a_temporary_url() {
    let app = TestApp::start().await;
    app.storage.put(
        ANDROID_APK_KEY,
        b"PK\x03\x04apk",
        "application/vnd.android.package-archive",
    );
    let response = app
        .router
        .clone()
        .oneshot(Request::get(ANDROID).body(Body::empty()).expect("request"))
        .await
        .expect("response");
    assert_eq!(response.status(), StatusCode::FOUND);
    let location = response.headers()[header::LOCATION]
        .to_str()
        .expect("location");
    assert!(location.starts_with(&format!("https://storage.test/{ANDROID_APK_KEY}?op=get")));
    assert_eq!(response.headers()[header::CACHE_CONTROL], "no-store");
}
