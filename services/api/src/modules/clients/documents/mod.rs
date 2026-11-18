mod catalog;
mod fields;
mod values;

use std::{
    collections::{BTreeMap, HashMap},
    sync::{Arc, LazyLock},
    thread::available_parallelism,
};

use axum::{Extension, Json, extract::State, http::StatusCode};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use tokio::sync::{OwnedSemaphorePermit, Semaphore};
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;
use validator::Validate;

use crate::{
    app_state::AppState,
    error::{ApiError, CaseDocumentErrorEnvelope, ErrorEnvelope, TemplateCandidate},
    extract::{ApiJson, ApiPath, ApiQuery},
    modules::{
        auth::AuthUser,
        billing,
        companies::{Company, repository as company_repository},
        contracts::render::render_pdf_bytes,
        document_fill::{
            CompanyProfile, NativeFill, SaleFormat, fill_native_docx, production_table,
            read_source_paragraphs, sales_commitment,
        },
        files::validation::{FileKind, artifact_max_bytes},
        generated_documents::{
            dto::{DocumentFormat, DocumentMetadata, SaveDocument},
            persist_case_document, replay_case_document,
        },
        templates::NativeVariable,
    },
};

use self::{
    catalog::{CaseDocumentType, TYPES, TemplateMatch, template_match},
    fields::{
        company_field, filename_base, issuer_field, resolve_company_values, validate_and_snapshot,
    },
    values::{
        ANCHOR, CaseValues, Context, OperatorField, OperatorValues, contains_issuer_name,
        is_issuer_name, normalize_operator_values, operator_fields, vehicle_from_case,
    },
};
use super::{
    dto::{Client, Operation, VehicleDocument},
    repository,
};

#[derive(Deserialize, Validate, IntoParams)]
#[serde(deny_unknown_fields)]
#[into_params(parameter_in = Query)]
pub(super) struct AvailableDocumentsQuery {
    company_id: Uuid,
}

#[derive(Clone, Copy, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
enum Availability {
    Ready,
    Ambiguous,
    Missing,
}

#[derive(Serialize, ToSchema)]
pub(super) struct AvailableDocument {
    document_type: CaseDocumentType,
    status: Availability,
    candidates: Vec<TemplateCandidate>,
    #[schema(required = true)]
    latest_generated: Option<LatestGeneratedDocument>,
    operator_fields: &'static [OperatorField],
}

#[derive(Serialize, ToSchema)]
struct LatestGeneratedDocument {
    id: Uuid,
    created_at: DateTime<Utc>,
    format: DocumentFormat,
}

#[derive(Serialize, Deserialize, Validate, ToSchema)]
#[serde(deny_unknown_fields)]
pub(super) struct GenerateCaseDocument {
    company_id: Uuid,
    document_type: CaseDocumentType,
    format: CaseDocumentFormat,
    contract_id: Option<Uuid>,
    /// Operator inputs for this document type. The available-documents response declares the allowed keys.
    /// Text values are limited to 1000 characters after trimming.
    #[serde(default)]
    operator_values: BTreeMap<String, String>,
}

#[derive(Clone, Copy, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
enum CaseDocumentFormat {
    Pdf,
    Docx,
}

impl CaseDocumentFormat {
    fn formats(self) -> (DocumentFormat, FileKind, SaleFormat) {
        match self {
            Self::Pdf => (DocumentFormat::Pdf, FileKind::Pdf, SaleFormat::Pdf),
            Self::Docx => (DocumentFormat::Docx, FileKind::Docx, SaleFormat::Docx),
        }
    }
}

