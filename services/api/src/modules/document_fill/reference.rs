//! Reviewed reference values, company profile values and company paragraph ranges.
//! Mirrors `reference-word.ts` (`referenceWordValue`, `referenceDate`, `referenceTreatment`,
//! `reviewedVehicleDescription`), `reviewedReferenceValues` and `addCompanyEdits` in
//! `native-document.ts`, and the company helpers they use (`companyProfileValue`,
//! `declaracionJuradaSignatureName`, `declaracionJuradaWitnessValue`, `companyReferenceValue`).

use std::collections::HashMap;

use chrono::{Datelike, NaiveDate};

use super::{
    dom::{Dom, Id},
    engine::{Edit, EngineError, Segment},
    format::{MONTHS_LOWER, integer_words, parse_calendar_date},
    reviewed::ReviewedModel,
    tables::{CLAUSE_DEFAULTS, COMPANY_LABELS, CONTRACT_CLAUSE_MARKERS, company_ranges},
};

/// Company profile of the issuing company (`CompanyProfile` in `native-document.ts`).
#[derive(Clone, Debug)]
pub struct CompanyProfile {
    pub name: String,
    pub values: HashMap<String, String>,
}

/// Vehicle of the operation (`Vehicle` in `clients-api.ts`). Every field is optional.
#[derive(Clone, Debug, Default)]
pub struct Vehicle {
    pub vehicle_type: Option<String>,
    pub make: Option<String>,
    pub model: Option<String>,
    pub year: Option<String>,
    pub color: Option<String>,
    pub registration_number: Option<String>,
    pub chassis_number: Option<String>,
    pub plate: Option<String>,
    pub engine_number: Option<String>,
}

fn trimmed(value: Option<&str>) -> &str {
    value.map(str::trim).unwrap_or("")
}

pub(crate) fn utf16_len(text: &str) -> usize {
    text.encode_utf16().count()
}

/// Byte index of a UTF-16 offset; `None` when the offset falls inside a surrogate pair.
pub(crate) fn utf16_to_byte(text: &str, offset: usize) -> Option<usize> {
    let mut units = 0;
    for (index, character) in text.char_indices() {
        if units == offset {
            return Some(index);
        }
        if units > offset {
            return None;
        }
        units += character.len_utf16();
    }
    (units == offset).then_some(text.len())
}

fn is_combining(character: char) -> bool {
    ('\u{0300}'..='\u{036f}').contains(&character)
}

/// Base letter of a precomposed Latin-1 letter, as NFD followed by mark removal gives it.
fn base_letter(character: char) -> char {
    const GROUPS: [(&str, char); 14] = [
        ("àáâãäå", 'a'),
        ("ÀÁÂÃÄÅ", 'A'),
        ("ç", 'c'),
        ("Ç", 'C'),
        ("èéêë", 'e'),
        ("ÈÉÊË", 'E'),
        ("ìíîï", 'i'),
        ("ÌÍÎÏ", 'I'),
        ("ñ", 'n'),
        ("Ñ", 'N'),
        ("òóôõö", 'o'),
        ("ÒÓÔÕÖ", 'O'),
        ("ùúûü", 'u'),
        ("ÙÚÛÜ", 'U'),
    ];
    GROUPS
        .iter()
        .find(|(letters, _)| letters.contains(character))
        .map(|(_, base)| *base)
        .unwrap_or(character)
}

/// `normalize("NFD").replace(/\p{M}/gu, "")` for the Latin-1 letters used in Spanish names.
fn strip_marks(value: &str) -> String {
    value
        .chars()
        .filter(|character| !is_combining(*character))
        .map(base_letter)
        .collect()
}

fn normalized_name(name: &str) -> String {
    strip_marks(name)
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_uppercase()
}

/// Profile key for a financing clause or its long Word marker.
pub(crate) fn contract_clause_key(key: &str) -> Option<&'static str> {
    CONTRACT_CLAUSE_MARKERS
        .iter()
        .find_map(|&(word, profile)| (word == key || profile == key).then_some(profile))
}

