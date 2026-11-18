//! Native manifest fields, validation and company snapshots from contract-template-fields.ts.
use std::sync::LazyLock;

use regex::Regex;
use unicode_normalization::UnicodeNormalization;
use uuid::Uuid;

use crate::{
    error::ApiError,
    modules::{
        companies::{CompanySnapshot, MAX_VALUE_CHARACTERS},
        document_fill::{
            CompanyProfile,
            format::{
                DateStyle, FieldKind, FieldSpec, document_clause_case, format_word_value,
                parse_calendar_date,
            },
            reference::{
                cedula_words, company_field_label, company_profile_value, contract_clause_key,
            },
        },
        templates::NativeVariable,
    },
};

use super::{
    catalog::{CaseDocumentType, CaseDocumentType::*, aliases},
    values::{CaseValues, Values, count_words, is_safe, notarial_money_words},
};

pub(super) fn normalized_words(value: &str) -> String {
    value
        .nfd()
        .filter(|ch| !unicode_normalization::char::is_combining_mark(*ch))
        .flat_map(char::to_lowercase)
        .collect::<String>()
        .split(|ch: char| !ch.is_ascii_alphanumeric())
        .filter(|word| !word.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

pub(super) fn filename_base(title: &str, catalog_key: Option<&str>) -> String {
    match catalog_key {
        Some("pagare_seguro") => return "pagare-de-seguro".into(),
        Some("pagare_autentico") => return "pagare-autentico".into(),
        Some("autorizacion_asegurar_vehiculo") => {
            return "autorizacion-para-asegurar-vehiculo".into();
        }
        Some("acuerdo_seguro") => return "acuerdo-de-seguro".into(),
        _ => {}
    }
    if [
        VentaCondicional,
        DeclaracionJurada,
        LevantamientoOposicion,
        Gps,
    ]
    .iter()
    .any(|kind| kind.label() == title)
    {
        return title.to_owned();
    }
    let decomposed = title
        .to_lowercase()
        .nfkd()
        .filter(|ch| !unicode_normalization::char::is_combining_mark(*ch))
        .collect::<String>();
    static SEPARATORS: LazyLock<Regex> = LazyLock::new(|| Regex::new("[^a-z0-9]+").unwrap());
    let slug: String = SEPARATORS
        .replace_all(&decomposed, "-")
        .chars()
        .take(80)
        .collect();
    match slug.trim_matches('-') {
        "pagare-autentico-notarial" => "pagare-autentico".into(),
        "" => "contrato".into(),
        slug => slug.into(),
    }
}

pub(super) fn issuer_field(key: &str) -> bool {
    key.starts_with("empresa_seguro_")
        || key.starts_with("emisor_seguro_")
        || key == "representante_seguro_nombre"
}

pub(super) fn company_field(key: &str) -> bool {
    key.strip_prefix("empresa_").is_some_and(|suffix| {
        !suffix.is_empty()
            && suffix.len() <= 56
            && suffix
                .bytes()
                .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_')
    })
}

fn notary_field(key: &str) -> Option<(&'static str, &'static str)> {
    Some(match key {
        "nombre_del_notario" => ("empresa_notario_nombre", "Nombre del notario"),
        "matricula_del_notario" => ("empresa_notario_matricula", "Matrícula del notario"),
        "cedula_del_notario" => ("empresa_notario_cedula", "Cédula del notario"),
        "domicilio_del_notario" => (
            "empresa_notario_domicilio",
            "Domicilio o estudio del notario",
        ),
        "nacionalidad_del_notario" => ("empresa_notario_nacionalidad", "Nacionalidad del notario"),
        _ => return None,
    })
}

fn witness_field(key: &str) -> Option<&'static str> {
    Some(match key {
        "testigo_richard" => "Nombre del primer testigo",
        "testigo_richard_cedula" => "Cédula del primer testigo",
        "testigo_usuario" => "Nombre del segundo testigo",
        "testigo_usuario_nacionalidad" => "Nacionalidad del segundo testigo",
        "testigo_usuario_estado_civil" => "Estado civil del segundo testigo",
        "testigo_usuario_cedula" => "Cédula del segundo testigo",
        _ => return None,
    })
}

fn word_label(word: &str) -> &str {
    match word {
        "adquisicion" => "adquisición",
        "anio" => "año",
        "antiguedad" => "antigüedad",
        "cedula" => "cédula",
        "certificacion" => "certificación",
        "compania" => "compañía",
        "conyuge" => "cónyuge",
        "credito" => "crédito",
        "demarcacion" => "demarcación",
        "dgii" => "DGII",
        "dias" => "días",
        "direccion" => "dirección",
        "gps" => "GPS",
        "instalacion" => "instalación",
        "jurisdiccion" => "jurisdicción",
        "matricula" => "matrícula",
        "numero" => "número",
        "ocupacion" => "ocupación",
        "operacion" => "operación",
        "oposicion" => "oposición",
        "prestamo" => "préstamo",
        "razon" => "razón",
        "relacion" => "relación",
        "renovacion" => "renovación",
        "rnc" => "RNC",
        "telefono" => "teléfono",
        "ultima" => "última",
        "vehiculo" => "vehículo",
        _ => word,
    }
}

pub(super) fn label(key: &str) -> String {
    if let Some(label) = witness_field(key) {
        return label.into();
    }
    if let Some((_, label)) = notary_field(key) {
        return label.into();
    }
    if let Some(key) = contract_clause_key(key) {
        return company_field_label(key);
    }
    match key {
        "fecha_firma" | "fecha_de_firma" => return "Fecha de firma".into(),
        "fecha_ancla_cuota_extraordinaria" => {
            return "Fecha de inicio de la cuota porcentual".into();
        }
        _ => {}
    }
    if company_field(key) {
        return company_field_label(key);
    }
    let words = key
        .split('_')
        .filter(|part| !part.is_empty())
        .map(word_label)
        .collect::<Vec<_>>()
        .join(" ");
    let label = words
        .strip_suffix(" si o no")
        .map_or(words.clone(), |base| format!("{base} (Sí o no)"));
    let mut chars = label.chars();
    chars
        .next()
        .into_iter()
        .flat_map(char::to_uppercase)
        .chain(chars)
        .collect()
}

pub(super) fn imported_optional(key: &str) -> bool {
    matches!(
        key,
        "vehiculo_tipo"
            | "vehiculo_placa"
            | "vehiculo_matricula"
            | "vehiculo_motor"
            | "tipo_del_vehiculo"
            | "placa_del_vehiculo"
            | "numero_de_serie_del_motor"
    )
}

fn vehicle_key(key: &str) -> bool {
    matches!(
        key,
        "vehiculo_tipo"
            | "vehiculo_marca"
            | "vehiculo_modelo"
            | "vehiculo_anio"
            | "vehiculo_color"
            | "vehiculo_matricula"
            | "vehiculo_chasis"
            | "vehiculo_placa"
            | "vehiculo_motor"
            | "vehiculo_garantia"
            | "vehiculo_descripcion"
            | "vehiculo_ano"
            | "tipo_del_vehiculo"
            | "marca_del_vehiculo"
            | "modelo_del_vehiculo"
            | "anio_del_vehiculo"
            | "color_del_vehiculo"
            | "placa_del_vehiculo"
            | "numero_de_chasis_del_vehiculo"
            | "numero_de_serie_del_motor"
    )
}

fn field_kind(key: &str) -> FieldKind {
    if key.ends_with("_letras") {
        FieldKind::Text
    } else if key == "fecha" || key.starts_with("fecha_") {
        FieldKind::Date
    } else if matches!(
        key,
        "numero_de_chasis_del_vehiculo" | "numero_de_serie_del_motor"
    ) {
        FieldKind::Text
    } else if key.contains("cedula") {
        FieldKind::Identity
    } else if key.contains("telefono") {
        FieldKind::Phone
    } else if key.contains("correo") || key.contains("email") {
        FieldKind::Email
    } else if key
        .split('_')
        .any(|part| matches!(part, "monto" | "total" | "saldo"))
    {
        FieldKind::Money
    } else if key.starts_with("numero_")
        || key.starts_with("cantidad_")
        || matches!(key, "vehiculo_anio" | "vehiculo_ano")
    {
        FieldKind::Integer
    } else {
        FieldKind::Text
    }
}

pub(super) fn fields(
    kind: CaseDocumentType,
    variables: &[NativeVariable],
    imported: bool,
) -> Vec<FieldSpec> {
    variables
        .iter()
        .map(|variable| {
            let key = variable.key.as_str();
            let field_kind = field_kind(key);
            let date_style = (field_kind == FieldKind::Date).then(|| {
                if key.starts_with("fecha_de_vencimiento_de_la_cuota_")
                    || matches!(key, "fecha_de_la_operacion" | "fecha_del_financiamiento")
                    || kind == AutorizacionDesembolso
                {
                    DateStyle::Numeric
                } else if (kind == EntregaVehiculo && key == "fecha_firma") || kind == AcuerdoSeguro
                {
                    DateStyle::Words
                } else if kind == DesignacionCuenta {
                    if key == "fecha_firma" {
                        DateStyle::NotarialAct
                    } else {
                        DateStyle::Numeric
                    }
                } else if (kind == VentaCondicional && key == "fecha_firma")
                    || (kind.notarial() && matches!(key, "fecha_firma" | "fecha_contrato"))
                {
                    DateStyle::NotarialAct
                } else if kind.notarial() {
                    DateStyle::Notarial
                } else {
                    DateStyle::Long
                }
            });
            FieldSpec {
                key: key.into(),
                label: label(key),
                kind: field_kind,
                required: !(imported && imported_optional(key)),
                date_style,
            }
        })
        .collect()
}

pub(super) fn is_company_snapshot_field(field: &FieldSpec, kind: CaseDocumentType) -> bool {
    company_field(&field.key)
        && !(kind.requires_issuer() && issuer_field(&field.key))
        && (kind != VentaCondicionalSeguro || contract_clause_key(&field.key).is_some())
}

fn words_source<'a>(key: &str, fields: &'a [FieldSpec]) -> Option<&'a FieldSpec> {
    let base = key.strip_suffix("_letras")?;
    fields
        .iter()
        .find(|field| field.key == base && field.kind != FieldKind::Text)
}

