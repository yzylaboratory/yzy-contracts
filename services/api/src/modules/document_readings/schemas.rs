//! Typed results of each document category and the JSON Schemas sent to the
//! model. A unit test keeps both in sync.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};
use utoipa::ToSchema;

fn text(description: &str) -> Value {
    json!({ "type": ["string", "null"], "description": description })
}

fn flag(description: &str) -> Value {
    json!({ "type": ["boolean", "null"], "description": description })
}

fn texts(description: &str) -> Value {
    json!({ "type": "array", "items": { "type": "string" }, "description": description })
}

/// Strict mode requires every property and forbids extra ones.
fn object(properties: &[(&str, Value)]) -> Value {
    let required: Vec<&str> = properties.iter().map(|(name, _)| *name).collect();
    let properties: Map<String, Value> = properties
        .iter()
        .map(|(name, schema)| ((*name).to_owned(), schema.clone()))
        .collect();
    json!({
        "type": "object",
        "properties": properties,
        "required": required,
        "additionalProperties": false,
    })
}

/// Leaf paths of a data schema, such as `owner.identity` or `cargo[].vehicle.vin`.
fn field_paths(schema: &Value, prefix: &str, paths: &mut Vec<String>) {
    if let Some(properties) = schema["properties"].as_object() {
        for (name, property) in properties {
            let path = if prefix.is_empty() {
                name.clone()
            } else {
                format!("{prefix}.{name}")
            };
            field_paths(property, &path, paths);
        }
    } else if schema["items"].is_object() && schema["items"]["properties"].is_object() {
        field_paths(&schema["items"], &format!("{prefix}[]"), paths);
    } else {
        paths.push(prefix.to_owned());
    }
}

/// Every category answers with the same envelope around its own data.
pub(super) fn envelope(data: Value) -> Value {
    let mut fields = vec![DOCUMENT_FIELD.to_owned()];
    field_paths(&data, "", &mut fields);
    object(&[
        (
            "matches_category",
            json!({
                "type": "boolean",
                "description": "true solo si el documento es del tipo solicitado.",
            }),
        ),
        (
            "warnings",
            json!({
                "type": "array",
                "description": "Avisos sobre campos ilegibles, tapados o dudosos. Uno por campo.",
                "items": object(&[
                    ("field", json!({
                        "type": "string",
                        "enum": fields,
                        "description": "Campo afectado, o \"document\" para un aviso sobre el documento entero.",
                    })),
                    ("message", json!({
                        "type": "string",
                        "description": "Frase corta en español, sin repetir el nombre del campo.",
                    })),
                ]),
            }),
        ),
        ("data", data),
    ])
}

/// Field of a warning that concerns the whole document.
pub const DOCUMENT_FIELD: &str = "document";

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Envelope<T> {
    pub matches_category: bool,
    pub warnings: Vec<ReadingWarning>,
    pub data: T,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct ReadingWarning {
    /// Path of the affected field in `data`, such as `id_number`,
    /// `owner.identity` or `cargo[].vehicle.vin`; `document` for the whole document.
    pub field: String,
    /// Short sentence in Spanish, without the field name.
    pub message: String,
}

impl ReadingWarning {
    pub(super) fn new(field: &str, message: impl Into<String>) -> Self {
        Self {
            field: field.to_owned(),
            message: message.into(),
        }
    }
}

// ---------------------------------------------------------------- Cédula

#[derive(Debug, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct IdCardData {
    /// `current` for the biometric card (2023 onwards), `previous` for the older one.
    pub card_version: Option<String>,
    /// Formatted as 000-0000000-0.
    pub id_number: Option<String>,
    pub given_names: Option<String>,
    pub surnames: Option<String>,
    pub full_name: Option<String>,
    /// YYYY-MM-DD.
    pub birth_date: Option<String>,
    pub birth_place: Option<String>,
    pub nationality: Option<String>,
    /// `M` or `F`.
    pub sex: Option<String>,
    pub blood_type: Option<String>,
    pub marital_status: Option<String>,
    pub occupation: Option<String>,
    /// YYYY-MM-DD ("Vigencia hasta" or "Fecha de expiración").
    pub expiration_date: Option<String>,
    /// Card serial printed beside the photo on the current card.
    pub card_serial: Option<String>,
}