/// `companyProfileValue`: the saved value, or the shared model default when the profile omits the key.
pub(crate) fn company_profile_value(values: &HashMap<String, String>, key: &str) -> String {
    let marker = key.to_lowercase();
    let profile_key = contract_clause_key(&marker).unwrap_or(marker.as_str());
    let saved = values
        .get(profile_key)
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .or_else(|| {
            values
                .get(&marker)
                .map(|value| value.trim())
                .filter(|value| !value.is_empty())
        });
    if let Some(saved) = saved {
        return saved.to_owned();
    }
    default_clause(profile_key)
        .or_else(|| default_clause(&marker))
        .unwrap_or("")
        .to_owned()
}

fn default_clause(key: &str) -> Option<&'static str> {
    CLAUSE_DEFAULTS
        .iter()
        .find(|(candidate, _)| *candidate == key)
        .map(|(_, value)| *value)
}

/// `companyFieldLabel`: the portal label, or the key words with the first letter capitalized.
pub(crate) fn company_field_label(key: &str) -> String {
    let normalized = key.to_lowercase();
    if let Some((_, label)) = COMPANY_LABELS
        .iter()
        .find(|(candidate, _)| *candidate == normalized)
    {
        return (*label).to_owned();
    }
    let words = normalized
        .chars()
        .skip("empresa_".len())
        .collect::<String>()
        .split('_')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join(" ");
    let mut characters = words.chars();
    match characters.next() {
        Some(first) => first.to_uppercase().collect::<String>() + characters.as_str(),
        None => key.to_owned(),
    }
}

/// `declaracionJuradaSignatureName`: «Juan Carlos Pérez Díaz» becomes «Juan C. Pérez Díaz».
pub(crate) fn declaration_signature_name(name: &str) -> String {
    let parts: Vec<&str> = name.split_whitespace().collect();
    let particle = |part: &&str| {
        matches!(
            part.to_lowercase().as_str(),
            "de" | "del" | "la" | "las" | "los" | "y"
        )
    };
    if parts.len() != 4 || parts.iter().any(particle) {
        return name.to_owned();
    }
    let second = parts[1];
    let mut characters = second.chars();
    let Some(first) = characters
        .next()
        .filter(|character| character.is_alphabetic())
    else {
        return name.to_owned();
    };
    let mut initial = first.to_string();
    for character in characters {
        if !is_combining(character) {
            break;
        }
        initial.push(character);
    }
    let dotted = format!("{initial}.");
    if utf16_len(second) == 1 || second == dotted {
        return name.to_owned();
    }
    let mut out: Vec<&str> = parts.clone();
    out[1] = &dotted;
    out.join(" ")
}

/// `declaracionJuradaWitnessValue`. Only the two witness keys have a value.
pub(crate) fn declaration_witness_value(
    values: &HashMap<String, String>,
    key: &str,
) -> Option<String> {
    if key != "empresa_testigo_richard" && key != "empresa_testigo_usuario" {
        return None;
    }
    let name = company_profile_value(values, key);
    if key == "empresa_testigo_richard" {
        return Some(name);
    }
    let full_name = values
        .get("empresa_testigo_usuario_nombre_declaracion")
        .map(|value| value.trim())
        .filter(|value| !value.is_empty());
    match full_name {
        Some(full)
            if normalized_name(&declaration_signature_name(full)) == normalized_name(&name) =>
        {
            Some(full.to_owned())
        }
        _ => Some(name),
    }
}

/// `cedulaWords`: «001-1465695-2» becomes «cero cero uno guion un millón … guion dos».
pub(crate) fn cedula_words(identity: Option<&str>) -> String {
    let input = trimmed(identity);
    let digits = input.chars().filter(char::is_ascii_digit).count();
    let shape_ok = (input.len() == 11 && digits == 11)
        || (input.len() == 13
            && input.is_char_boundary(3)
            && input.is_char_boundary(11)
            && input.bytes().enumerate().all(|(index, byte)| match index {
                3 | 11 => byte == b'-',
                _ => byte.is_ascii_digit(),
            }));
    if !shape_ok {
        return String::new();
    }
    let number = if input.len() == 11 {
        format!("{}-{}-{}", &input[..3], &input[3..10], &input[10..])
    } else {
        input.to_owned()
    };
    number
        .split('-')
        .map(cedula_segment_words)
        .collect::<Vec<_>>()
        .join(" guion ")
}

