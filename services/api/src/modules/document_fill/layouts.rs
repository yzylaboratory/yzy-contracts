//! Layouts of the reviewed bodies: the DOM edits that `reviewed-word-layout.ts` applies after the
//! markers are filled. Each function mirrors one `word-*.ts` file of the portal.

use super::{
    dom::{Dom, Id},
    reference::declaration_signature_name,
};

pub(crate) const CONDITIONAL_SALE_TITLE: &str = "CONTRATO DE VENTA CONDICIONAL DE MUEBLES";
const HANDWRITTEN_DATE: &str = "los          (  ) días del mes de(                  )del AÑO DOS MIL_____________________ (    )";
const SIGNATURE_LINE_MIN: usize = 20;

/// `text(element)`: the joined text of every `t` element under `element`.
pub(crate) fn text_of(dom: &Dom, element: Id, ns: &str) -> String {
    dom.descendants_named(element, ns, "t")
        .into_iter()
        .map(|node| dom.text_content(node))
        .collect()
}

/// `Number(element.getAttributeNS(ns, local))` with the JS rules: a missing element is `NaN`, a missing attribute is `0`.
fn number_attr(dom: &Dom, element: Option<Id>, ns: &str, local: &str) -> f64 {
    let Some(element) = element else {
        return f64::NAN;
    };
    match dom.attr(element, Some(ns), local) {
        None => 0.0,
        Some(value) => {
            let trimmed = value.trim();
            if trimmed.is_empty() {
                0.0
            } else {
                trimmed.parse::<f64>().unwrap_or(f64::NAN)
            }
        }
    }
}

fn format_number(value: f64) -> String {
    if value.fract() == 0.0 && value.is_finite() {
        format!("{}", value as i64)
    } else {
        format!("{value}")
    }
}

pub(crate) fn first_named(dom: &Dom, root: Id, ns: &str, local: &str) -> Option<Id> {
    dom.descendants_named(root, ns, local).into_iter().next()
}

pub(crate) fn child_named(dom: &Dom, parent: Id, ns: &str, local: &str) -> Vec<Id> {
    dom.element_children(parent)
        .into_iter()
        .filter(|child| dom.is_named(*child, ns, local))
        .collect()
}

/// Page content width and the half column used by the two-column layouts.
fn page_columns(dom: &Dom, body: Id, ns: &str) -> (f64, f64) {
    let section = first_named(dom, body, ns, "sectPr");
    let page = number_attr(
        dom,
        section.and_then(|section| first_named(dom, section, ns, "pgSz")),
        ns,
        "w",
    );
    let margins = section.and_then(|section| first_named(dom, section, ns, "pgMar"));
    let content =
        page - number_attr(dom, margins, ns, "left") - number_attr(dom, margins, ns, "right");
    (content, (content / 2.0).floor())
}

/// `doc.createElementNS(ns, "w:" + tag)` with the `w:` attributes of the portal's `word()` helper.
fn word(dom: &mut Dom, ns: &str, tag: &str, attributes: &[(&str, String)]) -> Id {
    let element = dom.create_element(Some(ns), Some("w"), tag);
    for (name, value) in attributes {
        dom.set_attr(element, Some(ns), Some("w"), name, value);
    }
    element
}

/// `cloneRunWithText`: a shallow copy of the run with its run properties and a new `w:t`.
fn clone_run_with_text(dom: &mut Dom, ns: &str, source: Id, value: &str) -> Id {
    let run = dom.clone_shallow(source);
    if let Some(properties) = first_named(dom, source, ns, "rPr") {
        let copy = dom.clone_deep(properties);
        dom.append(run, copy);
    }
    let content = word(dom, ns, "t", &[]);
    dom.set_text_content(content, value);
    dom.append(run, content);
    run
}

const XML_SPACE_NS: &str = "http://www.w3.org/XML/1998/namespace";

fn set_space_preserve(dom: &mut Dom, node: Id, text: &str) {
    if text.starts_with(char::is_whitespace) || text.ends_with(char::is_whitespace) {
        dom.set_attr(node, Some(XML_SPACE_NS), Some("xml"), "space", "preserve");
    } else {
        dom.remove_attr(node, Some(XML_SPACE_NS), "space");
    }
}

/// Reads `^ACTO\s+Número,\s+En la\s+Ciudad\b`.
fn is_acto_opening(text: &str) -> bool {
    let Some(rest) = text.strip_prefix("ACTO") else {
        return false;
    };
    let Some(rest) = after_spaces(rest).and_then(|rest| rest.strip_prefix("Número,")) else {
        return false;
    };
    let Some(rest) = after_spaces(rest).and_then(|rest| rest.strip_prefix("En la")) else {
        return false;
    };
    let Some(rest) = after_spaces(rest).and_then(|rest| rest.strip_prefix("Ciudad")) else {
        return false;
    };
    !rest
        .chars()
        .next()
        .is_some_and(|next| next.is_ascii_alphanumeric() || next == '_')
}