#[utoipa::path(
    get, path = "/api/v1/expedientes/{id}/available-documents", tag = "Clients",
    security(("bearer_auth" = [])),
    params(("id" = Uuid, Path, description = "Case file UUID"), AvailableDocumentsQuery),
    responses(
        (status = 200, description = "Template availability, newest generated document and operator inputs for each catalog type", body = [AvailableDocument]),
        (status = 401, body = ErrorEnvelope),
        (status = 403, body = ErrorEnvelope),
        (status = 404, description = "Company or case outside the active scope", body = ErrorEnvelope),
        (status = 422, body = ErrorEnvelope),
        (status = 504, body = ErrorEnvelope),
    )
)]
pub(super) async fn available_documents(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
    ApiPath(id): ApiPath<Uuid>,
    ApiQuery(query): ApiQuery<AvailableDocumentsQuery>,
) -> Result<Json<Vec<AvailableDocument>>, ApiError> {
    let case = scoped_case(&state.db, user.id, id, query.company_id).await?;
    let (templates, mut latest) = tokio::try_join!(
        load_templates(&state.db, user.id, query.company_id),
        latest_documents(&state.db, query.company_id, id),
    )?;
    Ok(Json(
        TYPES
            .iter()
            .map(|&kind| {
                let candidates = if case.insurance_paid && kind.insurance() {
                    Vec::new()
                } else {
                    candidates(&templates, kind)
                };
                let status = match preferred(&candidates, query.company_id) {
                    Some(_) => Availability::Ready,
                    None if candidates.is_empty() => Availability::Missing,
                    None => Availability::Ambiguous,
                };
                AvailableDocument {
                    document_type: kind,
                    status,
                    candidates: candidates.iter().map(Candidate::metadata).collect(),
                    latest_generated: latest.remove(kind.key()),
                    operator_fields: operator_fields(kind),
                }
            })
            .collect(),
    ))
}

#[utoipa::path(
    put, path = "/api/v1/expedientes/{id}/documents/{document_id}", tag = "Clients",
    security(("bearer_auth" = [])),
    params(("id" = Uuid, Path, description = "Case file UUID"),
           ("document_id" = Uuid, Path, description = "Client-generated document UUID")),
    request_body = GenerateCaseDocument,
    responses(
        (status = 200, description = "Previously saved identical request", body = DocumentMetadata),
        (status = 201, description = "Generated document and saved binary", body = DocumentMetadata),
        (status = 401, body = ErrorEnvelope),
        (status = 402, description = "Generation is paused because the company is suspended", body = ErrorEnvelope),
        (status = 403, body = ErrorEnvelope),
        (status = 404, description = "Company, case or compatible contract unavailable", body = ErrorEnvelope),
        (status = 409, description = "This document ID was used by another request", body = ErrorEnvelope),
        (status = 413, description = "Word input, generated artifact or request exceeds its size limit", body = ErrorEnvelope),
        (status = 422, description = "Invalid input or template, failed rendering, or templates requiring a choice (DOCUMENT_TEMPLATE_AMBIGUOUS)", body = CaseDocumentErrorEnvelope),
        (status = 503, description = "Renderer unavailable", body = ErrorEnvelope),
        (status = 504, description = "Generation timed out", body = ErrorEnvelope),
    )
)]
pub(super) async fn generate_document(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
    ApiPath((id, document_id)): ApiPath<(Uuid, Uuid)>,
    ApiJson(body): ApiJson<GenerateCaseDocument>,
) -> Result<(StatusCode, Json<DocumentMetadata>), ApiError> {
    let case = scoped_case(&state.db, user.id, id, body.company_id).await?;
    if billing::repository::suspended_company_ids(&state.db)
        .await?
        .contains(&body.company_id)
    {
        return Err(ApiError::PaymentRequired);
    }

    let kind = body.document_type;
    let operator = normalize_operator_values(kind, &body.operator_values)?;
    // Include the requested ID (or its absence) and the original operator strings.
    // BTreeMap makes the digest independent of JSON object order.
    let fingerprint =
        Sha256::digest(serde_json::to_vec(&(id, &body)).map_err(anyhow::Error::from)?);
    if let Some(saved) = replay_case_document(&state, user.id, document_id, &fingerprint).await? {
        return Ok((StatusCode::OK, Json(saved)));
    }
    if case.insurance_paid && kind.insurance() {
        return Err(ApiError::Validation(
            "El expediente indica que el seguro ya está pagado.".into(),
        ));
    }

    let templates = load_templates(&state.db, user.id, body.company_id).await?;
    let candidates = candidates(&templates, kind);
    let template = if let Some(contract_id) = body.contract_id {
        candidates
            .iter()
            .find(|candidate| candidate.template.id == contract_id)
            .map(|candidate| candidate.template)
    } else {
        let selected = preferred(&candidates, body.company_id);
        if selected.is_none() && !candidates.is_empty() {
            return Err(ApiError::DocumentTemplateAmbiguous(
                candidates.iter().map(Candidate::metadata).collect(),
            ));
        }
        selected
    }
    .ok_or(ApiError::ContractNotFound)?;
    billing::require_generation_access(
        &state.db,
        user.id,
        template.id,
        Some(body.company_id),
        Some(case.id),
    )
    .await?;
    let client = repository::find_client(&state.db, case.client_id)
        .await?
        .ok_or(ApiError::ClientNotFound)?;
    let company = company_repository::find_for_reader(&state.db, &user, body.company_id)
        .await?
        .with_alias();
    let company_profile = company_profile(&company);
    let (document_format, artifact_kind, sale_format) = body.format.formats();

    // The normal request deadline also covers this asynchronous wait.
    let slot = GENERATION_SLOTS
        .clone()
        .acquire_owned()
        .await
        .map_err(anyhow::Error::from)?;
    let generation = Generation {
        slot: Arc::new(slot),
        state: &state,
        user: &user,
        case: &case,
        client: &client,
        company: &company,
        company_profile: &company_profile,
    };
    let artifact = generation
        .fill(kind, template, &templates, &operator, sale_format)
        .await?;
    let artifact_bytes = if artifact_kind == FileKind::Pdf {
        // Retain the slot until the bounded renderer request finishes, even if the
        // case request times out first.
        let slot = generation.slot.clone();
        let render_state = state.clone();
        tokio::spawn(async move {
            let _slot = slot;
            render_pdf_bytes(&render_state, artifact.word.into()).await
        })
        .await
        .map_err(anyhow::Error::from)??
    } else {
        artifact.word
    };
    drop(generation);
    if artifact_bytes.len() > artifact_max_bytes(state.config.upload_max_bytes) {
        return Err(ApiError::PayloadTooLarge);
    }
    let filename = format!(
        "{}.{}",
        filename_base(&template.name, template.catalog_key.as_deref()),
        document_format.extension()
    );
    let document = SaveDocument {
        contract_id: template.id,
        format: document_format,
        filename,
        markdown: String::new(),
        email: None,
        company: Some(artifact.snapshot),
        operation_id: Some(id),
        document_type: Some(kind.key().into()),
        legacy: None,
    };
    persist_case_document(
        &state,
        user.id,
        document_id,
        &document,
        (artifact_kind, &artifact_bytes),
        &fingerprint,
    )
    .await
}