pub(super) fn id_card_schema() -> Value {
    envelope(object(&[
        (
            "card_version",
            json!({
                "type": ["string", "null"],
                "enum": ["current", "previous", null],
                "description": "current: cédula biométrica azul/rosada con 'Vigencia hasta'. previous: cédula anterior color crema con 'Fecha de expiración'.",
            }),
        ),
        (
            "id_number",
            text("Número de cédula con formato 000-0000000-0."),
        ),
        ("given_names", text("Nombres, tal como aparecen.")),
        ("surnames", text("Apellidos, tal como aparecen.")),
        ("full_name", text("Nombres seguidos de apellidos.")),
        (
            "birth_date",
            text("Fecha de nacimiento en formato AAAA-MM-DD."),
        ),
        ("birth_place", text("Lugar de nacimiento.")),
        ("nationality", text("Nacionalidad.")),
        ("sex", text("M o F.")),
        ("blood_type", text("Tipo de sangre, por ejemplo A+.")),
        ("marital_status", text("Estado civil.")),
        ("occupation", text("Ocupación u oficio.")),
        (
            "expiration_date",
            text("Vigencia hasta o fecha de expiración, AAAA-MM-DD."),
        ),
        (
            "card_serial",
            text("Número de serie vertical junto a la foto (solo cédula nueva)."),
        ),
    ]))
}

// ---------------------------------------------------- Matrícula de vehículo

#[derive(Debug, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct VehicleRegistrationData {
    pub certificate_number: Option<String>,
    /// YYYY-MM-DD.
    pub issue_date: Option<String>,
    /// "No. de Registro y Placa", same field as a case file's vehicle.
    pub registration_number: Option<String>,
    pub previous_registration_number: Option<String>,
    pub chassis_number: Option<String>,
    pub status: Option<String>,
    pub emission_type: Option<String>,
    pub vehicle_type: Option<String>,
    pub make: Option<String>,
    pub model: Option<String>,
    pub year: Option<String>,
    pub color: Option<String>,
    pub engine_number: Option<String>,
    pub passengers: Option<String>,
    pub engine_power: Option<String>,
    pub load_capacity_tons: Option<String>,
    pub cylinders: Option<String>,
    pub doors: Option<String>,
    pub owner: VehicleOwner,
}

#[derive(Debug, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct VehicleOwner {
    pub name: Option<String>,
    /// Cédula (000-0000000-0), passport or RNC.
    pub identity: Option<String>,
    pub address: Option<String>,
}

pub(super) fn vehicle_registration_schema() -> Value {
    envelope(object(&[
        (
            "certificate_number",
            text("No. del certificado, arriba a la derecha."),
        ),
        ("issue_date", text("Fecha de expedición, AAAA-MM-DD.")),
        (
            "registration_number",
            text("No. de Registro y Placa, por ejemplo K1612375."),
        ),
        (
            "previous_registration_number",
            text("No. de Registro y Placa Anterior."),
        ),
        ("chassis_number", text("Chasis (VIN).")),
        ("status", text("Estatus del vehículo.")),
        ("emission_type", text("Tipo de emisión.")),
        ("vehicle_type", text("Tipo de vehículo.")),
        ("make", text("Marca.")),
        ("model", text("Modelo.")),
        ("year", text("Año de fabricación.")),
        ("color", text("Color.")),
        ("engine_number", text("Motor o No. de serie.")),
        ("passengers", text("Pasajeros.")),
        ("engine_power", text("Fuerza motriz (HP/cc).")),
        (
            "load_capacity_tons",
            text("Capacidad de carga en toneladas."),
        ),
        ("cylinders", text("Cilindros.")),
        ("doors", text("No. de puertas.")),
        (
            "owner",
            object(&[
                ("name", text("Nombres o razón social del propietario.")),
                ("identity", text("Cédula (000-0000000-0), pasaporte o RNC.")),
                ("address", text("Dirección del propietario.")),
            ]),
        ),
    ]))
}