/// `\s+` at the start of `text`: the text after the whitespace run, or `None` when there is no whitespace.
fn after_spaces(text: &str) -> Option<&str> {
    let rest = text.trim_start();
    (rest.len() < text.len()).then_some(rest)
}

/// Reads `^_{20,}\s+_{20,}\s+.+\s+TESTIGO\s+TESTIGO\s+_\s*$`.
fn is_witness_block(text: &str) -> bool {
    let strip_lines = |value: &str| -> Option<String> {
        let count = value.bytes().take_while(|byte| *byte == b'_').count();
        (count >= SIGNATURE_LINE_MIN).then(|| value[count..].to_owned())
    };
    let Some(rest) = strip_lines(text).and_then(|rest| after_spaces(&rest).map(str::to_owned))
    else {
        return false;
    };
    let Some(rest) = strip_lines(&rest).and_then(|rest| after_spaces(&rest).map(str::to_owned))
    else {
        return false;
    };
    let trimmed = rest.trim_end();
    let Some(without_underscore) = trimmed.strip_suffix('_') else {
        return false;
    };
    let Some(without_second) = trailing_word(
        without_underscore.trim_end_matches(char::is_whitespace),
        "TESTIGO",
    ) else {
        return false;
    };
    let Some(without_first) = trailing_word(
        without_second.trim_end_matches(char::is_whitespace),
        "TESTIGO",
    ) else {
        return false;
    };
    let middle = without_first.trim_end();
    middle.len() < without_first.len() && !middle.is_empty()
}

/// Removes a trailing `TESTIGO` that follows at least one whitespace character.
fn trailing_word<'a>(text: &'a str, word: &str) -> Option<&'a str> {
    let rest = text.strip_suffix(word)?;
    rest.ends_with(char::is_whitespace).then_some(rest)
}

/// Reads `/\s+TESTIGO\s+TESTIGO\s+$/u` and returns the text before it.
fn strip_witness_labels(text: &str) -> Option<&str> {
    let trimmed = text.trim_end();
    if trimmed.len() == text.len() {
        return None;
    }
    let without_second = trailing_word(trimmed, "TESTIGO")?;
    let without_second = without_second.trim_end();
    let before = trailing_word(without_second, "TESTIGO")?;
    Some(before.trim_end())
}