fn words_value(source: &FieldSpec, input: &str) -> String {
    static MONEY: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r"RD\$[0-9]{1,3}(?:,[0-9]{3})*\.[0-9]{2}").unwrap());
    match source.kind {
        FieldKind::Money => MONEY
            .find(input)
            .and_then(|found| {
                found
                    .as_str()
                    .chars()
                    .filter(char::is_ascii_digit)
                    .collect::<String>()
                    .parse()
                    .ok()
            })
            .map(notarial_money_words)
            .unwrap_or_default(),
        FieldKind::Integer => input
            .parse::<i64>()
            .ok()
            .filter(|&count| digits(input) && is_safe(count))
            .map(count_words)
            .unwrap_or_default(),
        FieldKind::Identity => cedula_words(Some(input)).to_uppercase(),
        _ => String::new(),
    }
}

pub(super) fn resolve_company_values(
    kind: CaseDocumentType,
    fields: &[FieldSpec],
    company: &CompanyProfile,
    case: &CaseValues,
) -> Values {
    let base: Values = fields
        .iter()
        .map(|field| {
            let key = field.key.as_str();
            let company_key = if let Some((key, _)) = notary_field(key) {
                Some(key.to_owned())
            } else if witness_field(key).is_some() {
                Some(format!("empresa_{key}"))
            } else if contract_clause_key(key).is_some()
                || (company_field(key)
                    && kind != VentaCondicionalSeguro
                    && !(kind.requires_issuer() && issuer_field(key)))
            {
                Some(key.to_owned())
            } else {
                None
            };
            let value = company_key.map_or_else(
                || case.get(key).to_owned(),
                |key| company_profile_value(&company.values, &key).replace(['\r', '\n', '\t'], " "),
            );
            (
                key.to_owned(),
                document_clause_case(
                    key,
                    &value,
                    kind.uppercase() && field.kind != FieldKind::Email,
                ),
            )
        })
        .collect();
    let mut values = base.clone();
    for field in fields {
        if let Some(source) = words_source(&field.key, fields)
            && values[&field.key].trim().is_empty()
        {
            let words = words_value(source, &base[&source.key]);
            values.insert(
                field.key.clone(),
                if kind.uppercase() {
                    words.to_uppercase()
                } else {
                    words
                },
            );
        }
    }
    values
}