fn cedula_segment_words(segment: &str) -> String {
    if segment.is_empty() || !segment.bytes().all(|byte| byte.is_ascii_digit()) {
        return String::new();
    }
    let leading = segment.len() - segment.trim_start_matches('0').len();
    let rest = &segment[leading..];
    let mut words: Vec<String> = (0..leading).map(|_| "cero".to_owned()).collect();
    if !rest.is_empty() {
        words.push(integer_words(rest.parse().unwrap_or(0), false));
    }
    words.join(" ")
}

/// `expedienteVehicleDescription`: the vehicle as one line, with the labels of the case file.
pub(crate) fn expediente_vehicle_description(vehicle: &Vehicle) -> String {
    [
        ("Tipo", vehicle.vehicle_type.as_deref()),
        ("Marca", vehicle.make.as_deref()),
        ("Modelo", vehicle.model.as_deref()),
        ("Año", vehicle.year.as_deref()),
        ("Color", vehicle.color.as_deref()),
        ("Matrícula", vehicle.registration_number.as_deref()),
        ("Chasis", vehicle.chassis_number.as_deref()),
        ("Placa", vehicle.plate.as_deref()),
        ("Motor", vehicle.engine_number.as_deref()),
    ]
    .into_iter()
    .filter_map(|(label, value)| {
        let value = trimmed(value);
        (!value.is_empty()).then(|| format!("{label} {value}"))
    })
    .collect::<Vec<_>>()
    .join(", ")
}

fn starts_with_word(text: &str, words: &[&str]) -> bool {
    let lower = text.to_lowercase();
    words.iter().any(|word| {
        lower.strip_prefix(word).is_some_and(|rest| {
            !rest
                .chars()
                .next()
                .is_some_and(|next| next.is_ascii_alphanumeric() || next == '_')
        })
    })
}

/// `reviewedVehicleDescription`: a free-text description wins; the generated one is written in the reviewed style.
pub(crate) fn reviewed_vehicle_description(
    vehicle: &Vehicle,
    input: &str,
    reserve_missing: bool,
) -> String {
    if input.trim().to_uppercase() != expediente_vehicle_description(vehicle).to_uppercase() {
        return input.to_owned();
    }
    let vehicle_type = trimmed(vehicle.vehicle_type.as_deref());
    let article = if starts_with_word(
        vehicle_type,
        &[
            "camioneta",
            "furgoneta",
            "motocicleta",
            "miniván",
            "jeepeta",
            "yipeta",
            "pasola",
            "guagua",
        ],
    ) {
        "una"
    } else {
        "un"
    };
    let plate = trimmed(vehicle.plate.as_deref());
    let registration = trimmed(vehicle.registration_number.as_deref());
    let mut parts = Vec::new();
    if !vehicle_type.is_empty() {
        let has_article = starts_with_word(vehicle_type, &["un", "una"]);
        parts.push(if has_article {
            vehicle_type.to_owned()
        } else {
            format!("{article} {vehicle_type}")
        });
    }
    let engine = trimmed(vehicle.engine_number.as_deref());
    let placeholder = "____________________";
    let details: [(&str, Option<String>); 8] = [
        ("Marca", optional(trimmed(vehicle.make.as_deref()))),
        ("Modelo", optional(trimmed(vehicle.model.as_deref()))),
        ("Año", optional(trimmed(vehicle.year.as_deref()))),
        ("Color", optional(trimmed(vehicle.color.as_deref()))),
        (
            "Matrícula",
            (registration.to_uppercase() != plate.to_uppercase())
                .then(|| optional(registration))
                .flatten(),
        ),
        (
            "Placa",
            if !plate.is_empty() {
                Some(plate.to_owned())
            } else {
                reserve_missing.then(|| placeholder.to_owned())
            },
        ),
        (
            "Chasis",
            optional(trimmed(vehicle.chassis_number.as_deref())),
        ),
        (
            if reserve_missing {
                "Motor o N.º de serie"
            } else {
                "Motor"
            },
            if !engine.is_empty() {
                Some(engine.to_owned())
            } else {
                reserve_missing.then(|| placeholder.to_owned())
            },
        ),
    ];
    for (label, value) in details {
        if let Some(value) = value {
            parts.push(format!("{label} {value}"));
        }
    }
    parts.join(", ")
}