/// `formatPagareAutentico`: opening header table, and the witness signatures as a table.
pub(crate) fn format_pagare_autentico(dom: &mut Dom, ns: &str) {
    let root = dom.root();
    let Some(body) = first_named(dom, root, ns, "body") else {
        return;
    };
    let (content_width, column_width) = page_columns(dom, body, ns);
    if column_width.is_nan() || column_width <= 0.0 {
        return;
    }
    let right_width = content_width - column_width;

    let children = dom.element_children(body);
    let opening = children
        .iter()
        .copied()
        .find(|child| dom.local_is(*child, "p") && is_acto_opening(&text_of(dom, *child, ns)));
    if let Some(opening) = opening {
        let runs = dom.descendants_named(opening, ns, "r");
        let texts: Vec<String> = runs.iter().map(|run| text_of(dom, *run, ns)).collect();
        let acto = texts.iter().position(|text| text.trim() == "ACTO");
        let numero = acto.and_then(|acto| {
            texts
                .iter()
                .enumerate()
                .position(|(index, text)| index > acto && text.trim() == "Número")
        });
        let comma = numero.and_then(|numero| {
            texts
                .iter()
                .enumerate()
                .position(|(index, text)| index > numero && text.trim() == ",")
        });
        let city = comma.and_then(|comma| {
            texts
                .iter()
                .enumerate()
                .position(|(index, text)| index > comma && text.trim_start().starts_with("En la"))
        });
        let only_whitespace = match (acto, city, comma) {
            (Some(acto), Some(city), Some(comma)) if city > comma => (0..city).all(|index| {
                index == acto
                    || Some(index) == numero
                    || Some(index) == Some(comma)
                    || texts[index].trim().is_empty()
            }),
            _ => false,
        };
        if let (true, Some(acto), Some(numero), Some(comma), Some(city)) =
            (only_whitespace, acto, numero, comma, city)
        {
            let header = build_header_table(
                dom,
                ns,
                content_width,
                column_width,
                right_width,
                &runs,
                acto,
                numero,
                comma,
            );
            dom.insert_before(body, header, Some(opening));
            for run in &runs[..city] {
                dom.remove(*run);
            }
            for node in dom.descendants_named(runs[city], ns, "t") {
                let trimmed = dom.text_content(node).trim_start().to_owned();
                if trimmed.is_empty() {
                    dom.remove(node);
                    continue;
                }
                dom.set_text_content(node, &trimmed);
                set_space_preserve(dom, node, &trimmed);
                break;
            }
        }
    }

    let children = dom.element_children(body);
    let Some(witness) = children
        .iter()
        .copied()
        .find(|child| dom.local_is(*child, "p") && is_witness_block(&text_of(dom, *child, ns)))
    else {
        return;
    };
    let runs = dom.descendants_named(witness, ns, "r");
    let (Some(signature_lines), Some(left_name), Some(right_and_labels)) =
        (runs.first(), runs.get(1), runs.get(2))
    else {
        return;
    };
    let (signature_lines, left_name, right_and_labels) =
        (*signature_lines, *left_name, *right_and_labels);
    let lines_text = text_of(dom, signature_lines, ns);
    let lines: Vec<&str> = lines_text.split_whitespace().collect();
    if lines.len() != 2
        || !lines
            .iter()
            .all(|line| line.len() >= SIGNATURE_LINE_MIN && line.bytes().all(|b| b == b'_'))
    {
        return;
    }
    let right = text_of(dom, right_and_labels, ns);
    let Some(before_labels) = strip_witness_labels(&right) else {
        return;
    };
    let left_text = text_of(dom, left_name, ns).trim().to_owned();
    let names = [left_text, before_labels.trim().to_owned()];
    let lines = [lines[0].to_owned(), lines[1].to_owned()];

    let table = word_table(
        dom,
        ns,
        &[column_width * 2.0, column_width * 2.0],
        &[column_width, column_width],
    );
    let rows: [[(Id, String); 2]; 3] = [
        [
            (signature_lines, lines[0].clone()),
            (signature_lines, lines[1].clone()),
        ],
        [
            (left_name, declaration_signature_name(&names[0])),
            (right_and_labels, declaration_signature_name(&names[1])),
        ],
        [
            (right_and_labels, "TESTIGO".to_owned()),
            (right_and_labels, "TESTIGO".to_owned()),
        ],
    ];
    for (index, cells) in rows.iter().enumerate() {
        let row = word(dom, ns, "tr", &[]);
        let row_properties = word(dom, ns, "trPr", &[]);
        let cant_split = word(dom, ns, "cantSplit", &[]);
        dom.append(row_properties, cant_split);
        dom.append(row, row_properties);
        for (source, value) in cells {
            let cell = word(dom, ns, "tc", &[]);
            let cell_properties = tcw_properties(dom, ns, column_width);
            let paragraph = word(dom, ns, "p", &[]);
            let properties = word(dom, ns, "pPr", &[]);
            if index < rows.len() - 1 {
                let keep = word(dom, ns, "keepNext", &[]);
                dom.append(properties, keep);
            }
            spacing_zero(dom, ns, properties);
            let justify = word(dom, ns, "jc", &[("val", "center".to_owned())]);
            dom.append(properties, justify);
            let run = clone_run_with_text(dom, ns, *source, value);
            dom.append(paragraph, properties);
            dom.append(paragraph, run);
            dom.append(cell, cell_properties);
            dom.append(cell, paragraph);
            dom.append(row, cell);
        }
        dom.append(table, row);
    }
    dom.replace_with(witness, table);
}

fn spacing_zero(dom: &mut Dom, ns: &str, properties: Id) {
    let spacing = word(
        dom,
        ns,
        "spacing",
        &[("before", "0".to_owned()), ("after", "0".to_owned())],
    );
    dom.append(properties, spacing);
}

fn tcw_properties(dom: &mut Dom, ns: &str, width: f64) -> Id {
    let properties = word(dom, ns, "tcPr", &[]);
    let cell_width = word(
        dom,
        ns,
        "tcW",
        &[("w", format_number(width)), ("type", "dxa".to_owned())],
    );
    dom.append(properties, cell_width);
    properties
}

/// `tblW`, `tblLayout` and `tblGrid` of a fixed-layout table with the given grid columns.
fn word_table(dom: &mut Dom, ns: &str, widths: &[f64; 2], columns: &[f64; 2]) -> Id {
    let table = word(dom, ns, "tbl", &[]);
    let properties = word(dom, ns, "tblPr", &[]);
    let table_width = word(
        dom,
        ns,
        "tblW",
        &[("w", format_number(widths[0])), ("type", "dxa".to_owned())],
    );
    let layout = word(dom, ns, "tblLayout", &[("type", "fixed".to_owned())]);
    dom.append(properties, table_width);
    dom.append(properties, layout);
    let grid = word(dom, ns, "tblGrid", &[]);
    for column in columns {
        let grid_column = word(dom, ns, "gridCol", &[("w", format_number(*column))]);
        dom.append(grid, grid_column);
    }
    dom.append(table, properties);
    dom.append(table, grid);
    table
}