// Limit simultaneous source downloads, Word DOMs and PDF renders across all case requests.
static GENERATION_SLOTS: LazyLock<Arc<Semaphore>> = LazyLock::new(|| {
    Arc::new(Semaphore::new(
        available_parallelism().map_or(1, |count| count.get().min(4)),
    ))
});

struct Generation<'a> {
    slot: Arc<OwnedSemaphorePermit>,
    state: &'a AppState,
    user: &'a AuthUser,
    case: &'a Operation,
    client: &'a Client,
    company: &'a Company,
    company_profile: &'a CompanyProfile,
}

struct FilledDocument {
    word: Vec<u8>,
    snapshot: crate::modules::companies::CompanySnapshot,
}

impl Generation<'_> {
    async fn run_blocking<T: Send + 'static>(
        &self,
        job: impl FnOnce() -> Result<T, ApiError> + Send + 'static,
    ) -> Result<T, ApiError> {
        // A request can time out while a blocking job is still running.
        let slot = self.slot.clone();
        tokio::task::spawn_blocking(move || {
            let _slot = slot;
            job()
        })
        .await
        .map_err(anyhow::Error::from)?
    }

    async fn fill(
        &self,
        kind: CaseDocumentType,
        template: &Template,
        templates: &[Template],
        operator: &OperatorValues<'_>,
        format: SaleFormat,
    ) -> Result<FilledDocument, ApiError> {
        let imported = self.case.vehicle.source_document == Some(VehicleDocument::BillOfLading);
        let variables = template
            .native_variables
            .as_ref()
            .ok_or(ApiError::ContractNotFound)?;
        let fields = fields::fields(kind, variables, imported);
        let vehicle = vehicle_from_case(self.case);
        let issuer = if kind.requires_issuer() {
            let profiles =
                company_repository::list(&self.state.db, self.user.id, false, self.user.superadmin)
                    .await?;
            let mut matching = profiles
                .into_iter()
                .map(Company::with_alias)
                .filter(|company| {
                    is_issuer_name(
                        company
                            .values
                            .get("empresa_razon_social")
                            .map(String::as_str)
                            .filter(|name| !name.is_empty())
                            .unwrap_or(&company.name),
                    )
                });
            matching.next().filter(|_| matching.next().is_none())
        } else {
            None
        };
        let generic_company = fields
            .iter()
            .any(|field| company_field(&field.key) && !issuer_field(&field.key));
        if kind.requires_issuer()
            && kind != CaseDocumentType::VentaCondicionalSeguro
            && generic_company
            && issuer
                .as_ref()
                .is_none_or(|issuer| issuer.id != self.company.id)
        {
            return Err(ApiError::Validation(
                "El Word usa variables generales de empresa para un emisor de seguro distinto."
                    .into(),
            ));
        }
        let issuer_literal_needed = kind.requires_issuer()
            && issuer.is_none()
            && !generic_company
            && !fields.iter().any(|field| issuer_field(&field.key));
        let original = read_original(self.state, template).await?;
        let (original, issuer_literal) = if issuer_literal_needed {
            self.run_blocking(move || {
                let (_, paragraphs) = read_source_paragraphs(&original, None)?;
                Ok::<_, ApiError>((
                    original,
                    paragraphs
                        .iter()
                        .any(|paragraph| contains_issuer_name(paragraph)),
                ))
            })
            .await?
        } else {
            (original, false)
        };
        let issuer_profile = issuer.as_ref().map(company_profile);
        let sales_paragraph = if kind == CaseDocumentType::PagareAutentico {
            Some(self.sales_paragraph(templates, &vehicle).await?)
        } else {
            None
        };
        let case = CaseValues::resolve(
            kind,
            self.client,
            self.case,
            Context {
                vehicle: &vehicle,
                operator: Some(operator),
                sales_commitment: sales_paragraph.as_deref(),
                issuer: issuer_profile.as_ref(),
                issuer_literal,
            },
        );
        let values = resolve_company_values(kind, &fields, self.company_profile, &case);
        let snapshot = validate_and_snapshot(
            kind,
            &fields,
            &values,
            &case,
            self.company.id,
            &self.company.name,
        )?;
        let variables = variables.0.clone();
        let company = template
            .catalog_key
            .as_ref()
            .map(|_| self.company_profile.clone());
        let word = self
            .run_blocking(move || {
                fill_native_docx(
                    &original,
                    &NativeFill {
                        variables: &variables,
                        fields: &fields,
                        values: &values,
                        allow_incomplete: false,
                        uppercase: kind.uppercase(),
                        bold_pagare_date: kind.bold_date(),
                        conditional_sale: kind.conditional_sale().then_some(format),
                        company: company.as_ref(),
                        vehicle: Some(&vehicle),
                        reviewed_bodies: production_table(),
                    },
                )
            })
            .await?;
        Ok(FilledDocument { word, snapshot })
    }

    async fn sales_paragraph(
        &self,
        templates: &[Template],
        vehicle: &crate::modules::document_fill::Vehicle,
    ) -> Result<String, ApiError> {
        let template = if let Some(id) = self.case.contract_id {
            templates.iter().find(|template| template.id == id)
        } else {
            let sales = candidates(templates, CaseDocumentType::VentaCondicional);
            preferred(&sales, self.company.id)
        }.ok_or_else(|| ApiError::Validation(
            "Carga una plantilla de venta condicional para extraer la cláusula de compromiso del pagaré.".into()
        ))?;
        let sale = CaseValues::resolve(
            CaseDocumentType::VentaCondicional,
            self.client,
            self.case,
            Context {
                vehicle,
                operator: None,
                sales_commitment: None,
                issuer: None,
                issuer_literal: false,
            },
        );
        if template
            .native_variables
            .as_ref()
            .is_some_and(|variables| variables.iter().any(|field| field.key == ANCHOR))
            && sale.get(ANCHOR).is_empty()
        {
            return Err(ApiError::Validation(
                "Guarda la fecha de firma para calcular el compromiso de pago de la venta.".into(),
            ));
        }
        let original = read_original(self.state, template).await?;
        let company = template
            .catalog_key
            .as_ref()
            .map(|_| self.company_profile.clone());
        self.run_blocking(move || sales_commitment(&original, &sale.values, company.as_ref()))
            .await
    }
}

