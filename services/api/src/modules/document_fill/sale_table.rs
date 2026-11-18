//! Sale payment rows and table layout. Mirrors `expandSalePaymentRows` and `fixSaleTableLayout`
//! in `native-document.ts`: one row per installment for the payment columns, and the fixed
//! widths the PDF writer needs.

use std::collections::HashMap;

use super::{
    dom::{Dom, Id},
    engine::{self, Edit, EngineError, Segment},
    layouts::{child_named, text_of},
};

const WORD_2010_NS: &str = "http://schemas.microsoft.com/office/word/2010/wordml";
/// Elements that stop a payment row from being copied (`querySelector` in the portal).
const ROW_BLOCKERS: [&str; 8] = [
    "bookmarkStart",
    "bookmarkEnd",
    "drawing",
    "pict",
    "hyperlink",
    "fldChar",
    "sdt",
    "commentReference",
];

/// `wordAttribute`: sets an attribute with the element's own prefix.
fn word_attr(dom: &mut Dom, element: Id, name: &str, value: &str) {
    let namespace = dom.namespace(element);
    let prefix = dom.prefix(element);
    dom.set_attr(
        element,
        namespace.as_deref(),
        prefix.as_deref(),
        name,
        value,
    );
}

/// `fixSaleTableLayout`: fixed widths for the payment table and the description table, right aligned, below the text.
pub(crate) fn fix_sale_table_layout(dom: &mut Dom, namespace: &str, table: Id) {
    let Some(body) = dom
        .parent(table)
        .filter(|parent| dom.local_is(*parent, "body"))
    else {
        return;
    };
    let description = child_named(dom, body, namespace, "tbl")
        .into_iter()
        .find(|candidate| {
            *candidate != table
                && text_of(dom, *candidate, namespace)
                    .trim()
                    .to_lowercase()
                    .starts_with("descripción del mueble")
        });
    let Some(description) = description else {
        return;
    };
    let clause = child_named(dom, body, namespace, "p")
        .into_iter()
        .find(|paragraph| {
            text_of(dom, *paragraph, namespace)
                .trim()
                .to_lowercase()
                .starts_with("cláusula primera")
        });
    let payment_properties = child_named(dom, table, namespace, "tblPr")
        .into_iter()
        .next();
    let description_properties = child_named(dom, description, namespace, "tblPr")
        .into_iter()
        .next();
    let position = payment_properties.and_then(|properties| {
        child_named(dom, properties, namespace, "tblpPr")
            .into_iter()
            .next()
    });
    let alignment = description_properties.and_then(|properties| {
        child_named(dom, properties, namespace, "jc")
            .into_iter()
            .next()
    });
    let (Some(position), Some(alignment), Some(clause)) = (position, alignment, clause) else {
        return;
    };

    let widths: [usize; 3] = [960, 1477, 1771];
    let description_widths: [usize; 1] = [5954];
    let targets: [(Id, &[usize]); 2] = [(table, &widths), (description, &description_widths)];
    for (target, columns) in targets {
        let Some(properties) = child_named(dom, target, namespace, "tblPr")
            .into_iter()
            .next()
        else {
            return;
        };
        let table_width = child_named(dom, properties, namespace, "tblW")
            .into_iter()
            .next();
        let grid = child_named(dom, target, namespace, "tblGrid")
            .into_iter()
            .next();
        let (Some(_), Some(grid)) = (table_width, grid) else {
            return;
        };
        if child_named(dom, grid, namespace, "gridCol").len() != columns.len() {
            return;
        }
    }

    for (target, columns) in targets {
        let properties = child_named(dom, target, namespace, "tblPr")[0];
        let table_width = child_named(dom, properties, namespace, "tblW")[0];
        let total: usize = columns.iter().sum();
        word_attr(dom, table_width, "type", "dxa");
        word_attr(dom, table_width, "w", &total.to_string());
        let grid = child_named(dom, target, namespace, "tblGrid")[0];
        for (index, column) in child_named(dom, grid, namespace, "gridCol")
            .into_iter()
            .enumerate()
        {
            word_attr(dom, column, "w", &columns[index].to_string());
        }
        for row in child_named(dom, target, namespace, "tr") {
            let cells = child_named(dom, row, namespace, "tc");
            for (index, cell) in cells.iter().copied().enumerate() {
                let cell_properties = child_named(dom, cell, namespace, "tcPr").into_iter().next();
                let width = cell_properties.and_then(|properties| {
                    child_named(dom, properties, namespace, "tcW")
                        .into_iter()
                        .next()
                });
                if let Some(width) = width
                    && (cells.len() == 1 || cells.len() == columns.len())
                {
                    let value = if cells.len() == 1 {
                        total
                    } else {
                        columns[index]
                    };
                    word_attr(dom, width, "w", &value.to_string());
                }
            }
        }
        let layout = match child_named(dom, properties, namespace, "tblLayout")
            .into_iter()
            .next()
        {
            Some(layout) => layout,
            None => {
                let prefix = dom.prefix(target);
                let created = dom.create_element(Some(namespace), prefix.as_deref(), "tblLayout");
                let before = child_named(dom, properties, namespace, "tblLook")
                    .into_iter()
                    .next();
                dom.insert_before(properties, created, before);
                created
            }
        };
        word_attr(dom, layout, "type", "fixed");
    }

    // The writer needs an explicit right alignment and a text-relative anchor to wrap the adjacent content.
    word_attr(dom, alignment, "val", "right");
    word_attr(dom, position, "vertAnchor", "text");
    word_attr(dom, position, "tblpY", "380");
    dom.insert_before(body, table, Some(clause));
}