fn digits(value: &str) -> bool {
    !value.is_empty() && value.bytes().all(|byte| byte.is_ascii_digit())
}

fn valid(field: &FieldSpec, input: &str) -> bool {
    static EMAIL: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$").unwrap()
    });
    static MONEY: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"^(?:RD\$[0-9]{1,3}(?:,[0-9]{3})*\.[0-9]{2}(?: \(.+\))?|.+ \(RD\$[0-9]{1,3}(?:,[0-9]{3})*\.[0-9]{2}\))$").unwrap()
    });
    let value = input.trim();
    if value.is_empty() {
        return !field.required;
    }
    match field.kind {
        FieldKind::Date => parse_calendar_date(value).is_some(),
        FieldKind::Identity => !cedula_words(Some(value)).is_empty(),
        FieldKind::Integer => digits(value) && value.parse::<i64>().is_ok_and(is_safe),
        FieldKind::Money => MONEY.is_match(value),
        FieldKind::Email => value.len() <= 254 && EMAIL.is_match(value),
        FieldKind::Phone => {
            value.bytes().filter(u8::is_ascii_digit).count() >= 7
                && value.chars().all(|ch| {
                    ch.is_ascii_digit() || ch.is_whitespace() || matches!(ch, '(' | ')' | '+' | '-')
                })
        }
        _ => true,
    }
}

