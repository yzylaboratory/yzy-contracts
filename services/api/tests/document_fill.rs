//! Behaviour of the native Word fill, with synthetic documents built in memory.

use std::{
    collections::HashMap,
    io::{Cursor, Read, Write},
};

use yzy_contracts_api::{
    error::ApiError,
    modules::{
        document_fill::{
            NativeFill, fill_native_docx,
            format::{DateStyle, FieldKind, FieldSpec},
            production_table,
        },
        templates::NativeVariable,
    },
};
use zip::{CompressionMethod, write::SimpleFileOptions};

const W: &str = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

fn docx(body: &str) -> Vec<u8> {
    let document = format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="{W}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>{body}</w:body></w:document>"#
    );
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
    let mut writer = zip::ZipWriter::new(Cursor::new(Vec::new()));
    writer.start_file("[Content_Types].xml", options).unwrap();
    writer
        .write_all(b"<?xml version=\"1.0\"?><Types/>")
        .unwrap();
    writer.start_file("word/document.xml", options).unwrap();
    writer.write_all(document.as_bytes()).unwrap();
    writer.finish().unwrap().into_inner()
}

fn document_xml(bytes: &[u8]) -> String {
    let mut archive = zip::ZipArchive::new(Cursor::new(bytes)).unwrap();
    let mut xml = String::new();
    archive
        .by_name("word/document.xml")
        .unwrap()
        .read_to_string(&mut xml)
        .unwrap();
    xml
}

fn text_field(key: &str) -> FieldSpec {
    FieldSpec {
        key: key.to_owned(),
        label: key.to_owned(),
        kind: FieldKind::Text,
        required: false,
        date_style: None,
    }
}

fn variable(key: &str, occurrences: u32) -> NativeVariable {
    NativeVariable {
        key: key.to_owned(),
        occurrences,
    }
}

fn fill(
    body: &str,
    fields: &[FieldSpec],
    variables: &[NativeVariable],
    values: &[(&str, &str)],
) -> Result<String, ApiError> {
    let values: HashMap<String, String> = values
        .iter()
        .map(|(k, v)| ((*k).to_owned(), (*v).to_owned()))
        .collect();
    let request = NativeFill {
        variables,
        fields,
        values: &values,
        allow_incomplete: false,
        uppercase: false,
        bold_pagare_date: false,
        conditional_sale: None,
        company: None,
        vehicle: None,
        reviewed_bodies: production_table(),
    };
    fill_native_docx(&docx(body), &request).map(|bytes| document_xml(&bytes))
}

