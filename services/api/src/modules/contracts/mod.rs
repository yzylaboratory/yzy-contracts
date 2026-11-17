pub mod dto;
pub mod handlers;
pub(crate) mod native_word;
pub(crate) mod render;
pub mod repository;

use axum::extract::DefaultBodyLimit;
use utoipa_axum::{
    router::{OpenApiRouter, UtoipaMethodRouterExt},
    routes,
};

use crate::{
    app_state::AppState,
    modules::{billing, files::validation::artifact_max_bytes},
};

pub fn router(upload_max_bytes: i64) -> OpenApiRouter<AppState> {
    OpenApiRouter::new()
        .routes(routes!(handlers::list_contracts, handlers::create_contract))
        .routes(routes!(
            handlers::get_contract,
            handlers::update_contract,
            handlers::delete_contract
        ))
        .routes(routes!(handlers::get_download_url))
        .routes(routes!(billing::generation_access))
        .routes(
            routes!(render::render_pdf)
                .layer(DefaultBodyLimit::max(artifact_max_bytes(upload_max_bytes))),
        )
}