/// The header table of the pagaré: «ACTO» on the left, «Número,» on the right, borderless.
#[allow(clippy::too_many_arguments)]
fn build_header_table(
    dom: &mut Dom,
    ns: &str,
    content_width: f64,
    column_width: f64,
    right_width: f64,
    runs: &[Id],
    acto: usize,
    numero: usize,
    comma: usize,
) -> Id {
    let table = word(dom, ns, "tbl", &[]);
    let properties = word(dom, ns, "tblPr", &[]);
    let borders = word(dom, ns, "tblBorders", &[]);
    for edge in ["top", "left", "bottom", "right", "insideH", "insideV"] {
        let line = word(
            dom,
            ns,
            edge,
            &[
                ("val", "none".to_owned()),
                ("sz", "0".to_owned()),
                ("space", "0".to_owned()),
                ("color", "auto".to_owned()),
            ],
        );
        dom.append(borders, line);
    }
    let margins = word(dom, ns, "tblCellMar", &[]);
    for side in ["top", "left", "bottom", "right"] {
        let margin = word(
            dom,
            ns,
            side,
            &[("w", "0".to_owned()), ("type", "dxa".to_owned())],
        );
        dom.append(margins, margin);
    }
    let table_width = word(
        dom,
        ns,
        "tblW",
        &[
            ("w", format_number(content_width)),
            ("type", "dxa".to_owned()),
        ],
    );
    let layout = word(dom, ns, "tblLayout", &[("type", "fixed".to_owned())]);
    for child in [table_width, borders, layout, margins] {
        dom.append(properties, child);
    }
    let grid = word(dom, ns, "tblGrid", &[]);
    let first_column = word(dom, ns, "gridCol", &[("w", format_number(column_width))]);
    let second_column = word(dom, ns, "gridCol", &[("w", format_number(right_width))]);
    dom.append(grid, first_column);
    dom.append(grid, second_column);
    dom.append(table, properties);
    dom.append(table, grid);

    let row = word(dom, ns, "tr", &[]);
    let row_properties = word(dom, ns, "trPr", &[]);
    let cant_split = word(dom, ns, "cantSplit", &[]);
    dom.append(row_properties, cant_split);
    dom.append(row, row_properties);

    let cells: [(f64, &str, Vec<Id>); 2] = [
        (
            column_width,
            "left",
            vec![clone_run_with_text(dom, ns, runs[acto], "ACTO")],
        ),
        (
            right_width,
            "right",
            vec![
                clone_run_with_text(dom, ns, runs[numero], "Número"),
                clone_run_with_text(dom, ns, runs[comma], ","),
            ],
        ),
    ];
    for (width, align, cell_runs) in cells {
        let cell = word(dom, ns, "tc", &[]);
        let cell_properties = tcw_properties(dom, ns, width);
        let paragraph = word(dom, ns, "p", &[]);
        let paragraph_properties = word(dom, ns, "pPr", &[]);
        let keep = word(dom, ns, "keepNext", &[]);
        dom.append(paragraph_properties, keep);
        spacing_zero(dom, ns, paragraph_properties);
        let justify = word(dom, ns, "jc", &[("val", align.to_owned())]);
        dom.append(paragraph_properties, justify);
        dom.append(paragraph, paragraph_properties);
        for run in cell_runs {
            dom.append(paragraph, run);
        }
        dom.append(cell, cell_properties);
        dom.append(cell, paragraph);
        dom.append(row, cell);
    }
    dom.append(table, row);
    table
}

/// `formatEntregaVoluntaria`: the handwritten date line and the witness names.
pub(crate) fn format_entrega_voluntaria(dom: &mut Dom, ns: &str) {
    let root = dom.root();
    let paragraphs = dom.descendants_named(root, ns, "p");
    for paragraph in paragraphs {
        let nodes = dom.descendants_named(paragraph, ns, "t");
        let text: String = nodes
            .iter()
            .map(|node| dom.text_content(*node))
            .collect::<String>();
        let text = text.trim_start();
        if !text.starts_with(
            "En la  Ciudad de Santo Domingo, Distrito Nacional, Capital de la República",
        ) || !text.contains("; por ante mí ")
        {
            continue;
        }
        let prefix = "Dominicana, a ";
        if let Some(date) = nodes
            .iter()
            .copied()
            .find(|node| dom.text_content(*node).starts_with(prefix))
        {
            dom.set_text_content(date, &format!("{prefix}{HANDWRITTEN_DATE}"));
        }
        break;
    }
    format_witness_signatures(dom, ns);
}

