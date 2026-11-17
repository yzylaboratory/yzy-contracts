use chrono::{DateTime, Utc};
use serde::{Deserialize, Deserializer, Serialize};
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;
use validator::Validate;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ContractStatus {
    Uploaded,
    Converting,
    Converted,
    ConversionFailed,
}

impl ContractStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Uploaded => "uploaded",
            Self::Converting => "converting",
            Self::Converted => "converted",
            Self::ConversionFailed => "conversion_failed",
        }
    }
}

impl TryFrom<String> for ContractStatus {
    type Error = String;

    fn try_from(value: String) -> Result<Self, Self::Error> {
        match value.as_str() {
            "uploaded" => Ok(Self::Uploaded),
            "converting" => Ok(Self::Converting),
            "converted" => Ok(Self::Converted),
            "conversion_failed" => Ok(Self::ConversionFailed),
            _ => Err(format!("unknown contract status: {value}")),
        }
    }
}

#[derive(Debug, Deserialize, Validate, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct CreateContractRequest {
    pub upload_id: Uuid,
    /// Select one active company or null for a private contract. Mutually exclusive with shared_company_ids.
    #[serde(default, deserialize_with = "present_or_null")]
    #[schema(value_type = Option<Uuid>)]
    pub company_id: Option<Option<Uuid>>,
    /// Snapshot of the active companies to share with. Mutually exclusive with company_id.
    #[serde(default, deserialize_with = "present_array")]
    #[validate(length(min = 1, max = 100))]
    #[schema(value_type = Vec<Uuid>, min_items = 1, max_items = 100)]
    pub shared_company_ids: Option<Vec<Uuid>>,
    #[validate(length(min = 1, max = 200))]
    #[schema(example = "Contrato de arrendamiento")]
    pub name: String,
    #[validate(length(max = 2000))]
    #[schema(example = "Plantilla base para vivienda")]
    pub description: Option<String>,
}

/// Fields left out stay unchanged. `description: null` clears the description.
#[derive(Debug, Deserialize, Validate, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct UpdateContractRequest {
    #[validate(length(min = 1, max = 200))]
    pub name: Option<String>,
    #[serde(default, deserialize_with = "present_or_null")]
    #[validate(length(max = 2000))]
    #[schema(value_type = Option<String>)]
    pub description: Option<Option<String>>,
    /// Replaces the shared company snapshot with one company, or makes the contract private when null.
    #[serde(default, deserialize_with = "present_or_null")]
    #[schema(value_type = Option<Uuid>)]
    pub company_id: Option<Option<Uuid>>,
    /// Replaces the sharing scope with a snapshot of active companies. Mutually exclusive with company_id.
    #[serde(default, deserialize_with = "present_array")]
    #[validate(length(min = 1, max = 100))]
    #[schema(value_type = Vec<Uuid>, min_items = 1, max_items = 100)]
    pub shared_company_ids: Option<Vec<Uuid>>,
}

fn present_or_null<'de, D, T>(deserializer: D) -> Result<Option<Option<T>>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(deserializer).map(Some)
}

fn present_array<'de, D>(deserializer: D) -> Result<Option<Vec<Uuid>>, D::Error>
where
    D: Deserializer<'de>,
{
    Vec::<Uuid>::deserialize(deserializer).map(Some)
}

#[derive(Debug, Clone, Copy, Default, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ContractSort {
    Name,
    #[default]
    CreatedAt,
    UpdatedAt,
}

#[derive(Debug, Clone, Copy, Default, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum SortOrder {
    Asc,
    #[default]
    Desc,
}

#[derive(Debug, Deserialize, Validate, IntoParams)]
#[into_params(parameter_in = Query)]
#[serde(deny_unknown_fields)]
pub struct ListContractsQuery {
    /// Page number, starting at 1.
    #[serde(default = "default_page")]
    #[validate(range(min = 1))]
    #[param(minimum = 1, default = 1)]
    pub page: i64,
    /// Items per page, up to 100.
    #[serde(default = "default_per_page")]
    #[validate(range(min = 1, max = 100))]
    #[param(minimum = 1, maximum = 100, default = 20)]
    pub per_page: i64,
    /// Case-insensitive search by name.
    #[validate(length(max = 200))]
    pub q: Option<String>,
    pub status: Option<ContractStatus>,
    #[serde(default)]
    pub sort: ContractSort,
    #[serde(default)]
    pub order: SortOrder,
}

fn default_page() -> i64 {
    1
}

fn default_per_page() -> i64 {
    20
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow, ToSchema)]
pub struct ContractResponse {
    pub id: Uuid,
    pub owner_id: Uuid,
    pub company_id: Option<Uuid>,
    /// Stable document type of an official template available to every active company.
    pub catalog_key: Option<String>,
    /// The saved company snapshot for the owner, or its active intersection with the reader's memberships.
    pub shared_company_ids: Option<Vec<Uuid>>,
    #[schema(example = "Contrato de arrendamiento")]
    pub name: String,
    pub description: Option<String>,
    #[schema(example = "contrato-arrendamiento.pdf")]
    pub original_file_name: String,
    #[schema(example = "application/pdf")]
    pub mime_type: String,
    #[schema(example = 245760)]
    pub size_bytes: i64,
    #[sqlx(try_from = "String")]
    pub status: ContractStatus,
    /// Present once a conversion has produced the template.
    pub template_id: Option<Uuid>,
    /// The most recent conversion, whatever its state.
    pub latest_conversion_id: Option<Uuid>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ContractListResponse {
    pub items: Vec<ContractResponse>,
    pub page: i64,
    pub per_page: i64,
    pub total: i64,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct DownloadUrlResponse {
    pub url: String,
    pub expires_at: DateTime<Utc>,
}
