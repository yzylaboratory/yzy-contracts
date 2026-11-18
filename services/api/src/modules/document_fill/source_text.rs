//! Extracts editable source paragraphs for the insurer and sale-clause lookups.
use std::{collections::HashMap, sync::LazyLock};

use regex::Regex;

use crate::error::ApiError;

use super::{
    CompanyProfile, DOCUMENT_PART, PACKAGE_MAX_BYTES, ReviewedModel, engine,
    format::{DateStyle, FieldKind, FieldSpec, format_word_value},
    map_engine_error, parse_part, production_table, reference, reviewed, sha256_hex, unpack,
};

pub(crate) fn read_source_paragraphs(
    original: &[u8],
    company: Option<&CompanyProfile>,
) -> Result<(Option<ReviewedModel>, Vec<String>), ApiError> {
    if original.len() > PACKAGE_MAX_BYTES {
        return Err(ApiError::PayloadTooLarge);
    }
    let entries = unpack(original)?;
    let part = &entries
        .iter()
        .find(|part| part.name == DOCUMENT_PART)
        .ok_or(ApiError::InvalidDocxTemplate)?
        .bytes;
    let dom = parse_part(part)?;
    let model = reviewed::identify(production_table(), &sha256_hex(part));
    let mut segments = engine::collect_segments(&dom, 0, false).map_err(map_engine_error)?;
    if let Some(company) = company {
        let model = model.ok_or_else(|| {
            ApiError::Validation("El modelo compartido no coincide con la versión revisada.".into())
        })?;
        let namespace = dom.namespace(dom.root()).unwrap_or_default();
        let mut edits = HashMap::new();
        reference::add_company_edits(
            reference::DocumentPart {
                dom: &dom,
                namespace: &namespace,
                index: 0,
            },
            model,
            company,
            true,
            &segments,
            &mut edits,
        )
        .map_err(map_engine_error)?;
        for (index, mut edits) in edits {
            edits.sort_by_key(|edit| std::cmp::Reverse(edit.start));
            for edit in edits {
                segments[index]
                    .text
                    .replace_range(edit.start..edit.end, &edit.value);
            }
        }
    }
    Ok((
        model,
        segments.into_iter().map(|segment| segment.text).collect(),
    ))
}

pub(crate) fn sales_commitment(
    original: &[u8],
    values: &HashMap<String, String>,
    company: Option<&CompanyProfile>,
) -> Result<String, ApiError> {
    static START: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r"(?i)\bse\s+compromete\b").unwrap());
    static END: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)\bpactadas\b").unwrap());
    let (model, paragraphs) = read_source_paragraphs(original, company)?;
    let mut clauses = paragraphs.iter().filter_map(|paragraph| {
        let start = START.find(paragraph)?;
        let end = END.find_iter(paragraph).last()?;
        (end.start() > start.start()).then(|| &paragraph[start.start()..end.end()])
    });
    let clause = clauses.next().ok_or_else(|| {
        ApiError::Validation(
            "No se encontró la cláusula entre «se compromete» y «pactadas» en el Word de la venta."
                .into(),
        )
    })?;
    if clauses.next().is_some() {
        return Err(ApiError::Validation(
            "El Word de la venta contiene más de una cláusula de compromiso. Confirma el Word de la operación.".into()
        ));
    }
    let mut filled = String::new();
    let mut offset = 0;
    for token in engine::tokens(clause) {
        filled.push_str(&clause[offset..token.start]);
        let key = token.key.ok_or(ApiError::InvalidDocxVariables)?;
        let value = values.get(&key).filter(|value| !value.trim().is_empty()).ok_or_else(|| {
            ApiError::Validation(format!("Completa el marcador «{key}» en el expediente para usar la cláusula de la venta."))
        })?;
        let is_date = key.starts_with("fecha_");
        let spec = FieldSpec {
            label: key.clone(),
            key,
            kind: if is_date {
                FieldKind::Date
            } else {
                FieldKind::Text
            },
            required: true,
            date_style: is_date.then_some(DateStyle::Long),
        };
        let formatted = format_word_value(&spec, value, false).map_err(ApiError::Validation)?;
        if model == Some(ReviewedModel::VentaCondicional) {
            filled.push_str(&reference::reference_word_value(
                ReviewedModel::VentaCondicional,
                &spec.key,
                0,
                value,
                &formatted,
            ));
        } else {
            filled.push_str(&formatted);
        }
        offset = token.end;
    }
    filled.push_str(&clause[offset..]);
    Ok(filled)
}
