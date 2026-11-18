//! Value formatting for Word fills. Mirrors `template-fields.ts`
//! (`formatTemplateValue`), `native-document.ts` (`formatWordTemplateValue`),
//! `expediente-fields.ts` (`integerWords`, notarial and words dates) and
//! `documentClauseCase`.

use chrono::{Datelike, NaiveDate};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FieldKind {
    Text,
    Date,
    Identity,
    Amount,
    Duration,
    Email,
    Money,
    Integer,
    Phone,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DateStyle {
    Numeric,
    Long,
    Notarial,
    NotarialAct,
    Words,
}

#[derive(Clone, Debug)]
pub struct FieldSpec {
    pub key: String,
    pub label: String,
    pub kind: FieldKind,
    pub required: bool,
    pub date_style: Option<DateStyle>,
}

pub(crate) const MONTHS_LOWER: [&str; 12] = [
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
pub(crate) const MONTHS_UPPER: [&str; 12] = [
    "ENERO",
    "FEBRERO",
    "MARZO",
    "ABRIL",
    "MAYO",
    "JUNIO",
    "JULIO",
    "AGOSTO",
    "SEPTIEMBRE",
    "OCTUBRE",
    "NOVIEMBRE",
    "DICIEMBRE",
];

const MULTILINE_PAYMENT_KEYS: [&str; 6] = [
    "cuotas_intereses_numeros",
    "cuotas_intereses_fechas",
    "cuotas_intereses_montos",
    "cuotas_seguro_numeros",
    "cuotas_seguro_fechas",
    "cuotas_seguro_montos",
];

/// Strict `YYYY-MM-DD` that round-trips, as `parseCalendarDate` accepts it.
pub fn parse_calendar_date(value: &str) -> Option<NaiveDate> {
    let bytes = value.as_bytes();
    let shape_ok = bytes.len() == 10
        && bytes.iter().enumerate().all(|(index, byte)| match index {
            4 | 7 => *byte == b'-',
            _ => byte.is_ascii_digit(),
        });
    if !shape_ok || value.starts_with("0000") {
        return None;
    }
    NaiveDate::parse_from_str(value, "%Y-%m-%d").ok()
}

/// `formatTemplateValue` for a field, with the date style supplied explicitly.
fn format_with_style(field: &FieldSpec, input: &str, style: Option<DateStyle>) -> String {
    let value = input.trim();
    if let (FieldKind::Date, Some(style), Some(date)) =
        (field.kind, style, parse_calendar_date(value))
    {
        return format_date(date, style);
    }
    let formatted = if field.kind == FieldKind::Identity {
        identity_with_dashes(value)
    } else {
        value.to_owned()
    };
    if field.kind == FieldKind::Text {
        document_clause_case(&field.key, &formatted, false)
    } else {
        formatted
    }
}

/// `formatTemplateValue` (template-fields.ts).
pub fn format_template_value(field: &FieldSpec, input: &str) -> String {
    format_with_style(field, input, field.date_style)
}

/// `formatWordTemplateValue` (native-document.ts): one physical line per value
/// except for the payment columns, which keep their line breaks.
pub fn format_word_value(
    field: &FieldSpec,
    input: &str,
    uppercase: bool,
) -> Result<String, String> {
    let style = if field.key == "fecha_cuota_final_capital"
        && field.kind == FieldKind::Date
        && !matches!(
            field.date_style,
            Some(DateStyle::Notarial | DateStyle::NotarialAct)
        ) {
        Some(DateStyle::Numeric)
    } else {
        field.date_style
    };
    let formatted = format_with_style(field, input, style);
    let value = if MULTILINE_PAYMENT_KEYS.contains(&field.key.as_str()) {
        formatted
            .replace("\r\n", "\n")
            .replace('\r', "\n")
            .replace('\t', " ")
    } else {
        formatted.replace(['\r', '\n', '\t'], " ")
    };
    if value.chars().any(is_word_incompatible) {
        return Err(format!(
            "El valor de «{}» contiene caracteres incompatibles con Word.",
            field.label
        ));
    }
    Ok(document_clause_case(
        &field.key,
        &value,
        uppercase && field.kind != FieldKind::Email,
    ))
}

fn is_word_incompatible(character: char) -> bool {
    matches!(character as u32, 0x00..=0x08 | 0x0b | 0x0c | 0x0e..=0x1f | 0xfffe | 0xffff)
}

pub(crate) fn identity_with_dashes(value: &str) -> String {
    if value.len() == 11 && value.bytes().all(|byte| byte.is_ascii_digit()) {
        format!("{}-{}-{}", &value[..3], &value[3..10], &value[10..])
    } else {
        value.to_owned()
    }
}

/// `documentClauseCase` (expediente-fields.ts).
pub fn document_clause_case(key: &str, value: &str, uppercase: bool) -> String {
    if value.is_empty() {
        return String::new();
    }
    if uppercase {
        return value.to_uppercase();
    }
    if key.contains("nacionalidad") || key.contains("estado_civil") {
        return value.to_lowercase();
    }
    if is_contract_address_key(key) {
        return value.to_uppercase();
    }
    value.to_owned()
}

/// `isContractAddressKey`: a `direccion` or `domicilio` segment, unless the key names a mail address.
pub fn is_contract_address_key(key: &str) -> bool {
    let lower = key.to_lowercase();
    let has_segment = lower
        .split('_')
        .any(|segment| segment == "direccion" || segment == "domicilio");
    let excluded = ["correo", "email", "electronica", "electrónica"]
        .iter()
        .any(|word| lower.contains(word));
    has_segment && !excluded
}

pub(crate) fn format_date(date: NaiveDate, style: DateStyle) -> String {
    let month = date.month0() as usize;
    match style {
        DateStyle::Numeric => format!("{:02}/{:02}/{:04}", date.day(), date.month(), date.year()),
        DateStyle::Long => format!(
            "{} de {} de {}",
            date.day(),
            MONTHS_LOWER[month],
            date.year()
        ),
        DateStyle::Notarial => format!(
            "{} ({:02}) DE {} DEL AÑO {} ({})",
            strip_marks(&integer_words(u64::from(date.day()), false)).to_uppercase(),
            date.day(),
            MONTHS_UPPER[month],
            strip_marks(&integer_words(date.year() as u64, false)).to_uppercase(),
            date.year(),
        ),
        DateStyle::NotarialAct => format!(
            "{} ({:02}) días del mes de {} del año {}",
            strip_marks(&integer_words(u64::from(date.day()), false)).to_uppercase(),
            date.day(),
            MONTHS_UPPER[month],
            date.year(),
        ),
        DateStyle::Words => format!(
            "{} de {} del año {}",
            integer_words(u64::from(date.day()), false),
            MONTHS_LOWER[month],
            integer_words(date.year() as u64, false),
        ),
    }
}

const SMALL_NUMBERS: [&str; 30] = [
    "cero",
    "uno",
    "dos",
    "tres",
    "cuatro",
    "cinco",
    "seis",
    "siete",
    "ocho",
    "nueve",
    "diez",
    "once",
    "doce",
    "trece",
    "catorce",
    "quince",
    "dieciséis",
    "diecisiete",
    "dieciocho",
    "diecinueve",
    "veinte",
    "veintiuno",
    "veintidós",
    "veintitrés",
    "veinticuatro",
    "veinticinco",
    "veintiséis",
    "veintisiete",
    "veintiocho",
    "veintinueve",
];
const TENS: [&str; 10] = [
    "",
    "",
    "",
    "treinta",
    "cuarenta",
    "cincuenta",
    "sesenta",
    "setenta",
    "ochenta",
    "noventa",
];
const HUNDREDS: [&str; 10] = [
    "",
    "ciento",
    "doscientos",
    "trescientos",
    "cuatrocientos",
    "quinientos",
    "seiscientos",
    "setecientos",
    "ochocientos",
    "novecientos",
];
const SCALES: [(u64, &str, &str); 3] = [
    (1_000_000_000_000, "un billón", "billones"),
    (1_000_000, "un millón", "millones"),
    (1_000, "mil", "mil"),
];

/// `integerWords` (expediente-fields.ts): Spanish cardinal words; `before_noun` selects «un»/«veintiún».
pub fn integer_words(value: u64, before_noun: bool) -> String {
    for (divisor, single, plural) in SCALES {
        if value < divisor {
            continue;
        }
        let quotient = value / divisor;
        let remainder = value % divisor;
        let head = if quotient == 1 {
            single.to_owned()
        } else {
            format!("{} {plural}", integer_words(quotient, true))
        };
        return if remainder > 0 {
            format!("{head} {}", integer_words(remainder, before_noun))
        } else {
            head
        };
    }
    if value == 100 {
        return "cien".to_owned();
    }
    if value >= 100 {
        let prefix = HUNDREDS[(value / 100) as usize];
        return if !value.is_multiple_of(100) {
            format!("{prefix} {}", integer_words(value % 100, before_noun))
        } else {
            prefix.to_owned()
        };
    }
    if before_noun && value == 1 {
        return "un".to_owned();
    }
    if before_noun && value == 21 {
        return "veintiún".to_owned();
    }
    if (value as usize) < SMALL_NUMBERS.len() {
        return SMALL_NUMBERS[value as usize].to_owned();
    }
    let prefix = TENS[(value / 10) as usize];
    if !value.is_multiple_of(10) {
        format!("{prefix} y {}", integer_words(value % 10, before_noun))
    } else {
        prefix.to_owned()
    }
}

/// Removes diacritics the way `NFD` plus stripping combining marks does for Spanish text.
pub fn strip_marks(value: &str) -> String {
    value
        .chars()
        .map(|character| match character {
            'á' => 'a',
            'é' => 'e',
            'í' => 'i',
            'ó' => 'o',
            'ú' => 'u',
            'ü' => 'u',
            'ñ' => 'n',
            'Á' => 'A',
            'É' => 'E',
            'Í' => 'I',
            'Ó' => 'O',
            'Ú' => 'U',
            'Ü' => 'U',
            'Ñ' => 'N',
            other => other,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn field(key: &str, kind: FieldKind, style: Option<DateStyle>) -> FieldSpec {
        FieldSpec {
            key: key.to_owned(),
            label: key.to_owned(),
            kind,
            required: false,
            date_style: style,
        }
    }

    #[test]
    fn integer_words_follow_the_portal_rules() {
        assert_eq!(integer_words(0, false), "cero");
        assert_eq!(integer_words(16, false), "dieciséis");
        assert_eq!(integer_words(21, true), "veintiún");
        assert_eq!(integer_words(21, false), "veintiuno");
        assert_eq!(integer_words(100, false), "cien");
        assert_eq!(integer_words(101, false), "ciento uno");
        assert_eq!(integer_words(1_000, false), "mil");
        assert_eq!(integer_words(2_026, false), "dos mil veintiséis");
        assert_eq!(integer_words(1_000_000, true), "un millón");
        assert_eq!(integer_words(2_000_000, true), "dos millones");
        assert_eq!(integer_words(31, false), "treinta y uno");
    }

    #[test]
    fn dates_match_each_style() {
        let date = "2026-11-07";
        let numeric = field("fecha_firma", FieldKind::Date, Some(DateStyle::Numeric));
        assert_eq!(format_template_value(&numeric, date), "07/11/2026");
        let long = field("fecha_firma", FieldKind::Date, Some(DateStyle::Long));
        assert_eq!(format_template_value(&long, date), "7 de noviembre de 2026");
        let notarial = field("fecha_firma", FieldKind::Date, Some(DateStyle::Notarial));
        assert_eq!(
            format_template_value(&notarial, date),
            "SIETE (07) DE NOVIEMBRE DEL AÑO DOS MIL VEINTISEIS (2026)"
        );
        let act = field("fecha_firma", FieldKind::Date, Some(DateStyle::NotarialAct));
        assert_eq!(
            format_template_value(&act, "2026-10-13"),
            "TRECE (13) días del mes de OCTUBRE del año 2026"
        );
        let words = field("fecha_firma", FieldKind::Date, Some(DateStyle::Words));
        assert_eq!(
            format_template_value(&words, "2026-11-16"),
            "dieciséis de noviembre del año dos mil veintiséis"
        );
    }

    #[test]
    fn invalid_calendar_dates_fall_back_to_the_raw_value() {
        let numeric = field("fecha_firma", FieldKind::Date, Some(DateStyle::Numeric));
        assert_eq!(format_template_value(&numeric, "2026-02-30"), "2026-02-30");
        assert_eq!(format_template_value(&numeric, "0000-01-01"), "0000-01-01");
    }

    #[test]
    fn final_capital_date_is_numeric_unless_notarial() {
        let plain = field("fecha_cuota_final_capital", FieldKind::Date, None);
        assert_eq!(
            format_word_value(&plain, "2027-01-05", false).unwrap(),
            "05/01/2027"
        );
        let notarial = field(
            "fecha_cuota_final_capital",
            FieldKind::Date,
            Some(DateStyle::Notarial),
        );
        assert!(
            format_word_value(&notarial, "2027-01-05", false)
                .unwrap()
                .starts_with("CINCO (05)")
        );
    }

    #[test]
    fn identity_gets_dashes_and_text_keeps_its_clause_case() {
        let identity = field("cliente_cedula", FieldKind::Identity, None);
        assert_eq!(
            format_template_value(&identity, "40212345678"),
            "402-1234567-8"
        );
        let nationality = field("cliente_nacionalidad", FieldKind::Text, None);
        assert_eq!(
            format_word_value(&nationality, "DOMINICANO", false).unwrap(),
            "dominicano"
        );
        let address = field("cliente_direccion", FieldKind::Text, None);
        assert_eq!(
            format_word_value(&address, "calle 1", false).unwrap(),
            "CALLE 1"
        );
    }

    #[test]
    fn line_breaks_collapse_except_payment_columns() {
        let text = field("cliente_nombre", FieldKind::Text, None);
        assert_eq!(
            format_word_value(&text, "Ana\nPérez", false).unwrap(),
            "Ana Pérez"
        );
        let column = field("cuotas_intereses_montos", FieldKind::Text, None);
        assert_eq!(format_word_value(&column, "1\n2", false).unwrap(), "1\n2");
    }

    #[test]
    fn control_characters_are_rejected_with_the_field_label() {
        let text = field("cliente_nombre", FieldKind::Text, None);
        let error = format_word_value(&text, "Ana\u{1}", false).unwrap_err();
        assert!(error.contains("cliente_nombre"));
    }

    #[test]
    fn strip_marks_removes_spanish_accents() {
        assert_eq!(strip_marks("dieciséis"), "dieciseis");
        assert_eq!(strip_marks("AÑO"), "ANO");
    }
}
