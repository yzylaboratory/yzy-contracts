use std::io::{Cursor, Read, Write};

use axum::{
    Extension,
    body::Bytes,
    extract::State,
    http::header,
    response::{IntoResponse, Response},
};
use serde_json::{Value, json};
use uuid::Uuid;
use zip::{ZipArchive, ZipWriter, write::SimpleFileOptions};

use crate::{
    app_state::AppState,
    error::{ApiError, ErrorEnvelope},
    extract::ApiPath,
    modules::{auth::AuthUser, contracts::render::pdf_response, files::validation::FileKind},
};

use super::{
    dto::{Client, Operation},
    repository,
};

const TEMPLATE: &[u8] = include_bytes!("loan-application.docx");

#[utoipa::path(
    get, path = "/api/v1/expedientes/{id}/solicitud-prestamo.pdf",
    tag = "Clients", security(("bearer_auth" = [])),
    params(("id" = Uuid, Path, description = "Case file UUID")),
    responses(
        (status = 200, description = "Completed loan application rendered from the official template", content_type = "application/pdf"),
        (status = 401, body = ErrorEnvelope), (status = 403, body = ErrorEnvelope),
        (status = 404, body = ErrorEnvelope),
        (status = 422, description = "Required loan application data is missing or rendering failed", body = ErrorEnvelope),
        (status = 503, body = ErrorEnvelope), (status = 504, body = ErrorEnvelope)
    )
)]
pub(super) async fn download(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
    ApiPath(id): ApiPath<Uuid>,
) -> Result<Response, ApiError> {
    let word = filled_application(&state, &user, id).await?;
    pdf_response(&state, word.into()).await
}

#[utoipa::path(
    get, path = "/api/v1/expedientes/{id}/solicitud-prestamo.docx",
    tag = "Clients", security(("bearer_auth" = [])),
    params(("id" = Uuid, Path, description = "Case file UUID")),
    responses(
        (status = 200, description = "Completed loan application as an editable Word document", content_type = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
        (status = 401, body = ErrorEnvelope), (status = 403, body = ErrorEnvelope),
        (status = 404, body = ErrorEnvelope),
        (status = 422, description = "Required loan application data is missing", body = ErrorEnvelope),
        (status = 503, body = ErrorEnvelope)
    )
)]
pub(super) async fn download_docx(
    State(state): State<AppState>,
    Extension(user): Extension<AuthUser>,
    ApiPath(id): ApiPath<Uuid>,
) -> Result<Response, ApiError> {
    let word = filled_application(&state, &user, id).await?;
    Ok((
        [
            (header::CONTENT_TYPE, FileKind::Docx.mime_type()),
            (header::CACHE_CONTROL, "private, no-store"),
            (header::X_CONTENT_TYPE_OPTIONS, "nosniff"),
        ],
        Bytes::from(word),
    )
        .into_response())
}

async fn filled_application(
    state: &AppState,
    user: &AuthUser,
    id: Uuid,
) -> Result<Vec<u8>, ApiError> {
    let operation = repository::find_case(&state.db, id)
        .await?
        .ok_or(ApiError::ClientOperationNotFound)?;
    let company: String = sqlx::query_scalar(
        "SELECT name FROM yzy_contracts.companies
         WHERE id = $2 AND yzy_contracts.has_company_membership($1, $2)",
    )
    .bind(user.id)
    .bind(operation.company_id)
    .fetch_optional(&state.db)
    .await?
    .ok_or(ApiError::ClientOperationNotFound)?;
    let client = repository::find_client(&state.db, operation.client_id)
        .await?
        .ok_or(ApiError::ClientNotFound)?;
    render_application(&client, &operation, company)
}

pub(super) fn render_application(
    client: &Client,
    operation: &Operation,
    company: String,
) -> Result<Vec<u8>, ApiError> {
    let values = template_values(client, operation, company)?;
    let word = fill_template(&values).map_err(|error| {
        tracing::error!(%error, "loan application template could not be filled");
        ApiError::DocumentRenderFailed
    })?;
    Ok(word)
}

