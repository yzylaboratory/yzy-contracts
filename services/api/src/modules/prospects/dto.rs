use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;
use validator::Validate;

use crate::error::ApiError;
use crate::modules::clients::ClientProfile;

#[derive(Debug, Serialize, ToSchema)]
pub(super) struct ProspectLink {
    /// One-time token for the portal's `/prospecto#token` fragment. Returned
    /// once; the API never stores or logs it, only its SHA-256 digest.
    pub token: String,
    pub expires_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, ToSchema, sqlx::FromRow)]
pub(super) struct Prospect {
    pub id: Uuid,
    pub submitted_at: DateTime<Utc>,
    pub name: String,
    pub identity: String,
    pub phone: String,
    pub address: String,
    #[schema(required = true)]
    pub email: Option<String>,
    /// Legacy flat field, kept for prospects submitted before `profile`
    /// existed. [`Self::with_merged_profile`] folds it into `profile` for
    /// display; the column itself is never overwritten.
    #[schema(required = true)]
    pub nationality: Option<String>,
    #[schema(required = true)]
    pub marital_status: Option<String>,
    #[sqlx(rename = "occupation")]
    #[schema(required = true)]
    pub position: Option<String>,
    #[schema(required = true)]
    pub income_source: Option<String>,
    #[schema(required = true)]
    #[sqlx(json(nullable))]
    pub profile: Option<ClientProfile>,
}

impl Prospect {
    /// For display only: a prospect submitted before `profile` existed has
    /// its nationality/marital_status/position in the legacy flat columns.
    /// Folds them into `profile` wherever the canonical profile has no value
    /// of its own, without ever touching the stored flat columns.
    pub(super) fn with_merged_profile(mut self) -> Self {
        if self.nationality.is_some() || self.marital_status.is_some() || self.position.is_some() {
            self.profile = Some(self.profile.take().unwrap_or_default().merge_legacy(
                self.nationality.clone(),
                self.marital_status.clone(),
                self.position.clone(),
            ));
        }
        self
    }
}

#[derive(Debug, Serialize, ToSchema)]
pub(super) struct ProspectList {
    pub items: Vec<Prospect>,
}

#[derive(Debug, Serialize, ToSchema)]
pub(super) struct ConvertedProspect {
    pub client_id: Uuid,
}

#[derive(Debug, Deserialize, Validate, ToSchema)]
#[serde(deny_unknown_fields)]
pub(super) struct CheckProspectLink {
    pub token: String,
    pub identity: String,
}

#[derive(Debug, Deserialize, Validate, ToSchema)]
#[serde(deny_unknown_fields)]
pub(super) struct CreateProspectLink {
    /// Dominican cédula, with or without hyphens.
    pub identity: String,
}

#[derive(Debug, Deserialize, Validate, ToSchema)]
#[serde(deny_unknown_fields)]
pub(super) struct SubmitProspect {
    pub token: String,
    #[schema(min_length = 1, max_length = 200)]
    pub name: String,
    #[schema(min_length = 1, max_length = 64)]
    pub identity: String,
    #[schema(min_length = 1, max_length = 80)]
    pub phone: String,
    #[schema(min_length = 1, max_length = 1000)]
    pub address: String,
    #[schema(max_length = 254)]
    pub email: Option<String>,
    #[schema(max_length = 120)]
    pub nationality: Option<String>,
    #[schema(max_length = 80)]
    pub marital_status: Option<String>,
    #[schema(max_length = 200)]
    pub position: Option<String>,
    #[schema(max_length = 1000)]
    pub income_source: Option<String>,
    /// Canonical client profile (treatment, nationality, marital status,
    /// housing/vehicle, employment/income, spouse, references). Validated
    /// the same way as a client's own profile, deny-unknown-fields included;
    /// it carries no loan data (amount, application date, collateral vehicle).
    pub profile: Option<ClientProfile>,
}

/// The same fields after the client-style trim, length check and uppercase
/// pass. Identity, contact and address data is recorded in uppercase, as it
/// appears in contracts; email keeps its case.
pub(super) struct NormalizedProspect {
    pub name: String,
    pub identity: String,
    pub phone: String,
    pub address: String,
    pub email: Option<String>,
    pub nationality: Option<String>,
    pub marital_status: Option<String>,
    pub position: Option<String>,
    pub income_source: Option<String>,
    pub profile: Option<ClientProfile>,
}

impl SubmitProspect {
    pub(super) fn normalize(self) -> Result<NormalizedProspect, ApiError> {
        let mut name = self.name;
        let mut identity = self.identity;
        let mut phone = self.phone;
        let mut address = self.address;
        let mut email = self.email;
        let mut nationality = self.nationality;
        let mut marital_status = self.marital_status;
        let mut position = self.position;
        let mut income_source = self.income_source;
        let mut profile = self.profile;
        normalize_required("name", &mut name, 200)?;
        normalize_required("identity", &mut identity, 64)?;
        normalize_required("phone", &mut phone, 80)?;
        normalize_required("address", &mut address, 1000)?;
        for (field, value, max) in [
            ("email", &mut email, 254),
            ("nationality", &mut nationality, 120),
            ("marital_status", &mut marital_status, 80),
            ("position", &mut position, 200),
            ("income_source", &mut income_source, 1000),
        ] {
            normalize_optional(field, value, max)?;
        }
        for value in [&mut name, &mut identity, &mut address] {
            *value = value.to_uppercase();
        }
        for value in [
            &mut nationality,
            &mut marital_status,
            &mut position,
            &mut income_source,
        ]
        .into_iter()
        .filter_map(Option::as_mut)
        {
            *value = value.to_uppercase();
        }
        if let Some(profile) = &mut profile {
            profile.normalize()?;
        }
        Ok(NormalizedProspect {
            name,
            identity,
            phone,
            address,
            email,
            nationality,
            marital_status,
            position,
            income_source,
            profile,
        })
    }
}

fn normalize_required(field: &str, value: &mut String, max: usize) -> Result<(), ApiError> {
    let trimmed = value.trim();
    if trimmed.is_empty() || trimmed.chars().count() > max || trimmed.contains('\0') {
        return Err(invalid(field));
    }
    if trimmed.len() != value.len() {
        *value = trimmed.to_owned();
    }
    Ok(())
}

fn normalize_optional(field: &str, value: &mut Option<String>, max: usize) -> Result<(), ApiError> {
    if let Some(text) = value {
        let trimmed = text.trim();
        if trimmed.chars().count() > max || trimmed.contains('\0') {
            return Err(invalid(field));
        }
        *value = (!trimmed.is_empty()).then(|| trimmed.to_owned());
    }
    Ok(())
}

fn invalid(field: &str) -> ApiError {
    ApiError::Validation(format!("Valor inválido para {field}."))
}
