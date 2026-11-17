use axum::{Extension, Json, extract::State};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use utoipa_axum::{router::OpenApiRouter, routes};
use uuid::Uuid;
use validator::Validate;

use crate::{
    app_state::AppState,
    error::{ApiError, ErrorEnvelope},
    extract::{ApiJson, ApiPath},
    modules::auth::AuthUser,
};

pub fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new().routes(routes!(get_template, update_template))
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow, ToSchema)]
pub struct TemplateResponse {
    pub id: Uuid,
    pub contract_id: Uuid,
    pub owner_id: Uuid,
    #[schema(example = "Contrato de arrendamiento")]
    pub name: String,
    #[schema(example = "# Contrato de arrendamiento\n\n## Primera. Objeto\n\n...")]
    pub content_markdown: String,
    /// Present for an original Word template. Its variables come from the DOCX,
    /// and its content_markdown is empty.
    #[schema(value_type = Option<Vec<NativeVariable>>)]
    pub native_variables: Option<sqlx::types::Json<Vec<NativeVariable>>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct NativeVariable {
    #[schema(example = "cliente_nombre")]
    pub key: String,
    #[schema(example = 2)]
    pub occurrences: u32,
}

#[derive(Debug, Deserialize, Validate, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct UpdateTemplateRequest {
    #[validate(length(min = 1, max = 200))]
    #[schema(example = "Contrato de arrendamiento")]
    pub name: String,
    #[schema(example = "# Contrato de arrendamiento\n\n## Primera. Objeto\n\n...")]
    pub content_markdown: String,
}

/// Returns one of the caller's templates. Native Word templates expose their
/// variable manifest and an empty content_markdown; earlier templates retain
/// their existing Markdown and have native_variables set to null.
#[utoipa::path(
    get,
    path = "/api/v1/templates/{id}",
    tag = "Templates",
    security(("bearer_auth" = [])),
    params(("id" = Uuid, Path, description = "Template ID")),
    responses(
        (status = 200, description = "The template", body = TemplateResponse),
        (status = 401, description = "Missing or invalid token", body = ErrorEnvelope,
            example = json!({"error": {"code": "UNAUTHENTICATED", "message": "Authentication is required"}})),
        (status = 404, description = "The template does not exist or belongs to another user", body = ErrorEnvelope,
            example = json!({"error": {"code": "TEMPLATE_NOT_FOUND", "message": "Template not found"}})),
    )
)]
pub async fn get_template(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
    ApiPath(id): ApiPath<Uuid>,
) -> Result<Json<TemplateResponse>, ApiError> {
    sqlx::query_as(
        "SELECT t.id, t.contract_id, t.owner_id, t.name, t.content_markdown, t.native_variables, t.created_at, t.updated_at
         FROM yzy_contracts.templates t JOIN yzy_contracts.contracts c ON c.id = t.contract_id
         WHERE t.id = $2 AND c.deleted_at IS NULL
           AND yzy_contracts.can_read_contract($1, c.owner_id, c.company_id, c.shared_company_ids, c.catalog_key)",
    )
    .bind(user.id)
    .bind(id)
    .fetch_optional(&state.db)
    .await?
    .map(Json)
    .ok_or(ApiError::TemplateNotFound)
}

/// Replaces a template's name and legacy Markdown. Native Word templates accept
/// name changes with empty content_markdown; their source and manifest stay fixed.
#[utoipa::path(
    put,
    path = "/api/v1/templates/{id}",
    tag = "Templates",
    security(("bearer_auth" = [])),
    params(("id" = Uuid, Path, description = "Template ID")),
    request_body(content = UpdateTemplateRequest, example = json!({
        "name": "Contrato de arrendamiento",
        "content_markdown": "# Contrato de arrendamiento\n\n## Primera. Objeto\n\n..."
    })),
    responses(
        (status = 200, description = "The updated template", body = TemplateResponse),
        (status = 401, description = "Missing or invalid token", body = ErrorEnvelope,
            example = json!({"error": {"code": "UNAUTHENTICATED", "message": "Authentication is required"}})),
        (status = 404, description = "The template does not exist or belongs to another user", body = ErrorEnvelope,
            example = json!({"error": {"code": "TEMPLATE_NOT_FOUND", "message": "Template not found"}})),
        (status = 413, description = "The content exceeds the size limit", body = ErrorEnvelope,
            example = json!({"error": {"code": "PAYLOAD_TOO_LARGE", "message": "The request body is too large"}})),
        (status = 422, description = "The request is invalid", body = ErrorEnvelope,
            example = json!({"error": {"code": "VALIDATION_ERROR", "message": "Invalid value for: name"}})),
    )
)]
pub async fn update_template(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
    ApiPath(id): ApiPath<Uuid>,
    ApiJson(body): ApiJson<UpdateTemplateRequest>,
) -> Result<Json<TemplateResponse>, ApiError> {
    if body.content_markdown.len() > state.config.template_max_bytes {
        return Err(ApiError::PayloadTooLarge);
    }
    let name = body.name.trim();
    if name.is_empty() || name.contains('\0') {
        return Err(ApiError::Validation("Invalid value for: name".to_owned()));
    }
    // PostgreSQL text cannot hold NUL. Reject it rather than alter the content.
    if body.content_markdown.contains('\0') {
        return Err(ApiError::Validation(
            "Invalid value for: content_markdown".to_owned(),
        ));
    }

    let native: Option<bool> = sqlx::query_scalar(
        "SELECT t.native_variables IS NOT NULL FROM yzy_contracts.templates t
         JOIN yzy_contracts.contracts c ON c.id = t.contract_id
         WHERE t.owner_id = $1 AND t.id = $2 AND c.deleted_at IS NULL AND c.catalog_key IS NULL
           AND yzy_contracts.can_read_contract($1, c.owner_id, c.company_id, c.shared_company_ids, c.catalog_key)",
    )
    .bind(user.id)
    .bind(id)
    .fetch_optional(&state.db)
    .await?;
    if native.ok_or(ApiError::TemplateNotFound)? && !body.content_markdown.is_empty() {
        return Err(ApiError::Validation(
            "Edit native Word variables in the original DOCX".to_owned(),
        ));
    }

    sqlx::query_as(
        "UPDATE yzy_contracts.templates
         SET name = $3, content_markdown = $4
         WHERE owner_id = $1 AND id = $2
           AND EXISTS (SELECT 1 FROM yzy_contracts.contracts c WHERE c.id = templates.contract_id AND c.catalog_key IS NULL
             AND c.deleted_at IS NULL AND yzy_contracts.can_read_contract($1, c.owner_id, c.company_id, c.shared_company_ids, c.catalog_key))
         RETURNING id, contract_id, owner_id, name, content_markdown, native_variables, created_at, updated_at",
    )
    .bind(user.id)
    .bind(id)
    .bind(name)
    .bind(&body.content_markdown)
    .fetch_optional(&state.db)
    .await?
    .map(Json)
    .ok_or(ApiError::TemplateNotFound)
}
