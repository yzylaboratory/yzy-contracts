//! Parity between the Rust Word fill and the portal's `fillOriginalWord`.
//!
//! `fixtures/parity/oracle/generate.mjs` runs the portal implementation on the synthetic cases
//! listed in `fixtures/parity/cases.json` and stores the XML it writes under
//! `fixtures/parity/expected/`. This test fills the same inputs in Rust and compares the two XML
//! trees after normalization: element names and namespaces, attributes without namespace
//! declarations, and text.
//!
//! Reviewed bodies use the fingerprints of `fixtures/parity/reviewed_bodies.json`, which the
//! oracle's shim also reads: the portal's own table only knows the real templates.

use std::{collections::HashMap, fs, path::PathBuf};

use roxmltree::{Node, NodeType};
use serde::Deserialize;
use yzy_contracts_api::{
    error::ApiError,
    modules::{
        document_fill::{
            CompanyProfile, NativeFill, ReviewedModel, SaleFormat, Vehicle, fill_native_docx,
            format::{DateStyle, FieldKind, FieldSpec},
        },
        templates::NativeVariable,
    },
};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Case {
    name: String,
    docx: String,
    variables: Vec<CaseVariable>,
    fields: Vec<CaseField>,
    values: HashMap<String, String>,
    #[serde(default)]
    allow_incomplete: bool,
    #[serde(default)]
    uppercase: bool,
    #[serde(default)]
    bold_pagare_date: bool,
    #[serde(default)]
    expect_error: bool,
    conditional_sale: Option<String>,
    company: Option<CaseCompany>,
    vehicle: Option<CaseVehicle>,
}

#[derive(Deserialize)]
struct CaseVariable {
    key: String,
    occurrences: u32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CaseField {
    key: String,
    label: String,
    kind: String,
    required: bool,
    date_style: Option<String>,
}

#[derive(Deserialize)]
struct CaseCompany {
    name: String,
    values: HashMap<String, String>,
}

#[derive(Deserialize)]
struct CaseVehicle {
    vehicle_type: Option<String>,
    make: Option<String>,
    model: Option<String>,
    year: Option<String>,
    color: Option<String>,
    registration_number: Option<String>,
    chassis_number: Option<String>,
    plate: Option<String>,
    engine_number: Option<String>,
}

fn parity_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/parity")
}

fn kind(value: &str) -> FieldKind {
    match value {
        "text" => FieldKind::Text,
        "date" => FieldKind::Date,
        "identity" => FieldKind::Identity,
        "amount" => FieldKind::Amount,
        "duration" => FieldKind::Duration,
        "email" => FieldKind::Email,
        "money" => FieldKind::Money,
        "integer" => FieldKind::Integer,
        "phone" => FieldKind::Phone,
        other => panic!("unknown field kind {other}"),
    }
}

fn date_style(value: &str) -> DateStyle {
    match value {
        "numeric" => DateStyle::Numeric,
        "long" => DateStyle::Long,
        "notarial" => DateStyle::Notarial,
        "notarialAct" => DateStyle::NotarialAct,
        "words" => DateStyle::Words,
        other => panic!("unknown date style {other}"),
    }
}

/// Canonical text of an XML tree: names with namespace URIs, sorted attributes, merged text.
fn canonical(xml: &str) -> String {
    let document = roxmltree::Document::parse(xml).expect("well-formed XML");
    let mut out = String::new();
    write_canonical(document.root(), &mut out);
    out
}

fn write_canonical(node: Node<'_, '_>, out: &mut String) {
    match node.node_type() {
        NodeType::Root => {
            for child in node.children() {
                write_canonical(child, out);
            }
        }
        NodeType::Element => {
            let name = node.tag_name();
            out.push('<');
            out.push_str(&format!(
                "{{{}}}{}",
                name.namespace().unwrap_or(""),
                name.name()
            ));
            let mut attributes: Vec<String> = node
                .attributes()
                .map(|attribute| {
                    format!(
                        "{{{}}}{}={}",
                        attribute.namespace().unwrap_or(""),
                        attribute.name(),
                        attribute.value()
                    )
                })
                .collect();
            attributes.sort();
            for attribute in attributes {
                out.push(' ');
                out.push_str(&attribute);
            }
            out.push('>');
            let mut pending_text = String::new();
            for child in node.children() {
                if child.is_text() {
                    pending_text.push_str(child.text().unwrap_or(""));
                    continue;
                }
                if !pending_text.is_empty() {
                    out.push_str(&format!("#{pending_text:?}"));
                    pending_text.clear();
                }
                write_canonical(child, out);
            }
            if !pending_text.is_empty() {
                out.push_str(&format!("#{pending_text:?}"));
            }
            out.push_str("</>");
        }
        _ => {}
    }
}

fn load_cases() -> Vec<Case> {
    let raw = fs::read_to_string(parity_root().join("cases.json")).expect("cases.json exists");
    serde_json::from_str(&raw).expect("cases.json is valid")
}