fn company_profile(company: &Company) -> CompanyProfile {
    CompanyProfile {
        name: company.name.clone(),
        values: company.values.clone().into_iter().collect(),
    }
}

async fn scoped_case(
    db: &PgPool,
    actor: Uuid,
    id: Uuid,
    company: Uuid,
) -> Result<Operation, ApiError> {
    let member: bool = sqlx::query_scalar("SELECT has_company_membership($1, $2)")
        .bind(actor)
        .bind(company)
        .fetch_one(db)
        .await?;
    if !member {
        return Err(ApiError::CompanyNotFound);
    }
    repository::find_case(db, id)
        .await?
        .filter(|case| case.company_id == company)
        .ok_or(ApiError::ClientOperationNotFound)
}

#[derive(sqlx::FromRow)]
struct Template {
    id: Uuid,
    name: String,
    catalog_key: Option<String>,
    company_id: Option<Uuid>,
    object_key: String,
    native_variables: Option<sqlx::types::Json<Vec<NativeVariable>>>,
}

async fn load_templates(
    db: &PgPool,
    actor: Uuid,
    company: Uuid,
) -> Result<Vec<Template>, ApiError> {
    Ok(sqlx::query_as(
        "SELECT c.id, c.name, c.catalog_key, c.company_id, c.object_key, t.native_variables
         FROM contracts c JOIN templates t ON t.contract_id = c.id
         WHERE c.deleted_at IS NULL AND c.status = 'converted'
           AND lower(c.original_file_name) LIKE '%.docx' AND c.mime_type = $3
           AND (c.catalog_key IS NOT NULL OR c.company_id = $2
             OR (c.company_id IS NULL AND $2 = ANY(c.shared_company_ids)))
           AND can_read_contract($1, c.owner_id, c.company_id, c.shared_company_ids, c.catalog_key)
         ORDER BY c.created_at DESC, c.id DESC",
    )
    .bind(actor)
    .bind(company)
    .bind(FileKind::Docx.mime_type())
    .fetch_all(db)
    .await?)
}