// ------------------------------------------------------------ Bill of lading

#[derive(Debug, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct BillOfLadingData {
    pub carrier: Option<String>,
    pub bill_of_lading_number: Option<String>,
    pub booking_number: Option<String>,
    /// YYYY-MM-DD.
    pub issue_date: Option<String>,
    pub scac_code: Option<String>,
    pub shipper: Party,
    pub consignee: Party,
    pub notify_party: Party,
    pub forwarding_agent: Party,
    pub vessel: Option<String>,
    pub voyage: Option<String>,
    pub flag: Option<String>,
    pub place_of_receipt: Option<String>,
    pub port_of_loading: Option<String>,
    pub port_of_discharge: Option<String>,
    pub place_of_delivery: Option<String>,
    pub country_of_origin: Option<String>,
    pub move_type: Option<String>,
    /// `PREPAID` or `COLLECT`.
    pub freight_terms: Option<String>,
    pub itn_number: Option<String>,
    pub container_numbers: Vec<String>,
    pub marks_and_numbers: Vec<String>,
    pub cargo: Vec<CargoItem>,
}

#[derive(Debug, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct Party {
    pub name: Option<String>,
    pub address: Option<String>,
    pub tax_id: Option<String>,
    pub email: Option<String>,
    pub phone: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct CargoItem {
    pub packages: Option<String>,
    pub description: Option<String>,
    pub hazardous: Option<bool>,
    pub un_number: Option<String>,
    pub gross_weight: Option<String>,
    /// `LB` or `KG`.
    pub weight_unit: Option<String>,
    pub volume: Option<String>,
    pub volume_unit: Option<String>,
    /// All fields are null when the item is not a vehicle.
    pub vehicle: CargoVehicle,
}

#[derive(Debug, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct CargoVehicle {
    pub year: Option<String>,
    pub make: Option<String>,
    pub model: Option<String>,
    pub color: Option<String>,
    pub engine: Option<String>,
    pub vin: Option<String>,
}

fn party_schema(role: &str) -> Value {
    object(&[
        ("name", text(&format!("Nombre de {role}."))),
        (
            "address",
            text("Dirección completa en una línea, separada por comas."),
        ),
        ("tax_id", text("RNC, EIN u otro identificador fiscal.")),
        ("email", text("Correo electrónico.")),
        ("phone", text("Teléfono.")),
    ])
}