/// `formatWitnessSignatures`: the first witness table with two names gets the reviewed signature form.
fn format_witness_signatures(dom: &mut Dom, ns: &str) {
    let root = dom.root();
    for table in dom.descendants_named(root, ns, "tbl") {
        let rows = child_named(dom, table, ns, "tr");
        if rows.len() != 3 {
            continue;
        }
        let lines = child_named(dom, rows[0], ns, "tc");
        let names = child_named(dom, rows[1], ns, "tc");
        let labels = child_named(dom, rows[2], ns, "tc");
        if lines.len() != 2 || names.len() != 2 || labels.len() != 2 {
            continue;
        }
        let line_ok = lines.iter().all(|cell| {
            let text = text_of(dom, *cell, ns);
            let text = text.trim();
            text.len() >= SIGNATURE_LINE_MIN && text.bytes().all(|byte| byte == b'_')
        });
        let labels_ok = labels
            .iter()
            .all(|cell| text_of(dom, *cell, ns).trim() == "TESTIGO");
        if !line_ok || !labels_ok {
            continue;
        }
        for cell in names {
            let nodes = dom.descendants_named(cell, ns, "t");
            let value: String = nodes
                .iter()
                .map(|node| dom.text_content(*node))
                .collect::<String>();
            let value = value.trim().to_owned();
            let Some(first) = nodes.first().copied() else {
                continue;
            };
            if value.is_empty() {
                continue;
            }
            let signature = declaration_signature_name(&value);
            if signature == value {
                continue;
            }
            dom.set_text_content(first, &signature);
            for extra in &nodes[1..] {
                dom.set_text_content(*extra, "");
            }
        }
        return;
    }
}

/// `formatEntregaVehiculo`: «RECIBIDO POR» and «ENTREGADO POR» as a two-column table.
pub(crate) fn format_entrega_vehiculo(dom: &mut Dom, ns: &str) {
    let root = dom.root();
    let Some(body) = first_named(dom, root, ns, "body") else {
        return;
    };
    let paragraphs = dom.element_children(body);
    let text = |dom: &Dom, paragraph: Id| text_of(dom, paragraph, ns).trim().to_owned();
    let received = paragraphs.iter().position(|paragraph| {
        dom.local_is(*paragraph, "p") && text(dom, *paragraph) == "RECIBIDO POR:"
    });
    let delivered = paragraphs.iter().position(|paragraph| {
        dom.local_is(*paragraph, "p") && text(dom, *paragraph) == "ENTREGADO POR:"
    });
    let (Some(received), Some(delivered)) = (received, delivered) else {
        return;
    };
    if received < 1 || delivered <= received + 1 {
        return;
    }
    let names = [paragraphs[received - 1], paragraphs[delivered - 1]];
    let labels = [paragraphs[received], paragraphs[delivered]];
    let separators: Vec<Id> = paragraphs[received + 1..delivered - 1].to_vec();
    if names
        .iter()
        .chain(separators.iter())
        .any(|paragraph| !dom.local_is(*paragraph, "p"))
        || separators
            .iter()
            .any(|paragraph| !text(dom, *paragraph).is_empty())
    {
        return;
    }

    let (_, column_width) = page_columns(dom, body, ns);
    if !column_width.is_finite() || column_width <= 0.0 {
        return;
    }
    let table = word_table(
        dom,
        ns,
        &[column_width * 2.0, column_width * 2.0],
        &[column_width, column_width],
    );
    dom.insert_before(body, table, Some(names[0]));

    for (index, blocks) in [names, labels].iter().enumerate() {
        let row = word(dom, ns, "tr", &[]);
        let row_properties = word(dom, ns, "trPr", &[]);
        let cant_split = word(dom, ns, "cantSplit", &[]);
        dom.append(row_properties, cant_split);
        dom.append(row, row_properties);
        for paragraph in blocks {
            let paragraph = *paragraph;
            if let Some(properties) = first_named(dom, paragraph, ns, "pPr") {
                if let Some(tabs) = first_named(dom, properties, ns, "tabs") {
                    dom.remove(tabs);
                }
                if let Some(indent) = first_named(dom, properties, ns, "ind") {
                    dom.remove(indent);
                }
                if index == 0 {
                    let keep = word(dom, ns, "keepNext", &[]);
                    dom.prepend(properties, keep);
                }
            }
            if index == 1 {
                for run in dom.descendants_named(paragraph, ns, "r") {
                    let Some(run_properties) = first_named(dom, run, ns, "rPr") else {
                        continue;
                    };
                    if dom.descendants_named(run_properties, ns, "u").is_empty() {
                        let underline = word(dom, ns, "u", &[("val", "single".to_owned())]);
                        let before = first_named(dom, run_properties, ns, "lang");
                        dom.insert_before(run_properties, underline, before);
                    }
                }
            }
            let cell = word(dom, ns, "tc", &[]);
            let cell_properties = tcw_properties(dom, ns, column_width);
            dom.append(cell, cell_properties);
            dom.append(cell, paragraph);
            dom.append(row, cell);
        }
        dom.append(table, row);
    }
    for separator in separators {
        dom.remove(separator);
    }
}

