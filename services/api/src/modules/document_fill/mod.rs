//! Fills a Word template with values, in Rust. Behaviour follows the portal's
//! `fillOriginalWord` for the native-variable path (`native-document.ts`).
//!
//! Scope of this module:
//! - Markers: `{{clave}}` split across runs, bold and dated runs, line breaks, `xml:space`,
//!   protected containers, `RD$` de-duplication, vehicle identifier lines, es-DO date and number
//!   words, the package limits.
//! - Reviewed bodies (`reviewed.rs`): reference values, company paragraph ranges, layouts,
//!   sale payment rows and table layout, package repairs.
//! - The expediente flows resolve template values in `clients::documents`. Their
//!   template selector only admits original Word templates with native variables.

mod dom;
mod engine;
pub mod format;
mod layouts;
mod package;
pub(crate) mod reference;
mod reviewed;
mod sale_table;
mod source_text;
mod tables;

use std::{
    collections::{BTreeSet, HashMap, HashSet},
    io::{Cursor, Read, Write},
};

use sha2::{Digest, Sha256};
use zip::{CompressionMethod, DateTime, ZipArchive, ZipWriter, write::SimpleFileOptions};

use crate::{error::ApiError, modules::templates::NativeVariable};

use self::{
    dom::Dom,
    engine::{EngineError, NativeRequest, Segment},
    format::FieldSpec,
};

pub use self::reference::{CompanyProfile, Vehicle};
pub use self::reviewed::{ReviewedModel, production_table};
pub(crate) use self::source_text::{read_source_paragraphs, sales_commitment};

/// Same bound as `fileLimit` in `native-document.ts` (20 MiB) for input and output.
pub const PACKAGE_MAX_BYTES: usize = 20 * 1024 * 1024;
const MAX_ENTRIES: usize = 4096;
const MAX_EXPANDED_BYTES: u64 = 64 * 1024 * 1024;
const MAX_XML_BYTES: u64 = 8 * 1024 * 1024;
const EXTENDED_PROPERTIES: &str = "docProps/app.xml";
const DOCUMENT_PART: &str = "word/document.xml";
const SALE_PAYMENT_COLUMNS: [&str; 3] = [
    "cuotas_intereses_numeros",
    "cuotas_intereses_fechas",
    "cuotas_intereses_montos",
];
const INSURANCE_PAYMENT_COLUMNS: [&str; 3] = [
    "cuotas_seguro_numeros",
    "cuotas_seguro_fechas",
    "cuotas_seguro_montos",
];

/// Output of a conditional sale (`conditionalSale` in `native-document.ts`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SaleFormat {
    Docx,
    Pdf,
}

pub struct NativeFill<'a> {
    pub variables: &'a [NativeVariable],
    pub fields: &'a [FieldSpec],
    pub values: &'a HashMap<String, String>,
    pub allow_incomplete: bool,
    pub uppercase: bool,
    pub bold_pagare_date: bool,
    pub conditional_sale: Option<SaleFormat>,
    pub company: Option<&'a CompanyProfile>,
    pub vehicle: Option<&'a Vehicle>,
    /// Fingerprints of the reviewed bodies. Production passes [`production_table`].
    pub reviewed_bodies: &'a [(&'a str, ReviewedModel)],
}

/// One zip entry of the package, in archive order.
pub(crate) struct Entry {
    pub(crate) name: String,
    pub(crate) bytes: Vec<u8>,
}

