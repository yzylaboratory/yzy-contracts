use std::{sync::Arc, time::Duration};

use anyhow::Context;
use axum::{
    Router,
    extract::{DefaultBodyLimit, MatchedPath, Request, State},
    http::{HeaderName, HeaderValue, Method, header},
    middleware::{self, Next},
    response::Response,
};
use tower::ServiceBuilder;
use tower_http::{
    cors::{AllowOrigin, CorsLayer},
    request_id::{MakeRequestUuid, PropagateRequestIdLayer, SetRequestIdLayer},
    sensitive_headers::SetSensitiveRequestHeadersLayer,
    trace::TraceLayer,
};
use utoipa::{
    Modify, OpenApi,
    openapi::{
        OpenApi as OpenApiDocument,
        security::{HttpAuthScheme, HttpBuilder, SecurityScheme},
    },
};
use utoipa_axum::router::OpenApiRouter;
use utoipa_swagger_ui::SwaggerUi;

use crate::{
    app_state::AppState,
    error::{ApiError, ErrorEnvelope},
    modules::{
        access, auth, billing, clients, companies, contracts, conversions, document_readings,
        files, generated_documents, mobile, prospects, system, templates,
    },
};

const REQUEST_ID_HEADER: HeaderName = HeaderName::from_static("x-request-id");
/// Room for the JSON envelope around a template of the maximum size.
const JSON_ENVELOPE_BYTES: usize = 64 * 1024;

#[derive(OpenApi)]
#[openapi(
    info(
        title = "YZY Contracts API",
        version = "0.1.0",
        description = "Contract management: register original Word templates with variables, convert PDFs to editable templates, and generate documents. Private routes require the configured superadministrator or a person the superadministrator enabled."
    ),
    tags(
        (name = "System", description = "Service health"),
        (name = "Users", description = "The authenticated user"),
        (name = "Administration", description = "Company access and invitations"),
        (name = "Clients", description = "Global client directory and company-scoped case files for enabled people"),
        (name = "Prospects", description = "Self-registration links shared with prospects, and the people who submit through them before a case file exists"),
        (name = "Companies", description = "Reusable company details owned by the authenticated account"),
        (name = "Files", description = "Direct uploads to private storage"),
        (name = "Contracts", description = "Contract records owned by the authenticated user"),
        (name = "Conversions", description = "Asynchronous PDF and DOCX to Markdown conversions"),
        (name = "Templates", description = "Original Word templates with variables and legacy editable templates"),
        (name = "Generated documents", description = "Saved exports and statistics for the authenticated account"),
        (name = "Billing", description = "Monthly company billing and bank transfers"),
        (name = "Document readings", description = "Structured JSON read from photos or PDFs of identity cards, vehicle registrations and bills of lading")
    ),
    components(schemas(ErrorEnvelope)),
    modifiers(&BearerSecurity)
)]
struct ApiDoc;

struct BearerSecurity;

impl Modify for BearerSecurity {
    fn modify(&self, openapi: &mut OpenApiDocument) {
        let components = openapi.components.get_or_insert_with(Default::default);
        components.add_security_scheme(
            "bearer_auth",
            SecurityScheme::Http(
                HttpBuilder::new()
                    .scheme(HttpAuthScheme::Bearer)
                    .bearer_format("JWT")
                    .description(Some("Supabase Auth access token"))
                    .build(),
            ),
        );
    }
}

fn public_routes() -> OpenApiRouter<AppState> {
    OpenApiRouter::with_openapi(ApiDoc::openapi())
        .merge(system::router())
        .merge(mobile::router())
        .merge(prospects::public_router())
}

fn business_routes(template_max_bytes: usize, upload_max_bytes: i64) -> OpenApiRouter<AppState> {
    OpenApiRouter::new()
        .merge(auth::onboarding_router())
        .merge(clients::router())
        .merge(files::router())
        .merge(contracts::router(upload_max_bytes))
        .merge(conversions::router())
        .merge(document_readings::router())
        .merge(prospects::router())
        .merge(templates::router())
        .merge(generated_documents::router(
            template_max_bytes,
            upload_max_bytes,
        ))
}