fn optional(value: &str) -> Option<String> {
    (!value.is_empty()).then(|| value.to_owned())
}

/// `numericDate`: «16/11/2026».
fn numeric_date(date: NaiveDate) -> String {
    format!("{:02}/{:02}/{:04}", date.day(), date.month(), date.year())
}

/// `referenceDate`: the date phrases of each reviewed model.
fn reference_date(model: ReviewedModel, key: &str, date: NaiveDate, occurrence: usize) -> String {
    let day = date.day();
    let year = date.year();
    let month_name = MONTHS_LOWER[date.month0() as usize];
    let day_words = integer_words(u64::from(day), false).to_uppercase();
    let month_upper = month_name.to_uppercase();
    let day_number = format!("{day:02}");
    let year_words = integer_words(year as u64, false).to_uppercase();
    if key == "fecha_firma" {
        return match model {
            ReviewedModel::AutorizacionDesembolso | ReviewedModel::AutorizacionAsegurarVehiculo => {
                numeric_date(date)
            }
            ReviewedModel::EntregaVehiculoFinesSaldo if occurrence == 0 => format!(
                "los {day_words} ({day_number}) DÍAS DEL MES DE {month_upper} DEL AÑO {year_words} ({year})"
            ),
            ReviewedModel::VentaCondicional => {
                format!(
                    "los {day_words} ({day_number}) DÍAS DEL MES DE {month_upper} DEL AÑO {year}"
                )
            }
            ReviewedModel::EntregaVehiculo => {
                format!(
                    "los {day_words} ({day_number}) DÍAS del mes de {month_upper} DEL AÑO {year}"
                )
            }
            _ => {
                let article = if model == ReviewedModel::DesignacionCuenta
                    || (model == ReviewedModel::AcuerdoSeguro && occurrence == 1)
                {
                    ""
                } else {
                    "los "
                };
                format!(
                    "{article}{day_words} ({day_number}) días del mes de {month_upper} del año {year}"
                )
            }
        };
    }
    if key == "fecha_contrato" || key == "fecha_cuota_final_capital" {
        return numeric_date(date);
    }
    if is_extraordinary_date_key(key) {
        let text = format!("{day} de {month_name} del año {year}");
        return if model == ReviewedModel::VentaCondicional {
            text.to_uppercase()
        } else {
            text
        };
    }
    format!("{day_words} ({day_number}) DE {month_upper} DEL AÑO {year_words} ({year})")
}

fn is_extraordinary_date_key(key: &str) -> bool {
    matches!(
        key,
        "fecha_abono_extraordinario_1"
            | "fecha_abono_extraordinario_2"
            | "fecha_ancla_cuota_extraordinaria"
    )
}

/// `referenceTreatment`: «Sr.» and «Sra.» phrases per model.
fn reference_treatment(model: ReviewedModel, input: &str) -> String {
    let lower = input.trim().to_lowercase();
    let rest = ["el ", "la "]
        .iter()
        .find_map(|article| lower.strip_prefix(article).map(|rest| rest.trim_start()))
        .unwrap_or(lower.as_str());
    let title = rest.strip_suffix('.').unwrap_or(rest);
    if !matches!(title, "sr" | "sra" | "señor" | "señora") {
        return input.to_owned();
    }
    let female = title.ends_with('a');
    let article = if female { "la" } else { "el" };
    let abbreviation = if female { "Sra." } else { "Sr." };
    match model {
        ReviewedModel::PagareAutentico => {
            format!("{article} {}", if female { "señora" } else { "señor" })
        }
        ReviewedModel::PagareSeguro => format!("{article} {}", abbreviation.to_uppercase()),
        ReviewedModel::EntregaVoluntaria => format!("{article} {abbreviation}"),
        ReviewedModel::AutorizacionDesembolso | ReviewedModel::EntregaVehiculoFinesSaldo => {
            format!("{article} {abbreviation}").to_uppercase()
        }
        _ => format!("{} {abbreviation}", article.to_uppercase()),
    }
}