fn run(text: &str) -> String {
    format!(r#"<w:r><w:t xml:space="preserve">{text}</w:t></w:r>"#)
}

fn paragraph(runs: &str) -> String {
    format!("<w:p>{runs}</w:p>")
}

#[test]
fn a_marker_split_between_runs_is_filled_as_one_value() {
    let body = paragraph(&format!(
        "{}{}",
        run("Cliente: {{cli"),
        run("ente_nombre}}.")
    ));
    let xml = fill(
        &body,
        &[text_field("cliente_nombre")],
        &[variable("cliente_nombre", 1)],
        &[("cliente_nombre", "Ana Pérez")],
    )
    .unwrap();
    assert!(xml.contains("Cliente: Ana Pérez"), "{xml}");
    assert!(xml.contains(">.</w:t>"), "{xml}");
    assert!(!xml.contains("{{"), "{xml}");
}

#[test]
fn several_occurrences_of_one_key_are_all_replaced() {
    let body = paragraph(&run("{{cliente_nombre}} y {{cliente_nombre}}"));
    let xml = fill(
        &body,
        &[text_field("cliente_nombre")],
        &[variable("cliente_nombre", 2)],
        &[("cliente_nombre", "Ana")],
    )
    .unwrap();
    assert!(xml.contains("Ana y Ana"), "{xml}");
}

#[test]
fn rd_prefix_is_not_duplicated() {
    let money = FieldSpec {
        key: "monto_desembolso".to_owned(),
        label: "Monto".to_owned(),
        kind: FieldKind::Money,
        required: false,
        date_style: None,
    };
    let body = paragraph(&run("RD${{monto_desembolso}}"));
    let xml = fill(
        &body,
        &[money],
        &[variable("monto_desembolso", 1)],
        &[("monto_desembolso", "RD$25,000.00")],
    )
    .unwrap();
    assert!(xml.contains("RD$25,000.00"), "{xml}");
    assert!(!xml.contains("RD$RD$"), "{xml}");
}

#[test]
fn contract_address_is_uppercased_and_bolded_in_a_new_run() {
    let address = FieldSpec {
        key: "cliente_direccion".to_owned(),
        label: "Dirección".to_owned(),
        kind: FieldKind::Text,
        required: false,
        date_style: None,
    };
    let body = paragraph(&run("Domicilio: {{cliente_direccion}}."));
    let xml = fill(
        &body,
        &[address],
        &[variable("cliente_direccion", 1)],
        &[("cliente_direccion", "calle 1")],
    )
    .unwrap();
    assert!(xml.contains("<w:b/>"), "{xml}");
    assert!(xml.contains("CALLE 1"), "{xml}");
}

#[test]
fn payment_columns_keep_line_breaks_as_w_br() {
    let column = FieldSpec {
        key: "cuotas_intereses_montos".to_owned(),
        label: "Montos".to_owned(),
        kind: FieldKind::Text,
        required: false,
        date_style: None,
    };
    let body = paragraph(&run("{{cuotas_intereses_montos}}"));
    let xml = fill(
        &body,
        &[column],
        &[variable("cuotas_intereses_montos", 1)],
        &[("cuotas_intereses_montos", "100\n200")],
    )
    .unwrap();
    assert!(xml.contains("<w:t>100</w:t><w:br/><w:t>200</w:t>"), "{xml}");
}

#[test]
fn other_values_collapse_line_breaks_to_spaces() {
    let body = paragraph(&run("{{cliente_nombre}}"));
    let xml = fill(
        &body,
        &[text_field("cliente_nombre")],
        &[variable("cliente_nombre", 1)],
        &[("cliente_nombre", "Ana\nPérez")],
    )
    .unwrap();
    assert!(xml.contains("Ana Pérez"), "{xml}");
    assert!(!xml.contains("<w:br/>"), "{xml}");
}

#[test]
fn dates_in_words_use_the_selected_style() {
    let date = FieldSpec {
        key: "fecha_firma".to_owned(),
        label: "Fecha".to_owned(),
        kind: FieldKind::Date,
        required: true,
        date_style: Some(DateStyle::Words),
    };
    let body = paragraph(&run("A los {{fecha_firma}}."));
    let xml = fill(
        &body,
        &[date],
        &[variable("fecha_firma", 1)],
        &[("fecha_firma", "2026-11-16")],
    )
    .unwrap();
    assert!(
        xml.contains("dieciséis de noviembre del año dos mil veintiséis"),
        "{xml}"
    );
}

#[test]
fn text_inside_protected_containers_is_left_alone() {
    let body = paragraph(&run("Antes {{cliente_nombre}}"))
        + r#"<w:ins w:id="1" w:author="x" w:date="2026-01-01T00:00:00Z"><w:r><w:t>Sin tocar</w:t></w:r></w:ins>"#;
    let xml = fill(
        &body,
        &[text_field("cliente_nombre")],
        &[variable("cliente_nombre", 1)],
        &[("cliente_nombre", "Ana")],
    )
    .unwrap();
    assert!(xml.contains("Sin tocar"), "{xml}");
}

#[test]
fn a_key_inside_a_protected_container_is_rejected() {
    let body = r#"<w:p><w:ins w:id="1" w:author="x" w:date="2026-01-01T00:00:00Z"><w:r><w:t>{{cliente_nombre}}</w:t></w:r></w:ins></w:p>"#;
    let error = fill(
        body,
        &[text_field("cliente_nombre")],
        &[variable("cliente_nombre", 1)],
        &[("cliente_nombre", "Ana")],
    )
    .unwrap_err();
    assert!(matches!(error, ApiError::InvalidDocxVariables), "{error:?}");
}

#[test]
fn a_required_empty_value_is_a_validation_error() {
    let mut field = text_field("cliente_nombre");
    field.required = true;
    let body = paragraph(&run("{{cliente_nombre}}"));
    let error = fill(&body, &[field], &[variable("cliente_nombre", 1)], &[]).unwrap_err();
    assert!(matches!(error, ApiError::Validation(_)), "{error:?}");
}

#[test]
fn a_bare_brace_pair_is_rejected() {
    let body = paragraph(&run("Texto {{ suelto"));
    let error = fill(
        &body,
        &[text_field("cliente_nombre")],
        &[variable("cliente_nombre", 1)],
        &[],
    )
    .unwrap_err();
    assert!(matches!(error, ApiError::InvalidDocxVariables), "{error:?}");
}

#[test]
fn an_occurrence_count_that_does_not_match_the_template_is_rejected() {
    let body = paragraph(&run("{{cliente_nombre}}"));
    let error = fill(
        &body,
        &[text_field("cliente_nombre")],
        &[variable("cliente_nombre", 2)],
        &[("cliente_nombre", "Ana")],
    )
    .unwrap_err();
    assert!(matches!(error, ApiError::InvalidDocxVariables), "{error:?}");
}

#[test]
fn a_doctype_is_rejected_before_parsing() {
    let mut archive = zip::ZipWriter::new(Cursor::new(Vec::new()));
    let options = SimpleFileOptions::default();
    archive.start_file("[Content_Types].xml", options).unwrap();
    archive.write_all(b"<Types/>").unwrap();
    archive.start_file("word/document.xml", options).unwrap();
    archive
        .write_all(format!(r#"<!DOCTYPE w:document [<!ENTITY x "y">]><w:document xmlns:w="{W}"><w:body/></w:document>"#).as_bytes())
        .unwrap();
    let bytes = archive.finish().unwrap().into_inner();
    let values = HashMap::new();
    let request = NativeFill {
        variables: &[variable("cliente_nombre", 1)],
        fields: &[text_field("cliente_nombre")],
        values: &values,
        allow_incomplete: false,
        uppercase: false,
        bold_pagare_date: false,
        conditional_sale: None,
        company: None,
        vehicle: None,
        reviewed_bodies: production_table(),
    };
    assert!(matches!(
        fill_native_docx(&bytes, &request),
        Err(ApiError::InvalidDocxTemplate)
    ));
}
