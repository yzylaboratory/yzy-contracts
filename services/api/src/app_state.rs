use std::sync::Arc;

use sqlx::PgPool;

use crate::{
    config::Config,
    infrastructure::{
        document_renderer::DocumentRenderer, openrouter::DocumentReader, storage::ObjectStorage,
    },
    modules::auth::jwt::JwtVerifier,
};

#[derive(Clone)]
pub struct AppState {
    pub db: PgPool,
    pub storage: Arc<dyn ObjectStorage>,
    pub jwt: Arc<JwtVerifier>,
    pub document_renderer: Option<DocumentRenderer>,
    /// OpenRouter client; `None` until OPENROUTER_API_KEY and OPENROUTER_MODEL are set.
    pub document_reader: Option<DocumentReader>,
    pub config: Arc<Config>,
}