/// Dates in the form «{DAY} ({dd}) DE {MONTH} DEL AÑO {YEAR} ({yyyy})», as `notarialDate` writes them.
/// Mirrors `/^.+? \((\d{1,2})\) DE ([A-ZÁÉÍÓÚÑ]+) DEL AÑO .+? \((\d{4})\)$/u`.
fn letters_date_parts(formatted: &str) -> Option<(String, String, String)> {
    let upper = |character: char| character.is_ascii_uppercase() || "ÁÉÍÓÚÑ".contains(character);
    for (start, _) in formatted.match_indices(" (") {
        if start < 1 {
            continue;
        }
        let after = &formatted[start + 2..];
        let day_len = after.bytes().take(2).take_while(u8::is_ascii_digit).count();
        if day_len == 0 {
            continue;
        }
        let day = &after[..day_len];
        let Some(tail) = after[day_len..].strip_prefix(") DE ") else {
            continue;
        };
        let month_len = tail
            .chars()
            .take_while(|character| upper(*character))
            .map(char::len_utf8)
            .sum::<usize>();
        if month_len == 0 {
            continue;
        }
        let month = &tail[..month_len];
        let Some(remainder) = tail[month_len..].strip_prefix(" DEL AÑO ") else {
            continue;
        };
        let Some(open) = remainder.rfind(" (") else {
            continue;
        };
        let year = &remainder[open + 2..];
        if open < 1
            || year.len() != 5
            || !year.ends_with(')')
            || !year[..4].bytes().all(|byte| byte.is_ascii_digit())
        {
            continue;
        }
        return Some((day.to_owned(), month.to_owned(), year[..4].to_owned()));
    }
    None
}

/// `referenceWordValue`: the value a reviewed body writes for one occurrence of a marker.
pub(crate) fn reference_word_value(
    model: ReviewedModel,
    key: &str,
    occurrence: usize,
    input: &str,
    formatted: &str,
) -> String {
    if formatted.is_empty() {
        return String::new();
    }
    if key.starts_with("fecha_")
        && let Some(date) = parse_calendar_date(input.trim())
    {
        return reference_date(model, key, date, occurrence);
    }
    if (key == "fecha_primera_cuota_intereses_letras" || key == "fecha_cuota_final_capital_letras")
        && let Some((day, month, year)) = letters_date_parts(formatted)
    {
        let day_number: u64 = day.parse().unwrap_or(0);
        let year_number: u64 = year.parse().unwrap_or(0);
        return format!(
            "{} ({day}) DE {month} DEL AÑO {} ({year})",
            integer_words(day_number, false).to_uppercase(),
            integer_words(year_number, false).to_uppercase()
        );
    }
    if is_extraordinary_amount_key(key) {
        return match formatted.strip_prefix("RD$") {
            Some(rest) => format!("RD$ {}", rest.trim_start()),
            None => formatted.to_owned(),
        };
    }
    if model == ReviewedModel::VentaCondicional && key == "vehiculo_tipo" {
        return strip_private_suffix(formatted).to_uppercase();
    }
    if key == "cliente_tratamiento" {
        return reference_treatment(model, formatted);
    }
    if key == "cliente_correo" {
        return input.trim().to_owned();
    }
    if key == "cliente_ocupacion" && model == ReviewedModel::DeclaracionJurada {
        return formatted.to_owned();
    }
    if [
        "nacionalidad",
        "estado_civil",
        "ocupacion",
        "origen_ingresos",
    ]
    .iter()
    .any(|suffix| key.ends_with(suffix))
    {
        return formatted.to_lowercase();
    }
    if key == "cliente_nombre"
        && occurrence == 1
        && matches!(
            model,
            ReviewedModel::VentaCondicional
                | ReviewedModel::ActoSeguro
                | ReviewedModel::DesignacionCuenta
        )
    {
        return input.trim().to_owned();
    }
    if key == "cliente_direccion" {
        return input.trim().to_owned();
    }
    let uppercase_key = matches!(
        key,
        "cliente_nombre"
            | "cliente_nombre_firma"
            | "cliente_direccion_transito"
            | "nombre_del_notario"
            | "representante_seguro_nombre"
            | "monto_desembolso"
            | "testigo_usuario"
            | "testigo_richard"
    ) || key.ends_with("_letras")
        || key.starts_with("vehiculo_");
    if uppercase_key {
        return formatted.to_uppercase();
    }
    formatted.to_owned()
}