async fn read_original(state: &AppState, template: &Template) -> Result<Vec<u8>, ApiError> {
    let original = state
        .storage
        .head(&template.object_key)
        .await?
        .ok_or(ApiError::ContractNotFound)?;
    let max_bytes = artifact_max_bytes(state.config.upload_max_bytes);
    if usize::try_from(original.size_bytes).map_or(true, |size| size > max_bytes) {
        return Err(ApiError::PayloadTooLarge);
    }
    state
        .storage
        .read_matching(&template.object_key, &original)
        .await?
        .ok_or(ApiError::ContractNotFound)
}

struct Candidate<'a> {
    template: &'a Template,
    rank: TemplateMatch,
}

impl Candidate<'_> {
    fn metadata(&self) -> TemplateCandidate {
        TemplateCandidate {
            contract_id: self.template.id,
            name: self.template.name.clone(),
        }
    }
}

fn candidates(templates: &[Template], kind: CaseDocumentType) -> Vec<Candidate<'_>> {
    let mut candidates: Vec<_> = templates
        .iter()
        .filter_map(|template| {
            let rank = template_match(
                kind,
                &template.name,
                template.catalog_key.as_deref(),
                template.native_variables.as_ref()?,
            )?;
            Some(Candidate { template, rank })
        })
        .collect();
    candidates.sort_by_key(|candidate| match candidate.rank {
        TemplateMatch::Official => 0,
        TemplateMatch::Matching => 1,
        TemplateMatch::Compatible => 2,
    });
    candidates
}

fn preferred<'a>(candidates: &[Candidate<'a>], company: Uuid) -> Option<&'a Template> {
    let first = candidates.first()?;
    if first.rank == TemplateMatch::Official {
        return Some(first.template);
    }
    let ranked = || {
        candidates
            .iter()
            .take_while(|candidate| candidate.rank == first.rank)
    };
    let mut scoped = ranked().filter(|candidate| candidate.template.company_id == Some(company));
    if let Some(candidate) = scoped.next() {
        return scoped.next().is_none().then_some(candidate.template);
    }
    ranked().nth(1).is_none().then_some(first.template)
}

async fn latest_documents(
    db: &PgPool,
    company: Uuid,
    operation: Uuid,
) -> Result<HashMap<String, LatestGeneratedDocument>, ApiError> {
    let rows: Vec<(String, Uuid, DateTime<Utc>, DocumentFormat)> = sqlx::query_as(
        "SELECT DISTINCT ON (document_type) document_type, id, created_at, format
         FROM generated_documents
         WHERE operation_company_id = $1 AND operation_id = $2 AND document_type IS NOT NULL
         ORDER BY document_type, created_at DESC, id DESC",
    )
    .bind(company)
    .bind(operation)
    .fetch_all(db)
    .await?;
    Ok(rows
        .into_iter()
        .map(|(kind, id, created_at, format)| {
            (
                kind,
                LatestGeneratedDocument {
                    id,
                    created_at,
                    format,
                },
            )
        })
        .collect())
}