/// `formatActoSeguro`: the insured title, the opening line and the buyer's details.
pub(crate) fn format_acto_seguro(dom: &mut Dom, ns: &str) {
    let root = dom.root();
    let Some(body) = first_named(dom, root, ns, "body") else {
        return;
    };
    let paragraphs: Vec<Id> = dom
        .element_children(body)
        .into_iter()
        .filter(|child| dom.is_named(*child, ns, "p"))
        .collect();
    let plain = |dom: &Dom, paragraph: Id| text_of(dom, paragraph, ns);

    if let Some(heading) = paragraphs
        .iter()
        .copied()
        .find(|paragraph| plain(dom, *paragraph).trim() == CONDITIONAL_SALE_TITLE)
    {
        let last = dom
            .descendants_named(heading, ns, "t")
            .into_iter()
            .rev()
            .find(|node| !dom.text_content(*node).trim().is_empty());
        if let Some(last) = last {
            let value = format!("{} (SEGURO)", dom.text_content(last).trim_end());
            dom.set_text_content(last, &value);
        }
    }
    let opening = paragraphs.iter().copied().find(|paragraph| {
        plain(dom, *paragraph)
            .trim_start()
            .to_lowercase()
            .starts_with("inversiones martínez rosario, s.r.l.")
    });
    if let Some(opening) = opening {
        if let Some(indent) = first_named(dom, opening, ns, "ind") {
            dom.remove_attr(indent, Some(ns), "hanging");
        }
        for run in dom.descendants_named(opening, ns, "r") {
            let contents: Vec<Id> = dom
                .element_children(run)
                .into_iter()
                .filter(|child| {
                    dom.namespace(*child).as_deref() == Some(ns) && !dom.local_is(*child, "rPr")
                })
                .collect();
            let has_content = contents.iter().any(|child| {
                !dom.local_is(*child, "tab")
                    && (!dom.local_is(*child, "t") || !dom.text_content(*child).trim().is_empty())
            });
            if has_content {
                if let Some(first_text) = contents
                    .iter()
                    .copied()
                    .find(|child| dom.local_is(*child, "t"))
                {
                    let trimmed = dom.text_content(first_text).trim_start().to_owned();
                    dom.set_text_content(first_text, &trimmed);
                }
                break;
            }
            for node in contents {
                dom.remove(node);
            }
        }
    }

    let Some(signature) = paragraphs
        .iter()
        .copied()
        .find(|paragraph| plain(dom, *paragraph).trim() == "FIRMA DEL COMPRADOR")
    else {
        return;
    };
    let Some(details) = dom.next_element_sibling(signature) else {
        return;
    };
    if !dom.is_named(details, ns, "tbl") {
        return;
    }
    for paragraph in dom.descendants_named(details, ns, "p") {
        let text = plain(dom, paragraph);
        let trimmed = text.trim_start();
        let Some(label) = ["Nombre:", "Cédula:", "Dirección:"]
            .into_iter()
            .find(|label| trimmed.starts_with(label))
        else {
            continue;
        };
        let nodes = dom.descendants_named(paragraph, ns, "t");
        let Some((first, rest)) = nodes.split_first() else {
            continue;
        };
        dom.set_text_content(*first, label);
        for node in rest {
            dom.set_text_content(*node, "");
        }
    }
}

/// `formatGps`: space above the notary signature and the centred debtor label.
pub(crate) fn format_gps(dom: &mut Dom, ns: &str) {
    let root = dom.root();
    for paragraph in dom.descendants_named(root, ns, "p") {
        let runs = dom.descendants_named(paragraph, ns, "t");
        let text: String = runs
            .iter()
            .map(|run| dom.text_content(*run))
            .collect::<String>();
        let text = text.trim().to_owned();
        if text == "ABOGADO NOTARIO" {
            let Some(signature) = dom.previous_element_sibling(paragraph) else {
                continue;
            };
            if !dom.is_named(signature, ns, "p") {
                continue;
            }
            let Some(properties) = first_named(dom, signature, ns, "pPr") else {
                continue;
            };
            let Some(spacing) = first_named(dom, properties, ns, "spacing") else {
                continue;
            };
            let prefix = dom.prefix(signature).unwrap_or_else(|| "w".to_owned());
            dom.set_attr(spacing, Some(ns), Some(&prefix), "before", "1080");
            if let Some(contextual) = first_named(dom, properties, ns, "contextualSpacing") {
                dom.remove(contextual);
            }
            continue;
        }
        if text != "SEGUNDA PARTE O DEUDOR" {
            continue;
        }
        for run in &runs {
            let content = dom.text_content(*run).trim_start().to_owned();
            dom.set_text_content(*run, &content);
            if !content.is_empty() {
                break;
            }
        }
        let prefix = dom.prefix(paragraph);
        let properties = match first_named(dom, paragraph, ns, "pPr") {
            Some(properties) => properties,
            None => {
                let created = dom.create_element(Some(ns), prefix.as_deref(), "pPr");
                dom.prepend(paragraph, created);
                created
            }
        };
        let alignment = match first_named(dom, properties, ns, "jc") {
            Some(alignment) => alignment,
            None => {
                let created = dom.create_element(Some(ns), prefix.as_deref(), "jc");
                let before = first_named(dom, properties, ns, "rPr");
                dom.insert_before(properties, created, before);
                created
            }
        };
        dom.set_attr(alignment, Some(ns), Some("w"), "val", "center");
    }
}