fn is_extraordinary_amount_key(key: &str) -> bool {
    matches!(
        key,
        "abono_extraordinario_1_monto" | "abono_extraordinario_2_monto"
    )
}

/// `/\s+privad[oa]$/iu` removed from the end of a vehicle type.
fn strip_private_suffix(value: &str) -> &str {
    let characters: Vec<(usize, char)> = value.char_indices().collect();
    let Some(split) = characters.len().checked_sub(7) else {
        return value;
    };
    let tail: String = characters[split..]
        .iter()
        .map(|(_, character)| character.to_ascii_lowercase())
        .collect();
    if tail != "privado" && tail != "privada" {
        return value;
    }
    let head = &value[..characters[split].0];
    if !head.ends_with(char::is_whitespace) {
        return value;
    }
    head.trim_end()
}

/// `reviewedReferenceValues`: the values a reviewed body is filled with, before the marker pass.
pub(crate) fn reviewed_reference_values(
    reference: Option<ReviewedModel>,
    values: &HashMap<String, String>,
    vehicle: Option<&Vehicle>,
    profile: Option<&CompanyProfile>,
) -> HashMap<String, String> {
    let mut out = values.clone();
    if let (Some(model), Some(vehicle)) = (reference, vehicle)
        && let Some(warranty) = values
            .get("vehiculo_garantia")
            .filter(|value| !value.is_empty())
    {
        let description =
            reviewed_vehicle_description(vehicle, warranty, model == ReviewedModel::ActoSeguro);
        out.insert("vehiculo_garantia".to_owned(), description);
    }
    if let (Some(ReviewedModel::PagareAutentico), Some(profile)) = (reference, profile) {
        let mut witness_values = profile.values.clone();
        let saved = |key: &str| {
            profile
                .values
                .get(key)
                .map(|value| value.trim())
                .unwrap_or("")
                .is_empty()
        };
        if let Some(richard) = values
            .get("testigo_richard")
            .filter(|value| !value.is_empty())
            && saved("empresa_testigo_richard")
        {
            witness_values.insert("empresa_testigo_richard".to_owned(), richard.clone());
        }
        if let Some(usuario) = values
            .get("testigo_usuario")
            .filter(|value| !value.is_empty())
            && saved("empresa_testigo_usuario")
        {
            witness_values.insert("empresa_testigo_usuario".to_owned(), usuario.clone());
        }
        let richard = declaration_witness_value(&witness_values, "empresa_testigo_richard")
            .unwrap_or_else(|| values.get("testigo_richard").cloned().unwrap_or_default());
        let usuario = declaration_witness_value(&witness_values, "empresa_testigo_usuario")
            .unwrap_or_else(|| values.get("testigo_usuario").cloned().unwrap_or_default());
        out.insert("testigo_richard".to_owned(), richard);
        out.insert("testigo_usuario".to_owned(), usuario);
    }
    out
}

