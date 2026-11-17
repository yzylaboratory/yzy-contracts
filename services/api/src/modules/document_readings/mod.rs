//! Reads photos or PDFs of known document categories into structured JSON
//! through OpenRouter. Nothing is stored: the file only travels to the model.

mod schemas;

use axum::{
    Json,
    extract::{DefaultBodyLimit, Multipart, State, multipart::MultipartRejection},
    http::StatusCode,
};
use chrono::NaiveDate;
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use serde_json::Value;
use utoipa::ToSchema;
use utoipa_axum::{
    router::{OpenApiRouter, UtoipaMethodRouterExt},
    routes,
};

use schemas::Envelope;
pub use schemas::{
    BillOfLadingData, CargoItem, CargoVehicle, IdCardData, Party, VehicleOwner,
    VehicleRegistrationData,
};

use crate::{
    app_state::AppState,
    error::{ApiError, ErrorEnvelope},
    infrastructure::openrouter::{Attachment, AttachmentKind, DocumentReader, ReadingRequest},
};

/// Exempt from REQUEST_TIMEOUT_SECS: a reading is bounded by OPENROUTER_TIMEOUT_SECS.
pub const PATH: &str = "/api/v1/document-readings";
const FILE_MAX_BYTES: usize = 10 * 1024 * 1024;
const MAX_FILES: usize = 4;
/// Room for the multipart boundaries and the category field.
const REQUEST_MAX_BYTES: usize = FILE_MAX_BYTES * MAX_FILES + 64 * 1024;

pub fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new()
        .routes(routes!(read_document).layer(DefaultBodyLimit::max(REQUEST_MAX_BYTES)))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum DocumentCategory {
    /// Dominican identity card (current biometric card or the previous one).
    DominicanIdCard,
    /// Dominican vehicle ownership certificate (matrícula).
    VehicleRegistration,
    /// Ocean bill of lading.
    BillOfLading,
}

impl DocumentCategory {
    pub fn parse(value: &str) -> Option<Self> {
        match value.trim() {
            "dominican_id_card" => Some(Self::DominicanIdCard),
            "vehicle_registration" => Some(Self::VehicleRegistration),
            "bill_of_lading" => Some(Self::BillOfLading),
            _ => None,
        }
    }
}