/// `formatVentaCondicional`: the sale heading, the parties line and the buyer's labels.
pub(crate) fn format_venta_condicional(dom: &mut Dom, ns: &str) {
    let root = dom.root();
    let Some(body) = first_named(dom, root, ns, "body") else {
        return;
    };
    // The portal's `child.localName === "p"` ignores the namespace here.
    let paragraphs: Vec<Id> = dom
        .element_children(body)
        .into_iter()
        .filter(|child| dom.local_is(*child, "p"))
        .collect();
    let title_index = paragraphs
        .iter()
        .position(|paragraph| text_of(dom, *paragraph, ns).trim() == CONDITIONAL_SALE_TITLE);
    if let Some(title_index) = title_index {
        if let Some(subtitle) = paragraphs.get(title_index + 1).copied()
            && text_of(dom, subtitle, ns)
                .trim()
                .to_lowercase()
                .starts_with("fecha del contrato:")
        {
            dom.remove(subtitle);
        }
        let parties = paragraphs[title_index + 1..]
            .iter()
            .copied()
            .find(|paragraph| {
                is_connected(dom, *paragraph, root)
                    && !text_of(dom, *paragraph, ns).trim().is_empty()
            });
        if let Some(parties) = parties {
            for node in dom.descendants_named(parties, ns, "t") {
                let value = dom.text_content(node).trim_start().to_owned();
                if !value.is_empty() {
                    dom.set_text_content(node, &value);
                    break;
                }
                dom.remove(node);
            }
            if let Some(indent) = first_named(dom, parties, ns, "ind") {
                dom.remove(indent);
            }
            if let Some(tabs) = first_named(dom, parties, ns, "tabs") {
                dom.remove(tabs);
            }
        }
        let first_clause = paragraphs
            .iter()
            .copied()
            .find(|paragraph| text_of(dom, *paragraph, ns).starts_with("CLÁUSULA PRIMERA:"));
        if let Some(indent) = first_clause.and_then(|clause| first_named(dom, clause, ns, "ind")) {
            dom.remove(indent);
        }
    }

    let Some(signature) = paragraphs
        .iter()
        .copied()
        .find(|paragraph| text_of(dom, *paragraph, ns).trim() == "FIRMA DEL COMPRADOR")
    else {
        return;
    };
    let Some(details) = dom.next_element_sibling(signature) else {
        return;
    };
    if !dom.local_is(details, "tbl") {
        return;
    }
    for label in ["Nombre:", "Cédula:", "Dirección:"] {
        let field = dom
            .descendants_named(details, ns, "p")
            .into_iter()
            .find(|paragraph| text_of(dom, *paragraph, ns).starts_with(label));
        let Some(field) = field else {
            continue;
        };
        let Some(first_text) = dom.descendants_named(field, ns, "t").into_iter().next() else {
            continue;
        };
        let Some(original_run) = dom.parent(first_text) else {
            continue;
        };
        let label_run = dom.clone_shallow(original_run);
        if let Some(style) = first_named(dom, original_run, ns, "rPr") {
            let copy = dom.clone_deep(style);
            dom.append(label_run, copy);
        }
        let label_text = dom.clone_shallow(first_text);
        dom.set_text_content(label_text, label);
        dom.append(label_run, label_text);
        for run in dom.descendants_named(field, ns, "r") {
            dom.remove(run);
        }
        dom.append(field, label_run);
    }
}

/// `node.isConnected`: the node is still attached under the document root.
fn is_connected(dom: &Dom, id: Id, root: Id) -> bool {
    std::iter::successors(Some(id), |current| dom.parent(*current))
        .last()
        .is_some_and(|top| top == root)
}