/// `companyReferenceValue`: the company's value for one reviewed span. `source` is the literal text found there.
fn company_reference_value(
    profile: &CompanyProfile,
    key: &str,
    source: &str,
    preview: bool,
) -> Result<String, EngineError> {
    let values = &profile.values;
    let mut value = values
        .get(key)
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty());
    if key == "empresa_representante_cedula_letras" {
        let words = cedula_words(
            values
                .get("empresa_representante_cedula")
                .map(String::as_str),
        );
        if !words.is_empty() {
            value = Some(words);
        }
    }
    if key == "empresa_representante_nombre_firma" && value.is_none() {
        value = values
            .get("empresa_representante_nombre")
            .map(|value| value.trim().to_owned())
            .filter(|value| !value.is_empty());
    }
    let Some(value) = value else {
        let label = company_field_label(key);
        if preview {
            return Ok(format!("[{label}]"));
        }
        return Err(EngineError::Value(format!(
            "Completa «{label}» en el perfil de {} para generar este documento.",
            profile.name
        )));
    };
    if source != source.to_lowercase() && source == source.to_uppercase() {
        return Ok(value.to_uppercase());
    }
    if [
        "empresa_tipo_cuenta",
        "empresa_representante_cargo",
        "empresa_representante_nacionalidad",
        "empresa_representante_estado_civil",
        "empresa_representante_ocupacion",
    ]
    .contains(&key)
    {
        let lower = value.to_lowercase();
        if source.chars().next().is_some_and(char::is_uppercase) {
            let mut characters = lower.chars();
            let first = characters
                .next()
                .map(|character| character.to_uppercase().collect::<String>());
            return Ok(first.unwrap_or_default() + characters.as_str());
        }
        return Ok(lower);
    }
    Ok(value)
}

/// The part that holds `word/document.xml`: its DOM, root namespace and index among the parts.
pub(crate) struct DocumentPart<'a> {
    pub dom: &'a Dom,
    pub namespace: &'a str,
    pub index: usize,
}

/// `addCompanyEdits`: resolves the company ranges of a reviewed body against the untouched text.
/// `edits` collects the per-segment edits.
pub(crate) fn add_company_edits(
    part: DocumentPart<'_>,
    model: ReviewedModel,
    profile: &CompanyProfile,
    preview: bool,
    segments: &[Segment],
    edits: &mut HashMap<usize, Vec<Edit>>,
) -> Result<(), EngineError> {
    let ranges = company_ranges(model);
    if ranges.is_empty() {
        return Ok(());
    }
    let DocumentPart {
        dom,
        namespace,
        index: document,
    } = part;
    let root = dom.root();
    let paragraphs = dom.descendants_named(root, namespace, "p");
    let mut locations: HashMap<Id, (usize, usize)> = HashMap::new();
    for (index, segment) in segments
        .iter()
        .enumerate()
        .filter(|(_, segment)| segment.part == document)
    {
        for node in &segment.nodes {
            locations.insert(node.node, (index, node.start));
        }
    }
    let witness_model = matches!(
        model,
        ReviewedModel::DeclaracionJurada | ReviewedModel::EntregaVoluntaria
    );
    for range in ranges {
        let mut matched = false;
        if let Some(&paragraph) = paragraphs.get(range.paragraph) {
            let mut offset = 0usize;
            for node in dom.descendants_named(paragraph, namespace, "t") {
                let end = offset + utf16_len(&dom.text_content(node));
                if range.start >= offset && range.start < end {
                    let Some(&(segment_index, node_start)) = locations.get(&node) else {
                        break;
                    };
                    let segment = &segments[segment_index];
                    let segment_offset = utf16_len(&segment.text[..node_start]);
                    let start16 = segment_offset + (range.start - offset);
                    let stop16 = start16 + (range.end - range.start);
                    if stop16 > utf16_len(&segment.text) {
                        break;
                    }
                    let (Some(start), Some(stop)) = (
                        utf16_to_byte(&segment.text, start16),
                        utf16_to_byte(&segment.text, stop16),
                    ) else {
                        break;
                    };
                    let literal = &segment.text[start..stop];
                    let witness = witness_model
                        .then(|| declaration_witness_value(&profile.values, range.key))
                        .flatten();
                    let value = match witness {
                        Some(witness) => witness.to_uppercase(),
                        None => company_reference_value(profile, range.key, literal, preview)?,
                    };
                    let bold = model.bold_fields().contains(&range.key);
                    if value != literal || bold {
                        edits.entry(segment_index).or_default().push(Edit {
                            start,
                            end: stop,
                            value,
                            bold,
                            runs: None,
                        });
                    }
                    matched = true;
                    break;
                }
                offset = end;
            }
        }
        if !matched {
            return Err(EngineError::Value(
                "El modelo compartido no coincide con el formato revisado.".to_owned(),
            ));
        }
    }
    Ok(())
}