fn template_values(
    client: &Client,
    operation: &Operation,
    company: String,
) -> Result<Value, ApiError> {
    let client = serde_json::to_value(client).map_err(|_| ApiError::DocumentRenderFailed)?;
    let operation = serde_json::to_value(operation).map_err(|_| ApiError::DocumentRenderFailed)?;
    let application = &operation["application"];
    let profile = &client["profile"];
    let vehicle = &operation["vehicle"];
    let mut values = json!({ "company": company.to_uppercase() });

    for key in ["name", "identity", "phone", "address", "email"] {
        values[key] = json!(required(&client[key], key)?);
    }
    // The portal asks only whether the home is owned; renting is its opposite.
    let owns_home = profile["owns_home"]
        .as_bool()
        .ok_or_else(|| missing("owns_home"))?;
    let owns_vehicle = profile["owns_vehicle"]
        .as_bool()
        .ok_or_else(|| missing("owns_vehicle"))?;
    for (key, answer) in [
        ("owns_home", owns_home),
        ("rents_home", !owns_home),
        ("owns_vehicle", owns_vehicle),
    ] {
        values[key] = json!(if answer { "Sí" } else { "No" });
    }
    for key in [
        "employer",
        "work_address",
        "work_phone",
        "position",
        "employment_duration",
        "fixed_income",
        "other_income",
        "other_income_source",
        "pay_days",
    ] {
        values[key] = json!(required(&profile[key], key)?);
    }
    // Imported vehicles can lack a type. Leave space for the plate and engine
    // number to be entered by hand when they are unavailable.
    let imported = vehicle["source_document"] == "bill_of_lading";
    for key in [
        "vehicle_type",
        "make",
        "model",
        "year",
        "color",
        "plate",
        "chassis_number",
        "engine_number",
    ] {
        let value = match key {
            "plate" | "engine_number" if blank(&vehicle[key]) => "________________".to_owned(),
            "vehicle_type" if imported && blank(&vehicle[key]) => String::new(),
            _ => required(&vehicle[key], key)?.to_uppercase(),
        };
        values[key] = json!(value);
    }
    let date = required(&application["application_date"], "application_date")?;
    let date = chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d")
        .map_err(|_| missing("application_date"))?;
    let months = [
        "enero",
        "febrero",
        "marzo",
        "abril",
        "mayo",
        "junio",
        "julio",
        "agosto",
        "septiembre",
        "octubre",
        "noviembre",
        "diciembre",
    ];
    use chrono::Datelike;
    values["application_date"] = json!(format!(
        "{} de {} de {}",
        date.day(),
        months[date.month0() as usize],
        date.year()
    ));
    let amount = application["requested_amount_minor"]
        .as_i64()
        .filter(|amount| *amount > 0)
        .ok_or_else(|| missing("requested_amount"))?;
    let pesos = (amount / 100).to_string();
    let mut formatted = String::from("RD$");
    for (index, digit) in pesos.chars().enumerate() {
        if index > 0 && (pesos.len() - index).is_multiple_of(3) {
            formatted.push(',');
        }
        formatted.push(digit);
    }
    values["requested_amount"] = json!(format!("{formatted}.{:02}", amount % 100));

    for key in [
        "name",
        "identity",
        "phone",
        "employer",
        "employment_duration",
        "position",
        "address",
        "work_phone",
    ] {
        let marker = format!("spouse_{key}");
        values[&marker] = json!(
            if profile["spouse_not_applicable"].as_bool() == Some(true) {
                "N/A"
            } else {
                required(&profile["spouse"][key], &marker)?
            }
        );
    }
    for (kind, count, keys) in [
        (
            "family",
            3,
            &["name", "relationship", "phone", "address"][..],
        ),
        ("personal", 2, &["name", "relationship", "phone"][..]),
    ] {
        let references = &profile[format!("{kind}_references")];
        for index in 0..count {
            for key in keys {
                let marker = format!("{kind}_{}_{key}", index + 1);
                values[&marker] = json!(required(&references[index][*key], &marker)?);
            }
        }
    }
    Ok(values)
}

fn blank(value: &Value) -> bool {
    value.as_str().is_none_or(|value| value.trim().is_empty())
}

fn required<'a>(value: &'a Value, key: &str) -> Result<&'a str, ApiError> {
    value
        .as_str()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| {
            if value.eq_ignore_ascii_case("no aplica") || value.eq_ignore_ascii_case("n/a") {
                "N/A"
            } else {
                value
            }
        })
        .ok_or_else(|| missing(key))
}

fn missing(key: &str) -> ApiError {
    ApiError::Validation(format!(
        "Completa los datos requeridos para la solicitud de préstamo ({key})."
    ))
}

fn fill_template(values: &Value) -> anyhow::Result<Vec<u8>> {
    let mut source = ZipArchive::new(Cursor::new(TEMPLATE))?;
    let mut output = ZipWriter::new(Cursor::new(Vec::new()));
    for index in 0..source.len() {
        let mut entry = source.by_index(index)?;
        let name = entry.name()?.into_owned();
        output.start_file(
            &name,
            SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated),
        )?;
        if matches!(name.as_str(), "word/document.xml" | "word/header2.xml") {
            let mut xml = String::new();
            entry.read_to_string(&mut xml)?;
            let mut rest = xml.as_str();
            while let Some((before, marker)) = rest.split_once("{{") {
                let (key, after) = marker
                    .split_once("}}")
                    .ok_or_else(|| anyhow::anyhow!("unclosed template marker"))?;
                let value = values[key]
                    .as_str()
                    .ok_or_else(|| anyhow::anyhow!("unknown marker: {key}"))?;
                output.write_all(before.as_bytes())?;
                for character in value.chars() {
                    match character {
                        '&' => output.write_all(b"&amp;")?,
                        '<' => output.write_all(b"&lt;")?,
                        '>' => output.write_all(b"&gt;")?,
                        character
                            if !character.is_control()
                                || matches!(character, '\t' | '\r' | '\n') =>
                        {
                            output.write_all(character.encode_utf8(&mut [0; 4]).as_bytes())?
                        }
                        _ => {}
                    }
                }
                rest = after;
            }
            output.write_all(rest.as_bytes())?;
        } else {
            std::io::copy(&mut entry, &mut output)?;
        }
    }
    Ok(output.finish()?.into_inner())
}