/// Multipart form accepted by `POST /api/v1/document-readings`.
#[allow(dead_code)]
#[derive(ToSchema)]
struct ReadDocumentForm {
    /// One of `dominican_id_card`, `vehicle_registration`, `bill_of_lading`.
    category: DocumentCategory,
    /// One to four JPEG, PNG, WebP or PDF files of up to 10 MiB each, for
    /// example both sides of a card. Repeat the `file` part for each one.
    #[schema(value_type = Vec<String>, format = Binary)]
    file: Vec<Vec<u8>>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct DocumentReading {
    pub category: DocumentCategory,
    /// OpenRouter model that read the document.
    pub model: String,
    /// False when the files do not look like the requested category; `data`
    /// then holds whatever could be read and should not be trusted.
    pub matches_category: bool,
    /// Fields the model could not read with confidence, plus checks done here
    /// (for example a cédula whose check digit does not match).
    pub warnings: Vec<String>,
    pub data: ReadingData,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(untagged)]
pub enum ReadingData {
    DominicanIdCard(IdCardData),
    VehicleRegistration(VehicleRegistrationData),
    BillOfLading(Box<BillOfLadingData>),
}

#[utoipa::path(
    post,
    path = "/api/v1/document-readings",
    tag = "Document readings",
    security(("bearer_auth" = [])),
    request_body(content = ReadDocumentForm, content_type = "multipart/form-data"),
    responses(
        (status = 200, description = "Structured data read from the document", body = DocumentReading),
        (status = 401, description = "Missing or invalid token", body = ErrorEnvelope),
        (status = 413, description = "A file exceeds 10 MiB", body = ErrorEnvelope),
        (status = 415, description = "Only JPEG, PNG, WebP and PDF files are supported", body = ErrorEnvelope),
        (status = 422, description = "Invalid form, or the model could not produce a reading", body = ErrorEnvelope),
        (status = 503, description = "Document reading is not configured or OpenRouter is unavailable", body = ErrorEnvelope),
        (status = 504, description = "The model took too long", body = ErrorEnvelope),
    )
)]
async fn read_document(
    State(state): State<AppState>,
    multipart: Result<Multipart, MultipartRejection>,
) -> Result<(StatusCode, Json<DocumentReading>), ApiError> {
    let reader = state
        .document_reader
        .as_ref()
        .ok_or(ApiError::DocumentReaderUnavailable)?;
    let mut multipart = multipart.map_err(|_| invalid("multipart"))?;
    let mut category = None;
    let mut attachments = Vec::new();
    while let Some(field) = multipart.next_field().await.map_err(multipart_error)? {
        match field.name() {
            Some("category") if category.is_none() => {
                let value = field.text().await.map_err(multipart_error)?;
                category =
                    Some(DocumentCategory::parse(&value).ok_or_else(|| invalid("category"))?);
            }
            Some("file") if attachments.len() < MAX_FILES => {
                let kind = field
                    .content_type()
                    .and_then(AttachmentKind::from_mime)
                    .ok_or(ApiError::UnsupportedDocumentImage)?;
                let file_name = field
                    .file_name()
                    .and_then(|name| name.rsplit(['/', '\\']).next())
                    .filter(|name| !name.trim().is_empty() && !name.chars().any(char::is_control))
                    .ok_or_else(|| invalid("file.filename"))?
                    .to_owned();
                let bytes = read_part(field, FILE_MAX_BYTES).await?;
                if !kind.matches_signature(&bytes) {
                    return Err(invalid("file"));
                }
                attachments.push(Attachment {
                    kind,
                    file_name,
                    bytes,
                });
            }
            Some("file") => return Err(invalid("file")),
            _ => return Err(invalid("multipart")),
        }
    }
    let category = category.ok_or_else(|| invalid("category"))?;
    if attachments.is_empty() {
        return Err(invalid("file"));
    }

    let reading = read_files(reader, category, &attachments).await?;
    Ok((StatusCode::OK, Json(reading)))
}

/// Reads the files as one document of the given category. The handler only
/// validates the form; this is the whole reading.
pub async fn read_files(
    reader: &DocumentReader,
    category: DocumentCategory,
    attachments: &[Attachment],
) -> Result<DocumentReading, ApiError> {
    let request =
        |instructions: &'static str, schema_name: &'static str, schema: Value| ReadingRequest {
            instructions,
            schema_name,
            schema,
            attachments,
        };
    let (matches_category, mut warnings, data) = match category {
        DocumentCategory::DominicanIdCard => {
            let raw = reader
                .read(request(
                    ID_CARD_PROMPT.as_str(),
                    "dominican_id_card",
                    schemas::id_card_schema(),
                ))
                .await?;
            let mut reading = decode::<IdCardData>(raw)?;
            check_id_card(&mut reading.data, &mut reading.warnings);
            (
                reading.matches_category,
                reading.warnings,
                ReadingData::DominicanIdCard(reading.data),
            )
        }
        DocumentCategory::VehicleRegistration => {
            let raw = reader
                .read(request(
                    VEHICLE_PROMPT.as_str(),
                    "vehicle_registration",
                    schemas::vehicle_registration_schema(),
                ))
                .await?;
            let mut reading = decode::<VehicleRegistrationData>(raw)?;
            check_vehicle_registration(&mut reading.data, &mut reading.warnings);
            (
                reading.matches_category,
                reading.warnings,
                ReadingData::VehicleRegistration(reading.data),
            )
        }
        DocumentCategory::BillOfLading => {
            let raw = reader
                .read(request(
                    BILL_OF_LADING_PROMPT.as_str(),
                    "bill_of_lading",
                    schemas::bill_of_lading_schema(),
                ))
                .await?;
            let mut reading = decode::<BillOfLadingData>(raw)?;
            check_bill_of_lading(&mut reading.data, &mut reading.warnings);
            (
                reading.matches_category,
                reading.warnings,
                ReadingData::BillOfLading(Box::new(reading.data)),
            )
        }
    };
    warnings.retain(|warning| !warning.trim().is_empty());

    Ok(DocumentReading {
        category,
        model: reader.model().to_owned(),
        matches_category,
        warnings,
        data,
    })
}