pub(super) fn bill_of_lading_schema() -> Value {
    envelope(object(&[
        ("carrier", text("Naviera o transportista que emite el BL.")),
        ("bill_of_lading_number", text("Número de Bill of Lading.")),
        ("booking_number", text("Booking No. / Reserva.")),
        ("issue_date", text("Fecha del BL, AAAA-MM-DD.")),
        ("scac_code", text("SCAC code.")),
        ("shipper", party_schema("el embarcador (shipper)")),
        ("consignee", party_schema("el consignatario (consignee)")),
        (
            "notify_party",
            party_schema("la parte a notificar (notify party)"),
        ),
        (
            "forwarding_agent",
            party_schema("el agente embarcador (forwarding agent)"),
        ),
        ("vessel", text("Nombre del buque.")),
        ("voyage", text("Número de viaje.")),
        ("flag", text("Bandera.")),
        ("place_of_receipt", text("Lugar de recepción.")),
        ("port_of_loading", text("Puerto de carga.")),
        ("port_of_discharge", text("Puerto de descarga.")),
        ("place_of_delivery", text("Lugar de entrega.")),
        ("country_of_origin", text("País de origen de la mercancía.")),
        (
            "move_type",
            text("Tipo de movimiento, por ejemplo PORT TO PORT."),
        ),
        (
            "freight_terms",
            json!({
                "type": ["string", "null"],
                "enum": ["PREPAID", "COLLECT", null],
                "description": "Flete prepagado (PREPAID) o a cobrar (COLLECT).",
            }),
        ),
        ("itn_number", text("ITN# si aparece.")),
        (
            "container_numbers",
            texts("Números de contenedor (4 letras + 7 dígitos)."),
        ),
        (
            "marks_and_numbers",
            texts("Cada línea de Marks & Nos., sin repetir el ITN ni contenedores."),
        ),
        (
            "cargo",
            json!({
                "type": "array",
                "description": "Una entrada por mercancía descrita.",
                "items": object(&[
                    ("packages", text("Cantidad y tipo de bultos, por ejemplo '1 AUTO'.")),
                    ("description", text("Descripción de la carga, resumida en una línea.")),
                    ("hazardous", flag("Material peligroso (columna HM).")),
                    ("un_number", text("Número UN, por ejemplo UN3166.")),
                    ("gross_weight", text("Peso bruto, solo el número.")),
                    ("weight_unit", json!({
                        "type": ["string", "null"],
                        "enum": ["LB", "KG", null],
                        "description": "L o LB = libras; K o KG = kilos.",
                    })),
                    ("volume", text("Volumen, solo el número.")),
                    ("volume_unit", text("Unidad del volumen, por ejemplo CU.FT o CBM.")),
                    ("vehicle", object(&[
                        ("year", text("Año del vehículo.")),
                        ("make", text("Marca.")),
                        ("model", text("Modelo.")),
                        ("color", text("Color.")),
                        ("engine", text("Motor o cilindrada, por ejemplo 1.5L.")),
                        ("vin", text("VIN de 17 caracteres.")),
                    ])),
                ]),
            }),
        ),
    ]))
}

#[cfg(test)]
mod tests {
    use serde::de::DeserializeOwned;

    use super::*;

    /// Builds the smallest value the schema allows and checks the Rust type
    /// accepts it, so a renamed or missing field fails here and not in production.
    fn sample(schema: &Value) -> Value {
        let types: Vec<&str> = match &schema["type"] {
            Value::String(kind) => vec![kind.as_str()],
            Value::Array(kinds) => kinds.iter().filter_map(Value::as_str).collect(),
            _ => panic!("schema without type: {schema}"),
        };
        if types.contains(&"object") {
            let properties = schema["properties"].as_object().expect("properties");
            let required: Vec<&str> = schema["required"]
                .as_array()
                .expect("required")
                .iter()
                .filter_map(Value::as_str)
                .collect();
            assert_eq!(
                required.len(),
                properties.len(),
                "all properties are required"
            );
            assert_eq!(schema["additionalProperties"], false);
            return Value::Object(
                properties
                    .iter()
                    .map(|(name, property)| (name.clone(), sample(property)))
                    .collect(),
            );
        }
        if types.contains(&"array") {
            return Value::Array(vec![sample(&schema["items"])]);
        }
        match types[0] {
            "string" => json!("X"),
            "boolean" => json!(true),
            other => panic!("unexpected type {other}"),
        }
    }

    fn accepts<T: DeserializeOwned>(schema: Value) {
        serde_json::from_value::<Envelope<T>>(sample(&schema)).expect("schema matches type");
    }

    #[test]
    fn warnings_name_leaf_fields() {
        let schema = bill_of_lading_schema();
        let fields = schema["properties"]["warnings"]["items"]["properties"]["field"]["enum"]
            .as_array()
            .expect("enum");
        for path in [
            "document",
            "shipper.name",
            "cargo[].vehicle.vin",
            "container_numbers",
        ] {
            assert!(fields.iter().any(|field| field == path), "{path}");
        }
    }

    #[test]
    fn schemas_match_types() {
        accepts::<IdCardData>(id_card_schema());
        accepts::<VehicleRegistrationData>(vehicle_registration_schema());
        accepts::<BillOfLadingData>(bill_of_lading_schema());
    }
}