/// `expandSalePaymentRows`. Returns the part index of the expanded table, or `None` when the table does not match.
/// `parts[index].1` is the DOM of part `index`; `segments` and `edits` are the fill's state.
pub(crate) fn expand_sale_payment_rows(
    parts: &mut [(usize, Dom)],
    namespace: &str,
    segments: &[Segment],
    edits: &mut HashMap<usize, Vec<Edit>>,
    for_pdf: bool,
    columns_to_expand: &[&str],
) -> Result<Option<usize>, EngineError> {
    let mut entries: Vec<(usize, Vec<Edit>)> = Vec::new();
    for key in columns_to_expand {
        let braces = format!("{{{{{key}}}}}");
        let bracket = format!("[{key}]");
        let mut matches: Vec<usize> = edits
            .iter()
            .filter(|(index, list)| {
                let text = &segments[**index].text;
                (*text == braces || *text == bracket) && list.len() == 1
            })
            .map(|(index, _)| *index)
            .collect();
        if matches.len() != 1 {
            return Ok(None);
        }
        let index = matches.remove(0);
        entries.push((index, edits[&index].clone()));
    }

    let part = segments[entries[0].0].part;
    let dom = &mut parts[part].1;
    let cells: Vec<Option<Id>> = entries
        .iter()
        .map(|(index, _)| {
            segments[*index]
                .nodes
                .first()
                .and_then(|node| dom.closest_local(node.node, "tc"))
        })
        .collect();
    let row = cells
        .first()
        .copied()
        .flatten()
        .and_then(|cell| dom.parent(cell));
    let Some(row) = row else {
        return Ok(None);
    };
    let table = dom.parent(row);
    if !dom.local_is(row, "tr") || !table.is_some_and(|table| dom.local_is(table, "tbl")) {
        return Ok(None);
    }
    let Some(table) = table else {
        return Ok(None);
    };
    let row_cells = child_named(dom, row, namespace, "tc");
    if row_cells.len() != entries.len() {
        return Ok(None);
    }
    for (index, cell) in cells.iter().enumerate() {
        let Some(cell) = cell else {
            return Ok(None);
        };
        if *cell != row_cells[index]
            || text_of(dom, *cell, namespace) != segments[entries[index].0].text
        {
            return Ok(None);
        }
        let paragraphs = child_named(dom, *cell, namespace, "p");
        if paragraphs.len() != 1 {
            return Ok(None);
        }
        let blocked = dom.all_elements(paragraphs[0]).iter().any(|element| {
            dom.name(*element)
                .is_some_and(|(_, local)| ROW_BLOCKERS.contains(&local))
        });
        if blocked {
            return Ok(None);
        }
    }

    let lines: Vec<Vec<&str>> = entries
        .iter()
        .map(|(_, list)| list[0].value.split('\n').collect())
        .collect();
    let count = lines[0].len();
    if lines.iter().any(|column| column.len() != count) {
        return Ok(None);
    }
    let rows: Vec<Vec<&str>> = (0..count)
        .map(|index| lines.iter().map(|column| column[index]).collect())
        .collect();
    for (index, values) in rows.iter().enumerate() {
        let copy = dom.clone_deep(row);
        let copy_cells = child_named(dom, copy, namespace, "tc");
        for (column, (segment_index, list)) in entries.iter().enumerate() {
            let segment = &segments[*segment_index];
            let original_nodes = dom.descendants_named(row_cells[column], namespace, "t");
            let copied_nodes = dom.descendants_named(copy_cells[column], namespace, "t");
            let copied_segment = Segment {
                part: segment.part,
                text: segment.text.clone(),
                nodes: segment
                    .nodes
                    .iter()
                    .map(|text| {
                        let position = original_nodes
                            .iter()
                            .position(|node| *node == text.node)
                            .ok_or(EngineError::Structure)?;
                        Ok(engine::WordText {
                            node: copied_nodes[position],
                            start: text.start,
                            end: text.end,
                        })
                    })
                    .collect::<Result<_, EngineError>>()?,
            };
            let mut edit = list[0].clone();
            edit.value = values[column].to_owned();
            engine::replace_in_segment(dom, &copied_segment, &[edit], namespace);
        }
        if index > 0 {
            for paragraph in dom.descendants_named(copy, namespace, "p") {
                dom.remove_attr(paragraph, Some(WORD_2010_NS), "paraId");
                dom.remove_attr(paragraph, Some(WORD_2010_NS), "textId");
            }
        }
        dom.insert_before(table, copy, Some(row));
    }
    dom.remove(row);
    for (segment_index, _) in &entries {
        edits.remove(segment_index);
    }
    if for_pdf {
        fix_sale_table_layout(dom, namespace, table);
    }
    Ok(Some(part))
}

/// The table that holds the first installment's due-date marker, as the PDF branch looks it up.
pub(crate) fn table_of_first_due_date(dom: &Dom, segment: &Segment) -> Option<Id> {
    segment
        .nodes
        .first()
        .and_then(|node| dom.closest_local(node.node, "tbl"))
}