/// `formatDeclaracionJurada`: the two witness signatures as a table, replacing the signature line.
pub(crate) fn format_declaracion_jurada(dom: &mut Dom, ns: &str) {
    let root = dom.root();
    let Some(body) = first_named(dom, root, ns, "body") else {
        return;
    };
    let labels = dom.element_children(body).into_iter().find(|child| {
        dom.local_is(*child, "p") && {
            let text = text_of(dom, *child, ns);
            let text = text.trim();
            text.strip_prefix("TESTIGO")
                .and_then(|rest| rest.strip_prefix(|character: char| character.is_whitespace()))
                .is_some_and(|rest| rest.trim_start() == "TESTIGO")
        }
    });
    let Some(labels) = labels else {
        return;
    };
    let Some(signatures) = dom.previous_element_sibling(labels) else {
        return;
    };
    if !dom.local_is(signatures, "p") {
        return;
    }
    let signature_runs = dom.descendants_named(signatures, ns, "r");
    let line_style = signature_runs.iter().copied().find(|run| {
        let text = text_of(dom, *run, ns);
        let text = text.trim();
        text.len() >= SIGNATURE_LINE_MIN && text.bytes().all(|byte| byte == b'_')
    });
    let names: Vec<Id> = signature_runs
        .iter()
        .copied()
        .filter(|run| text_of(dom, *run, ns).chars().any(char::is_alphabetic))
        .collect();
    let label_style = dom
        .descendants_named(labels, ns, "r")
        .into_iter()
        .find(|run| text_of(dom, *run, ns).trim() == "TESTIGO");
    let (Some(line_style), Some(label_style)) = (line_style, label_style) else {
        return;
    };
    if names.len() != 2 {
        return;
    }

    let (_, column_width) = page_columns(dom, body, ns);
    if column_width == 0.0 || column_width.is_nan() || column_width < 0.0 {
        return;
    }
    let table = word_table(
        dom,
        ns,
        &[column_width * 2.0, column_width * 2.0],
        &[column_width, column_width],
    );

    let rows: [[Id; 2]; 3] = [
        [line_style, line_style],
        [names[0], names[1]],
        [label_style, label_style],
    ];
    for (index, sources) in rows.iter().enumerate() {
        let row = word(dom, ns, "tr", &[]);
        let row_properties = word(dom, ns, "trPr", &[]);
        let cant_split = word(dom, ns, "cantSplit", &[]);
        dom.append(row_properties, cant_split);
        dom.append(row, row_properties);
        for source in sources {
            let cell = word(dom, ns, "tc", &[]);
            let cell_properties = tcw_properties(dom, ns, column_width);
            let paragraph = word(dom, ns, "p", &[]);
            let properties = word(dom, ns, "pPr", &[]);
            if index < rows.len() - 1 {
                let keep = word(dom, ns, "keepNext", &[]);
                dom.append(properties, keep);
            }
            spacing_zero(dom, ns, properties);
            let justify = word(dom, ns, "jc", &[("val", "center".to_owned())]);
            dom.append(properties, justify);
            let run = dom.clone_shallow(*source);
            if let Some(run_properties) = first_named(dom, *source, ns, "rPr") {
                let copy = dom.clone_deep(run_properties);
                dom.append(run, copy);
            }
            let content = word(dom, ns, "t", &[]);
            let value = text_of(dom, *source, ns).trim().to_owned();
            let value = if index == 1 {
                declaration_signature_name(&value)
            } else {
                value
            };
            dom.set_text_content(content, &value);
            dom.append(run, content);
            dom.append(paragraph, properties);
            dom.append(paragraph, run);
            dom.append(cell, cell_properties);
            dom.append(cell, paragraph);
            dom.append(row, cell);
        }
        dom.append(table, row);
    }
    dom.replace_with(signatures, table);
    dom.remove(labels);
}

/// `formatAutorizacionData` is empty in the portal: the reviewed body keeps its own layout.
pub(crate) fn format_autorizacion_data() {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn acto_opening_matches_the_portal_regex() {
        assert!(is_acto_opening(
            "ACTO Número, En la Ciudad de Santo Domingo"
        ));
        assert!(is_acto_opening("ACTO  Número,\tEn la  Ciudad"));
        assert!(!is_acto_opening("ACTO Número, En la Ciudades"));
        assert!(!is_acto_opening(" ACTO Número, En la Ciudad"));
    }

    #[test]
    fn witness_block_matches_the_portal_regex() {
        let block = format!(
            "{} {} NOMBRE TESTIGO TESTIGO _",
            "_".repeat(25),
            "_".repeat(25)
        );
        assert!(is_witness_block(&block));
        assert!(!is_witness_block("____ ____ NOMBRE TESTIGO TESTIGO _"));
    }

    #[test]
    fn witness_labels_are_stripped_from_the_end_only() {
        assert_eq!(
            strip_witness_labels("NOMBRE TESTIGO TESTIGO "),
            Some("NOMBRE")
        );
        assert_eq!(strip_witness_labels("NOMBRE TESTIGO TESTIGO"), None);
        assert_eq!(strip_witness_labels("NOMBRE TESTIGO"), None);
    }
}