/// Fills the `{{clave}}` markers of `original` and returns the new `.docx` bytes.
pub fn fill_native_docx(original: &[u8], request: &NativeFill<'_>) -> Result<Vec<u8>, ApiError> {
    if original.len() > PACKAGE_MAX_BYTES {
        return Err(ApiError::PayloadTooLarge);
    }
    let mut entries = unpack(original)?;
    let mut parts: Vec<(usize, Dom)> = Vec::new();
    for (index, entry) in entries.iter().enumerate() {
        if is_word_part(&entry.name) {
            parts.push((index, parse_part(&entry.bytes)?));
        }
    }
    let document_entry = entries
        .iter()
        .position(|entry| entry.name == DOCUMENT_PART)
        .ok_or(ApiError::InvalidDocxTemplate)?;
    let document_part = parts
        .iter()
        .position(|(entry, _)| *entry == document_entry)
        .ok_or(ApiError::InvalidDocxTemplate)?;
    let namespace = parts[document_part]
        .1
        .namespace(parts[document_part].1.root())
        .unwrap_or_default();

    let identified = reviewed::identify(
        request.reviewed_bodies,
        &sha256_hex(&entries[document_entry].bytes),
    );
    // The portal does not treat the insurance sale body as a reference body; it only takes its bold fields.
    let reference = identified.filter(|model| *model != ReviewedModel::VentaCondicionalSeguro);
    if request.company.is_some() && reference.is_none() {
        return Err(ApiError::Validation(
            "El modelo compartido no coincide con la versión revisada.".to_owned(),
        ));
    }

    let mut segments: Vec<Segment> = Vec::new();
    for (part_position, (_, dom)) in parts.iter().enumerate() {
        segments.extend(engine::segments(dom, part_position).map_err(map_engine_error)?);
    }

    let variables: Vec<(String, u32)> = request
        .variables
        .iter()
        .map(|variable| (variable.key.clone(), variable.occurrences))
        .collect();
    let reference_values = reference::reviewed_reference_values(
        reference,
        request.values,
        request.vehicle,
        request.company,
    );
    let native = NativeRequest {
        variables: &variables,
        fields: request.fields,
        values: &reference_values,
        allow_incomplete: request.allow_incomplete,
        uppercase: request.uppercase && reference.is_none(),
        bold_pagare_date: request.bold_pagare_date && reference.is_none(),
        reference,
        layout_bold: identified.map(ReviewedModel::bold_fields).unwrap_or(&[]),
    };
    let mut edits = engine::resolve_native(&segments, &native).map_err(map_engine_error)?;

    if let (Some(company), Some(model)) = (request.company, reference) {
        let document = reference::DocumentPart {
            dom: &parts[document_part].1,
            namespace: &namespace,
            index: document_part,
        };
        reference::add_company_edits(
            document,
            model,
            company,
            request.allow_incomplete,
            &segments,
            &mut edits,
        )
        .map_err(map_engine_error)?;
    }
    for list in edits.values_mut() {
        list.sort_by_key(|edit| std::cmp::Reverse(edit.start));
    }

    let mut changed: BTreeSet<usize> = BTreeSet::new();
    let expand_payments = request.conditional_sale.is_some()
        || matches!(
            reference,
            Some(ReviewedModel::VentaCondicional | ReviewedModel::ActoSeguro)
        );
    let payment_part = if expand_payments {
        let columns: &[&str] = if reference == Some(ReviewedModel::ActoSeguro) {
            &INSURANCE_PAYMENT_COLUMNS
        } else {
            &SALE_PAYMENT_COLUMNS
        };
        let for_pdf = request.conditional_sale == Some(SaleFormat::Pdf);
        sale_table::expand_sale_payment_rows(
            &mut parts, &namespace, &segments, &mut edits, for_pdf, columns,
        )
        .map_err(map_engine_error)?
    } else {
        None
    };
    if let Some(part) = payment_part {
        changed.insert(part);
    }
    if request.conditional_sale == Some(SaleFormat::Pdf) && payment_part.is_none() {
        let first_due = "{{fecha_de_vencimiento_de_la_cuota_1}}";
        if let Some(segment) = segments
            .iter()
            .find(|segment| segment.text.contains(first_due))
        {
            let dom = &mut parts[segment.part].1;
            if let Some(table) = sale_table::table_of_first_due_date(dom, segment) {
                sale_table::fix_sale_table_layout(dom, &namespace, table);
                changed.insert(segment.part);
            }
        }
    }

    let mut targets: Vec<usize> = edits.keys().copied().collect();
    targets.sort_unstable();
    for index in targets {
        let segment = &segments[index];
        let dom = &mut parts[segment.part].1;
        engine::replace_in_segment(dom, segment, &edits[&index], &namespace);
        changed.insert(segment.part);
    }

    if let Some(format) = identified.and_then(layout_format) {
        format(&mut parts[document_part].1, &namespace);
        changed.insert(document_part);
    }

    for part in changed {
        let (entry, dom) = &parts[part];
        entries[*entry].bytes = dom.serialize().into_bytes();
    }
    package::remove_empty_extended_properties(&mut entries)?;
    package::repair_word_package(&mut entries);
    pack(&entries)
}

/// `reviewedWordLayout[model].format`: the DOM edits after the markers are filled.
fn layout_format(model: ReviewedModel) -> Option<fn(&mut Dom, &str)> {
    match model {
        ReviewedModel::PagareAutentico => Some(layouts::format_pagare_autentico),
        ReviewedModel::EntregaVoluntaria => Some(layouts::format_entrega_voluntaria),
        ReviewedModel::EntregaVehiculo => Some(layouts::format_entrega_vehiculo),
        ReviewedModel::ActoSeguro => Some(layouts::format_acto_seguro),
        ReviewedModel::Gps => Some(layouts::format_gps),
        ReviewedModel::AutorizacionData => Some(|_, _| layouts::format_autorizacion_data()),
        ReviewedModel::VentaCondicional => Some(layouts::format_venta_condicional),
        ReviewedModel::DeclaracionJurada => Some(layouts::format_declaracion_jurada),
        _ => None,
    }
}

