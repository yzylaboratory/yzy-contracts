use std::sync::Arc;

use anyhow::{Context, bail};
use tokio::{net::TcpListener, sync::watch};
use tracing_subscriber::{EnvFilter, fmt};
use yzy_contracts_api::{
    app,
    app_state::AppState,
    config::Config,
    infrastructure::{
        database, document_renderer::DocumentRenderer, extractor::ExtractorClient,
        openrouter::DocumentReader, schema::DatabaseSchema, storage::R2Storage,
    },
    modules::auth::jwt::JwtVerifier,
    workers::{billing::BillingWorker, conversion::ConversionWorker},
};

const USAGE: &str = "usage: yzy-contracts-api <serve|worker|migrate|openapi|replace-case-word>";

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let command = std::env::args().nth(1).context(USAGE)?;
    match command.as_str() {
        "serve" => serve().await,
        "worker" => worker().await,
        "migrate" => migrate().await,
        "replace-case-word" => {
            let apply = match std::env::args().nth(2).as_deref() {
                Some("--apply") => true,
                Some("--check") => false,
                _ => bail!(
                    "usage: yzy-contracts-api replace-case-word --check|--apply < bundle.json"
                ),
            };
            let config = Config::from_env()?;
            yzy_contracts_api::modules::generated_documents::maintenance::replace_words(
                &config, apply,
            )
            .await
        }
        "openapi" => {
            print!("{}", app::openapi().to_yaml()?);
            Ok(())
        }
        _ => bail!(USAGE),
    }
}

fn init_logging() -> anyhow::Result<()> {
    let filter = EnvFilter::try_from_default_env().context("RUST_LOG is required")?;
    fmt().json().with_env_filter(filter).init();
    Ok(())
}

async fn build_state(config: Config) -> anyhow::Result<AppState> {
    let db = database::connect(&config).await?;
    let storage = R2Storage::new(&config.r2);
    let jwt = JwtVerifier::new(config.jwt.clone())?;
    let document_renderer = DocumentRenderer::from_env(config.request_timeout)?;
    let document_reader = DocumentReader::from_env()?;
    Ok(AppState {
        db,
        storage: Arc::new(storage),
        jwt: Arc::new(jwt),
        document_renderer,
        document_reader,
        config: Arc::new(config),
    })
}

async fn serve() -> anyhow::Result<()> {
    init_logging()?;
    let config = Config::from_env()?;
    config
        .superadmin_id
        .context("CONTRACTS_SUPERADMIN_ID is required to serve the API")?;
    config
        .superadmin_email
        .as_ref()
        .context("CONTRACTS_SUPERADMIN_EMAIL is required to serve the API")?;
    let bind_addr = config.http_bind_addr;
    let state = build_state(config).await?;
    let listener = TcpListener::bind(bind_addr)
        .await
        .with_context(|| format!("could not bind {bind_addr}"))?;
    tracing::info!(%bind_addr, "api listening");
    axum::serve(listener, app::build_router(state)?)
        .with_graceful_shutdown(shutdown_signal())
        .await
        .context("api server failed")
}

async fn worker() -> anyhow::Result<()> {
    init_logging()?;
    let config = Config::from_env()?;
    let extractor = ExtractorClient::new(&config.extractor)?;
    let state = build_state(config).await?;
    let (stop_sender, stop_receiver) = watch::channel(false);
    tokio::spawn(async move {
        shutdown_signal().await;
        let _ = stop_sender.send(true);
    });
    let billing_state = state.clone();
    let conversion = ConversionWorker::new(state, extractor);
    let billing = BillingWorker::new(billing_state);
    let conversion_stop = stop_receiver.clone();
    let billing_stop = stop_receiver;
    let conversion_task = tokio::spawn(async move { conversion.run(conversion_stop).await });
    let billing_task = tokio::spawn(async move { billing.run(billing_stop).await });
    let _ = tokio::join!(conversion_task, billing_task);
    Ok(())
}

/// Applies migrations. Run explicitly with an owner connection, never at API
/// startup: the runtime role has no DDL rights.
async fn migrate() -> anyhow::Result<()> {
    init_logging()?;
    let url =
        std::env::var("MIGRATION_DATABASE_URL").context("MIGRATION_DATABASE_URL is required")?;
    let schema = DatabaseSchema::from_env()?;
    let superadmin_id = std::env::var("CONTRACTS_SUPERADMIN_ID")
        .ok()
        .filter(|id| !id.trim().is_empty())
        .map(|id| id.parse())
        .transpose()
        .context("CONTRACTS_SUPERADMIN_ID must be a UUID")?;
    database::run_migrations(&url, schema, superadmin_id).await?;
    tracing::info!(schema = schema.name(), "migrations applied");
    Ok(())
}

async fn shutdown_signal() {
    let ctrl_c = tokio::signal::ctrl_c();
    let terminate = async {
        match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
            Ok(mut signal) => {
                signal.recv().await;
            }
            Err(error) => {
                tracing::error!(%error, "could not install SIGTERM handler");
                std::future::pending::<()>().await;
            }
        }
    };
    tokio::select! {
        _ = ctrl_c => {}
        _ = terminate => {}
    }
}