/// The document needs no runtime state, so the committed spec can be generated
/// without any configuration.
pub fn openapi() -> OpenApiDocument {
    // Route limits are unused when only the document is built.
    let (_, document) = public_routes()
        .merge(auth::router())
        .merge(access::admin_router())
        .merge(billing::router())
        .merge(billing::admin_router())
        .merge(companies::router())
        .merge(business_routes(0, 0))
        .split_for_parts();
    document
}

pub fn build_router(state: AppState) -> anyhow::Result<Router> {
    let config = Arc::clone(&state.config);

    // route_layer on the whole group: a new private route cannot forget auth.
    let private = business_routes(config.template_max_bytes, config.upload_max_bytes)
        .route_layer(middleware::from_fn_with_state(
            state.clone(),
            access::observe_action,
        ))
        .merge(companies::router())
        .merge(access::admin_router().route_layer(middleware::from_fn(access::require_admin)))
        .merge(billing::admin_router().route_layer(middleware::from_fn(access::require_admin)))
        .merge(billing::router())
        .merge(auth::router())
        .route_layer(middleware::from_fn_with_state(
            state.clone(),
            auth::middleware::require_auth,
        ));
    let private = private.route_layer(middleware::from_fn(access::no_store));
    let (router, document) = public_routes().merge(private).split_for_parts();

    let origins = config
        .cors_allowed_origins
        .iter()
        .map(|origin| HeaderValue::from_str(origin))
        .collect::<Result<Vec<_>, _>>()
        .context("CORS_ALLOWED_ORIGINS contains an invalid origin")?;
    let cors = CorsLayer::new()
        .allow_origin(AllowOrigin::list(origins))
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::PUT,
            Method::PATCH,
            Method::DELETE,
        ])
        .allow_headers([header::AUTHORIZATION, header::CONTENT_TYPE])
        .max_age(Duration::from_secs(600));

    let router = router
        .layer(middleware::from_fn_with_state(
            state.clone(),
            enforce_timeout,
        ))
        .merge(SwaggerUi::new("/swagger-ui").url("/api-docs/openapi.json", document))
        .fallback(route_not_found)
        .with_state(state)
        .layer(DefaultBodyLimit::max(
            config.template_max_bytes + JSON_ENVELOPE_BYTES,
        ))
        .layer(
            ServiceBuilder::new()
                .layer(SetSensitiveRequestHeadersLayer::new([
                    header::AUTHORIZATION,
                ]))
                .layer(SetRequestIdLayer::new(REQUEST_ID_HEADER, MakeRequestUuid))
                .layer(
                    TraceLayer::new_for_http()
                        .make_span_with(|request: &Request| {
                            let route = request
                                .extensions()
                                .get::<MatchedPath>()
                                .map(MatchedPath::as_str)
                                .unwrap_or("unmatched");
                            let request_id = request
                                .headers()
                                .get(&REQUEST_ID_HEADER)
                                .and_then(|value| value.to_str().ok())
                                .and_then(|value| uuid::Uuid::parse_str(value).ok());
                            tracing::info_span!(
                                "http",
                                method = %request.method(),
                                route,
                                request_id = tracing::field::display(
                                    request_id.map(|id| id.to_string()).unwrap_or_default(),
                                ),
                            )
                        })
                        .on_response(
                            |response: &Response, latency: Duration, span: &tracing::Span| {
                                tracing::info!(
                                    parent: span,
                                    status = response.status().as_u16(),
                                    latency_ms = latency.as_secs_f64() * 1000.0,
                                    "http response"
                                );
                            },
                        ),
                )
                .layer(PropagateRequestIdLayer::new(REQUEST_ID_HEADER))
                .layer(cors),
        );
    Ok(router)
}

async fn enforce_timeout(
    State(state): State<AppState>,
    request: Request,
    next: Next,
) -> Result<Response, ApiError> {
    // A model reading takes longer than a regular request; its HTTP client
    // carries its own limit (OPENROUTER_TIMEOUT_SECS).
    let is_reading = request
        .extensions()
        .get::<MatchedPath>()
        .is_some_and(|path| path.as_str() == document_readings::PATH);
    if is_reading {
        return Ok(next.run(request).await);
    }
    tokio::time::timeout(state.config.request_timeout, next.run(request))
        .await
        .map_err(|_| ApiError::Timeout)
}

async fn route_not_found() -> ApiError {
    ApiError::RouteNotFound
}