fn sha256_hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn is_word_part(name: &str) -> bool {
    let Some(stem) = name
        .strip_prefix("word/")
        .and_then(|part| part.strip_suffix(".xml"))
    else {
        return false;
    };
    matches!(stem, "document" | "footnotes" | "endnotes")
        || stem
            .strip_prefix("header")
            .or_else(|| stem.strip_prefix("footer"))
            .is_some_and(|number| {
                !number.is_empty() && number.bytes().all(|byte| byte.is_ascii_digit())
            })
}

fn unsafe_name(name: &str) -> bool {
    name.starts_with('/')
        || name.contains(['\\', '\0'])
        || name
            .split('/')
            .any(|part| matches!(part, ".." | "__proto__" | "constructor" | "prototype"))
}

fn unpack(original: &[u8]) -> Result<Vec<Entry>, ApiError> {
    let mut archive = ZipArchive::new(Cursor::new(original)).map_err(invalid)?;
    if archive.len() > MAX_ENTRIES {
        return Err(ApiError::InvalidDocxTemplate);
    }
    let mut names = HashSet::new();
    let mut expanded: u64 = 0;
    let mut entries = Vec::with_capacity(archive.len());
    for index in 0..archive.len() {
        let mut file = archive.by_index(index).map_err(invalid)?;
        let name = file.name().map_err(invalid)?.into_owned();
        let size = file.size();
        expanded = expanded.saturating_add(size);
        let limited_xml = is_word_part(&name) || name == EXTENDED_PROPERTIES;
        let read_limit = if limited_xml {
            MAX_XML_BYTES
        } else {
            MAX_EXPANDED_BYTES
        };
        if expanded > MAX_EXPANDED_BYTES
            || unsafe_name(&name)
            || name.to_ascii_lowercase().starts_with("_xmlsignatures/")
            || (limited_xml && size > MAX_XML_BYTES)
            || !names.insert(name.clone())
        {
            return Err(ApiError::InvalidDocxTemplate);
        }
        let mut bytes = Vec::new();
        file.by_ref()
            .take(read_limit + 1)
            .read_to_end(&mut bytes)
            .map_err(invalid)?;
        if bytes.len() as u64 > read_limit || bytes.len() as u64 != size {
            return Err(ApiError::InvalidDocxTemplate);
        }
        entries.push(Entry { name, bytes });
    }
    if !names.contains("[Content_Types].xml") || !names.contains(DOCUMENT_PART) {
        return Err(ApiError::InvalidDocxTemplate);
    }
    Ok(entries)
}

fn invalid<E>(_: E) -> ApiError {
    ApiError::InvalidDocxTemplate
}

fn parse_part(bytes: &[u8]) -> Result<Dom, ApiError> {
    let xml = std::str::from_utf8(bytes).map_err(|_| ApiError::InvalidDocxTemplate)?;
    if xml.to_ascii_uppercase().contains("<!DOCTYPE")
        || xml.to_ascii_uppercase().contains("<!ENTITY")
    {
        return Err(ApiError::InvalidDocxTemplate);
    }
    Dom::parse(xml).map_err(|_| ApiError::InvalidDocxTemplate)
}

fn map_engine_error(error: EngineError) -> ApiError {
    match error {
        EngineError::Variables => ApiError::InvalidDocxVariables,
        EngineError::Structure => ApiError::InvalidDocxTemplate,
        EngineError::Value(message) => ApiError::Validation(message),
    }
}

fn pack(entries: &[Entry]) -> Result<Vec<u8>, ApiError> {
    let options = SimpleFileOptions::default()
        .compression_method(CompressionMethod::Deflated)
        .last_modified_time(DateTime::default());
    let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
    for entry in entries {
        writer
            .start_file(entry.name.as_str(), options)
            .map_err(|_| ApiError::DocumentRenderFailed)?;
        writer
            .write_all(&entry.bytes)
            .map_err(|_| ApiError::DocumentRenderFailed)?;
    }
    let bytes = writer
        .finish()
        .map_err(|_| ApiError::DocumentRenderFailed)?
        .into_inner();
    if bytes.len() > PACKAGE_MAX_BYTES {
        return Err(ApiError::PayloadTooLarge);
    }
    Ok(bytes)
}