pub(super) fn validate_and_snapshot(
    kind: CaseDocumentType,
    fields: &[FieldSpec],
    values: &Values,
    case: &CaseValues,
    company_id: Uuid,
    company_name: &str,
) -> Result<CompanySnapshot, ApiError> {
    let missing_vehicle: Vec<_> = fields
        .iter()
        .filter(|field| vehicle_key(&field.key) && !valid(field, &values[&field.key]))
        .collect();
    if !missing_vehicle.is_empty() {
        let names = missing_vehicle
            .iter()
            .map(|field| field.label.as_str())
            .collect::<Vec<_>>()
            .join(", ");
        let hint = if missing_vehicle
            .iter()
            .all(|field| imported_optional(&field.key))
        {
            " Si el vehículo es importado, elige «Bill of lading (importado)» en Documento del vehículo."
        } else {
            ""
        };
        return Err(ApiError::Validation(format!(
            "Completa en el expediente: {names}.{hint}"
        )));
    }
    let present = |key: &str| {
        values
            .get(key)
            .is_some_and(|value| !value.trim().is_empty())
    };
    for (key, message) in &case.issues {
        if issuer_field(key)
            || !(present(key)
                || (!aliases(key).is_empty() && aliases(key).iter().all(|alias| present(alias))))
        {
            return Err(ApiError::Validation(message.clone()));
        }
    }
    let mut snapshot = CompanySnapshot {
        id: company_id,
        name: company_name.into(),
        values: Default::default(),
    };
    for field in fields {
        if words_source(&field.key, fields).is_some() {
            continue;
        }
        let value = &values[&field.key];
        if !valid(field, value) {
            let message = if notary_field(&field.key).is_some() {
                "Guarda los datos del notario en la configuración de la empresa.".into()
            } else if witness_field(&field.key).is_some() {
                "Completa los datos de los testigos en la configuración de la empresa.".into()
            } else {
                format!("Falta o es inválido el campo «{}».", field.label)
            };
            return Err(ApiError::Validation(message));
        }
    }
    for field in fields
        .iter()
        .filter(|field| is_company_snapshot_field(field, kind))
    {
        let value = &values[&field.key];
        if value.trim().chars().count() > MAX_VALUE_CHARACTERS
            && words_source(&field.key, fields).is_none()
        {
            return Err(ApiError::Validation(format!(
                "El valor de «{}» supera el máximo de {MAX_VALUE_CHARACTERS} caracteres.",
                field.label
            )));
        }
        snapshot.values.insert(
            field.key.clone(),
            format_word_value(field, value, kind.uppercase()).map_err(ApiError::Validation)?,
        );
    }
    snapshot.validate()?;
    Ok(snapshot)
}