/// Fingerprints of the synthetic reviewed bodies, with the model each one stands for.
fn load_reviewed() -> Vec<(String, ReviewedModel)> {
    let raw = fs::read_to_string(parity_root().join("reviewed_bodies.json"))
        .expect("reviewed_bodies.json exists");
    let map: HashMap<String, String> =
        serde_json::from_str(&raw).expect("reviewed_bodies.json is valid");
    map.into_iter()
        .map(|(digest, key)| {
            let model =
                ReviewedModel::from_key(&key).unwrap_or_else(|| panic!("unknown model {key}"));
            (digest, model)
        })
        .collect()
}

fn vehicle(case: &CaseVehicle) -> Vehicle {
    Vehicle {
        vehicle_type: case.vehicle_type.clone(),
        make: case.make.clone(),
        model: case.model.clone(),
        year: case.year.clone(),
        color: case.color.clone(),
        registration_number: case.registration_number.clone(),
        chassis_number: case.chassis_number.clone(),
        plate: case.plate.clone(),
        engine_number: case.engine_number.clone(),
    }
}

#[test]
fn every_synthetic_case_matches_the_portal_output() {
    let root = parity_root();
    let cases = load_cases();
    assert!(cases.len() >= 33, "the parity suite must cover every case");
    let reviewed = load_reviewed();
    let reviewed_table: Vec<(&str, ReviewedModel)> = reviewed
        .iter()
        .map(|(digest, model)| (digest.as_str(), *model))
        .collect();
    let mut failures = Vec::new();
    let mut checked_parts = 0;

    for case in &cases {
        let original = fs::read(root.join(&case.docx)).expect("synthetic docx exists");
        let fields: Vec<FieldSpec> = case
            .fields
            .iter()
            .map(|field| FieldSpec {
                key: field.key.clone(),
                label: field.label.clone(),
                kind: kind(&field.kind),
                required: field.required,
                date_style: field.date_style.as_deref().map(date_style),
            })
            .collect();
        let variables: Vec<NativeVariable> = case
            .variables
            .iter()
            .map(|variable| NativeVariable {
                key: variable.key.clone(),
                occurrences: variable.occurrences,
            })
            .collect();
        let company = case.company.as_ref().map(|company| CompanyProfile {
            name: company.name.clone(),
            values: company.values.clone().into_iter().collect(),
        });
        let vehicle = case.vehicle.as_ref().map(vehicle);
        let conditional_sale = match case.conditional_sale.as_deref() {
            None => None,
            Some("docx") => Some(SaleFormat::Docx),
            Some("pdf") => Some(SaleFormat::Pdf),
            Some(other) => panic!("unknown conditional sale {other}"),
        };
        let request = NativeFill {
            variables: &variables,
            fields: &fields,
            values: &case.values,
            allow_incomplete: case.allow_incomplete,
            uppercase: case.uppercase,
            bold_pagare_date: case.bold_pagare_date,
            conditional_sale,
            company: company.as_ref(),
            vehicle: vehicle.as_ref(),
            reviewed_bodies: &reviewed_table,
        };
        let result = fill_native_docx(&original, &request);

        if case.expect_error {
            let rejected = matches!(result, Err(ApiError::InvalidDocxVariables));
            eprintln!(
                "parity {} {} (rejected as expected)",
                if rejected { "PASS" } else { "FAIL" },
                case.name
            );
            if !rejected {
                failures.push(format!(
                    "{}: expected rejection, got {:?}",
                    case.name,
                    result.as_ref().err()
                ));
            }
            continue;
        }
        let filled = match result {
            Ok(bytes) => bytes,
            Err(error) => {
                failures.push(format!(
                    "{}: Rust rejected a case the portal accepts: {error:?}",
                    case.name
                ));
                continue;
            }
        };
        let case_dir = root.join("expected").join(&case.name);
        let mut parts_checked = 0;
        let mut case_failures = Vec::new();
        for folder in ["word", "docProps"] {
            let Ok(entries) = fs::read_dir(case_dir.join(folder)) else {
                continue;
            };
            for entry in entries {
                let path = entry.expect("readable entry").path();
                let part = format!("{folder}/{}", path.file_name().unwrap().to_string_lossy());
                let expected = fs::read_to_string(&path).expect("expected XML is UTF-8");
                let actual = part_xml(&filled, &part);
                parts_checked += 1;
                if canonical(&expected) != canonical(&actual) {
                    case_failures.push(format!(
                        "{} {part}\n  portal: {}\n  rust:   {}",
                        case.name,
                        canonical(&expected),
                        canonical(&actual)
                    ));
                }
            }
        }
        checked_parts += parts_checked;
        eprintln!(
            "parity {} {} ({parts_checked} parts)",
            if case_failures.is_empty() {
                "PASS"
            } else {
                "FAIL"
            },
            case.name
        );
        failures.extend(case_failures);
    }

    assert!(
        checked_parts >= 33,
        "expected at least one part per case, checked {checked_parts}"
    );
    assert!(
        failures.is_empty(),
        "parity failures:\n{}",
        failures.join("\n\n")
    );
}

fn part_xml(docx: &[u8], part: &str) -> String {
    let mut archive =
        zip::ZipArchive::new(std::io::Cursor::new(docx)).expect("filled docx is a zip");
    let mut file = archive
        .by_name(part)
        .expect("part exists in the filled docx");
    let mut xml = String::new();
    std::io::Read::read_to_string(&mut file, &mut xml).expect("UTF-8 XML");
    xml
}