fn decode<T: DeserializeOwned>(mut raw: Value) -> Result<Envelope<T>, ApiError> {
    tidy(&mut raw);
    serde_json::from_value(raw).map_err(|error| {
        tracing::warn!(error = %error, "model output does not match the reading schema");
        ApiError::DocumentUnreadable
    })
}

/// Models sometimes leave tabs or blank strings; a blank value means unread.
fn tidy(value: &mut Value) {
    match value {
        Value::String(text) => {
            let trimmed = text.trim();
            if trimmed.is_empty() {
                *value = Value::Null;
            } else if trimmed.len() != text.len() {
                *text = trimmed.to_owned();
            }
        }
        Value::Array(items) => {
            items.iter_mut().for_each(tidy);
            items.retain(|item| !item.is_null());
        }
        Value::Object(fields) => fields.values_mut().for_each(tidy),
        _ => {}
    }
}

// ------------------------------------------------------------- Instructions

const COMMON_RULES: &str = "\
Reglas:
- Transcribe cada valor exactamente como está impreso, respetando mayúsculas, guiones y ceros. No traduzcas ni corrijas.
- Nunca inventes ni deduzcas un valor. Si un campo no aparece, está tapado o no se lee con seguridad, devuelve null y explica el motivo en warnings.
- Las fechas van en formato AAAA-MM-DD. Convierte meses escritos (\"16 ABRIL 1986\", \"Sep 16, 2026\") y fechas en casillas separadas (día, mes, año).
- Las fotos pueden estar rotadas, inclinadas, con reflejos o mostrar otros documentos al lado. Lee solo el documento pedido e ignora los demás.
- Si las imágenes no corresponden al tipo de documento pedido, devuelve matches_category=false.
- warnings va en español, con frases cortas. Déjalo vacío si todo se leyó bien.";

const ID_CARD_INSTRUCTIONS: &str = "\
Eres un lector de documentos de identidad de la República Dominicana.
Recibes fotos de una Cédula de Identidad y Electoral emitida por la Junta Central Electoral (JCE).
Hay dos modelos:
- current: cédula biométrica (2023 en adelante), fondo azul y rosado, campos 'Número de cédula', 'Nombre', 'Apellido', 'Vigencia hasta' y un número de serie vertical junto a la foto.
- previous: cédula anterior, fondo color crema, campos 'Lugar de nacimiento', 'Fecha de nacimiento', 'Sexo', 'Sangre', 'Estado civil', 'Ocupación' y 'Fecha de expiración'. Nombres y apellidos aparecen juntos debajo de la foto: la primera línea son los nombres y la segunda los apellidos.
El número de cédula tiene 11 dígitos con formato 000-0000000-0. Si junto a la cédula aparece una licencia de conducir u otro documento, ignóralo.
Puede llegar el frente y el reverso; combina ambos lados.
";

const VEHICLE_REGISTRATION_INSTRUCTIONS: &str = "\
Eres un lector de documentos vehiculares de la República Dominicana.
Recibes el Certificado de Propiedad de Vehículos de Motor (matrícula) emitido por la Dirección General de Impuestos Internos (DGII).
Sección 1 'Datos del Vehículo': No. de Registro y Placa, Chasis, Estatus, Tipo de Emisión, Tipo de Vehículo, Marca, Modelo, Año de Fabricación, Color, Motor o No. de Serie, Pasajeros, Fuerza Motriz, Capacidad de Carga, Cilindros, No. de Puertas.
Sección 2 'Datos del Propietario': nombres o razón social, Cédula/Pasaporte/RNC, Dirección y No. de Registro y Placa Anterior.
El número del certificado está arriba a la derecha junto a 'No.' y la fecha de expedición en casillas de día, mes y año.
Ignora sellos, firmas y la línea de auditoría del funcionario al pie (usuario, hora y códigos).
";

const BILL_OF_LADING_INSTRUCTIONS: &str = "\
Eres un lector de documentos de comercio marítimo.
Recibes un Bill of Lading (Conocimiento de Embarque) de una naviera. Puede tener varias páginas que repiten el encabezado: no dupliques datos y une la descripción de carga de todas las páginas.
Extrae las partes (shipper, consignee, notify party y forwarding agent) con su dirección en una línea; si una parte no aparece, deja sus campos en null.
En 'Marks & Nos.' suelen venir el ITN#, números de contenedor y referencias: el ITN va en itn_number, los contenedores (4 letras y 7 dígitos) en container_numbers y el resto en marks_and_numbers.
Por cada mercancía crea un elemento en cargo. Si es un vehículo, completa vehicle con año, marca, modelo, color, motor y VIN. Las cláusulas legales, avisos de baterías y textos estándar de la naviera no son mercancía: no los incluyas en description.
En el peso, 'L' significa libras (LB) y 'K' kilos (KG).
";

fn instructions_with_rules(base: &'static str) -> String {
    format!("{base}\n{COMMON_RULES}")
}

// Built once per category on first use.
static ID_CARD_PROMPT: std::sync::LazyLock<String> =
    std::sync::LazyLock::new(|| instructions_with_rules(ID_CARD_INSTRUCTIONS));
static VEHICLE_PROMPT: std::sync::LazyLock<String> =
    std::sync::LazyLock::new(|| instructions_with_rules(VEHICLE_REGISTRATION_INSTRUCTIONS));
static BILL_OF_LADING_PROMPT: std::sync::LazyLock<String> =
    std::sync::LazyLock::new(|| instructions_with_rules(BILL_OF_LADING_INSTRUCTIONS));

// ------------------------------------------------------------- Local checks

/// Dominican cédulas end in a Luhn check digit over the first ten digits.
fn cedula_check_digit_valid(digits: &str) -> bool {
    let digits: Vec<u32> = digits.chars().filter_map(|c| c.to_digit(10)).collect();
    if digits.len() != 11 {
        return false;
    }
    let sum: u32 = digits[..10]
        .iter()
        .enumerate()
        .map(|(index, digit)| {
            let product = digit * if index % 2 == 0 { 1 } else { 2 };
            product / 10 + product % 10
        })
        .sum();
    (10 - sum % 10) % 10 == digits[10]
}

/// Canonical 000-0000000-0 when the value has exactly eleven digits.
fn format_cedula(value: &str) -> Option<String> {
    let digits: String = value.chars().filter(char::is_ascii_digit).collect();
    let only_digits_and_separators = value
        .chars()
        .all(|c| c.is_ascii_digit() || c == '-' || c == ' ');
    (digits.len() == 11 && only_digits_and_separators)
        .then(|| format!("{}-{}-{}", &digits[..3], &digits[3..10], &digits[10..]))
}

fn check_cedula(field: &str, value: &mut Option<String>, warnings: &mut Vec<String>) {
    let Some(text) = value.as_deref() else { return };
    match format_cedula(text) {
        Some(formatted) => {
            if !cedula_check_digit_valid(&formatted) {
                warnings.push(format!(
                    "{field}: el dígito verificador no coincide; revisa el número leído."
                ));
            }
            *value = Some(formatted);
        }
        None => warnings.push(format!("{field}: no tiene los 11 dígitos de una cédula.")),
    }
}

fn check_date(field: &str, value: &Option<String>, warnings: &mut Vec<String>) {
    if let Some(text) = value
        && NaiveDate::parse_from_str(text, "%Y-%m-%d").is_err()
    {
        warnings.push(format!("{field}: la fecha no tiene formato AAAA-MM-DD."));
    }
}

fn check_id_card(data: &mut IdCardData, warnings: &mut Vec<String>) {
    check_cedula("id_number", &mut data.id_number, warnings);
    check_date("birth_date", &data.birth_date, warnings);
    check_date("expiration_date", &data.expiration_date, warnings);
}

fn check_vehicle_registration(data: &mut VehicleRegistrationData, warnings: &mut Vec<String>) {
    check_date("issue_date", &data.issue_date, warnings);
    // The owner may be a company (RNC, 9 digits) or a foreigner (passport).
    let is_cedula = data
        .owner
        .identity
        .as_deref()
        .is_some_and(|identity| identity.chars().filter(char::is_ascii_digit).count() == 11);
    if is_cedula {
        check_cedula("owner.identity", &mut data.owner.identity, warnings);
    }
    if let Some(chassis) = &data.chassis_number
        && chassis.len() == 17
        && chassis.chars().any(|c| matches!(c, 'I' | 'O' | 'Q'))
    {
        warnings
            .push("chassis_number: un VIN no lleva I, O ni Q; revisa el número leído.".to_owned());
    }
}

fn check_bill_of_lading(data: &mut BillOfLadingData, warnings: &mut Vec<String>) {
    check_date("issue_date", &data.issue_date, warnings);
    for (index, item) in data.cargo.iter().enumerate() {
        if let Some(vin) = &item.vehicle.vin
            && (vin.len() != 17 || vin.chars().any(|c| matches!(c, 'I' | 'O' | 'Q')))
        {
            warnings.push(format!(
                "cargo[{index}].vehicle.vin: no parece un VIN válido de 17 caracteres."
            ));
        }
    }
}

// ---------------------------------------------------------------- Multipart

fn invalid(field: &str) -> ApiError {
    ApiError::Validation(format!("Invalid value for: {field}"))
}

fn multipart_error(error: axum::extract::multipart::MultipartError) -> ApiError {
    if error.status() == StatusCode::PAYLOAD_TOO_LARGE {
        ApiError::PayloadTooLarge
    } else {
        invalid("multipart")
    }
}

async fn read_part(
    mut field: axum::extract::multipart::Field<'_>,
    max_bytes: usize,
) -> Result<Vec<u8>, ApiError> {
    let mut bytes = Vec::new();
    while let Some(chunk) = field.chunk().await.map_err(multipart_error)? {
        if chunk.len() > max_bytes - bytes.len() {
            return Err(ApiError::FileTooLarge);
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_cedula_check_digits() {
        // Synthetic numbers built with the same algorithm.
        assert!(cedula_check_digit_valid("001-0000001-7"));
        assert!(!cedula_check_digit_valid("001-0000001-8"));
        assert!(!cedula_check_digit_valid("001-000001-7"));
    }

    #[test]
    fn formats_cedulas() {
        assert_eq!(
            format_cedula("00100000019").as_deref(),
            Some("001-0000001-9")
        );
        assert_eq!(
            format_cedula("001 0000001 9").as_deref(),
            Some("001-0000001-9")
        );
        assert_eq!(format_cedula("A00100000019"), None);
    }

    #[test]
    fn tidies_blank_and_padded_values() {
        let mut value = serde_json::json!({"a": "B+\t", "b": "  ", "c": ["X", ""]});
        tidy(&mut value);
        assert_eq!(value, serde_json::json!({"a": "B+", "b": null, "c": ["X"]}));
    }

    #[test]
    fn flags_bad_dates() {
        let mut warnings = Vec::new();
        check_date("birth_date", &Some("16/04/1986".to_owned()), &mut warnings);
        check_date("birth_date", &Some("1986-04-16".to_owned()), &mut warnings);
        assert_eq!(warnings.len(), 1);
    }
}
