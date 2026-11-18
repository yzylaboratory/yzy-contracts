//! Marker replacement inside WordprocessingML parts. Mirrors
//! `wordSegments`, `resolveNativeTargets` and `replaceInSegment` from
//! `apps/portal/app/contratos/native-document.ts`.
//!
//! Offsets are byte offsets into the Rust string of each segment. The portal
//! uses UTF-16 offsets internally, but every comparison here stays inside the
//! same representation, so the outcome is the same.

use std::collections::HashMap;

use super::dom::{Dom, Id};
use super::format::{FieldSpec, format_word_value, is_contract_address_key};
use super::reference::reference_word_value;
use super::reviewed::ReviewedModel;

pub(crate) const WORD_NAMESPACE: &str =
    "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
pub(crate) const WORD_NAMESPACE_ISO: &str = "http://purl.oclc.org/ooxml/wordprocessingml/main";
pub(crate) const MAX_VARIABLES: usize = 100;
pub(crate) const MAX_OCCURRENCES: usize = 1000;

const PROTECTED_CONTAINERS: [&str; 8] = [
    "del",
    "ins",
    "moveFrom",
    "moveTo",
    "fldSimple",
    "hyperlink",
    "sdt",
    "AlternateContent",
];
const EXCLUDED: [&str; 22] = [
    "del",
    "ins",
    "moveFrom",
    "moveTo",
    "fldSimple",
    "hyperlink",
    "sdt",
    "AlternateContent",
    "p",
    "instrText",
    "drawing",
    "object",
    "pict",
    "tab",
    "br",
    "cr",
    "sym",
    "noBreakHyphen",
    "softHyphen",
    "footnoteReference",
    "endnoteReference",
    "commentReference",
];
const RPR_AFTER_BOLD: [&str; 33] = [
    "bCs",
    "i",
    "iCs",
    "caps",
    "smallCaps",
    "strike",
    "dstrike",
    "outline",
    "shadow",
    "emboss",
    "imprint",
    "noProof",
    "snapToGrid",
    "vanish",
    "webHidden",
    "color",
    "spacing",
    "w",
    "kern",
    "position",
    "sz",
    "szCs",
    "highlight",
    "u",
    "effect",
    "bdr",
    "shd",
    "fitText",
    "vertAlign",
    "rtl",
    "cs",
    "em",
    "lang",
];

/// Error categories. The caller maps them to HTTP codes.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum EngineError {
    /// Variables do not match the template (`INVALID_DOCX_VARIABLES`).
    Variables,
    /// The package or part structure cannot be edited (`INVALID_DOCX_TEMPLATE`).
    Structure,
    /// A required value is missing or a value cannot be written (`VALIDATION_ERROR`).
    Value(String),
}

#[derive(Clone, Debug)]
pub(crate) struct WordText {
    pub node: Id,
    pub start: usize,
    pub end: usize,
}

#[derive(Clone, Debug)]
pub(crate) struct Segment {
    pub part: usize,
    pub text: String,
    pub nodes: Vec<WordText>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct TextRun {
    pub text: String,
    pub bold: bool,
}

#[derive(Clone, Debug)]
pub(crate) struct Edit {
    pub start: usize,
    pub end: usize,
    pub value: String,
    pub bold: bool,
    pub runs: Option<Vec<TextRun>>,
}

/// One `{{key}}` token, or a bare brace pair that the template must not contain.
#[derive(Debug, PartialEq, Eq)]
pub(crate) struct Token {
    pub start: usize,
    pub end: usize,
    pub key: Option<String>,
}

/// Tokens as `/\{\{([a-z][a-z0-9_]{0,63})\}\}|\{\{|\}\}/g` finds them.
pub(crate) fn tokens(text: &str) -> Vec<Token> {
    let bytes = text.as_bytes();
    let mut found = Vec::new();
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index..].starts_with(b"{{") {
            let key_start = index + 2;
            let key_end = key_start
                + bytes[key_start..]
                    .iter()
                    .take(64)
                    .take_while(|byte| {
                        byte.is_ascii_lowercase() || byte.is_ascii_digit() || **byte == b'_'
                    })
                    .count();
            let valid_start = bytes.get(key_start).is_some_and(u8::is_ascii_lowercase);
            if valid_start && key_end > key_start && bytes[key_end..].starts_with(b"}}") {
                found.push(Token {
                    start: index,
                    end: key_end + 2,
                    key: Some(text[key_start..key_end].to_owned()),
                });
                index = key_end + 2;
            } else {
                found.push(Token {
                    start: index,
                    end: index + 2,
                    key: None,
                });
                index += 2;
            }
        } else if bytes[index..].starts_with(b"}}") {
            found.push(Token {
                start: index,
                end: index + 2,
                key: None,
            });
            index += 2;
        } else {
            index += 1;
        }
    }
    found
}

/// `nativeKeys`: every token must be a valid key, up to the occurrence limit.
pub(crate) fn native_keys(text: &str) -> Result<Vec<String>, EngineError> {
    let mut keys = Vec::new();
    for token in tokens(text) {
        match token.key {
            Some(key) if keys.len() < MAX_OCCURRENCES => keys.push(key),
            _ => return Err(EngineError::Variables),
        }
    }
    Ok(keys)
}

fn is_word_namespace(namespace: Option<&str>) -> bool {
    matches!(namespace, Some(WORD_NAMESPACE | WORD_NAMESPACE_ISO))
}

/// Text of a paragraph as the portal's `paragraphText` reads it.
fn paragraph_text(dom: &Dom, paragraph: Id, namespace: &str) -> String {
    fn collect(dom: &Dom, element: Id, namespace: &str, out: &mut String) {
        if dom.local_is(element, "p") {
            return;
        }
        if dom.namespace(element).as_deref() == Some(namespace)
            && ["t", "delText", "instrText"]
                .iter()
                .any(|name| dom.local_is(element, name))
        {
            out.push_str(&dom.text_content(element));
            return;
        }
        for child in dom.element_children(element) {
            collect(dom, child, namespace, out);
        }
    }
    let mut out = String::new();
    for child in dom.element_children(paragraph) {
        collect(dom, child, namespace, &mut out);
    }
    out
}

fn word_paragraphs(dom: &Dom, namespace: &str) -> Vec<Id> {
    let mut found = Vec::new();
    let mut stack = vec![dom.root()];
    while let Some(element) = stack.pop() {
        if dom.is_named(element, namespace, "p") {
            found.push(element);
        }
        let mut children = dom.element_children(element);
        children.reverse();
        stack.extend(children);
    }
    found
}

/// `wordSegments`: text segments of one part, and the native-variable checks that run with them.
pub(crate) fn segments(dom: &Dom, part: usize) -> Result<Vec<Segment>, EngineError> {
    collect_segments(dom, part, true)
}

pub(super) fn collect_segments(
    dom: &Dom,
    part: usize,
    validate_native: bool,
) -> Result<Vec<Segment>, EngineError> {
    let root_namespace = dom.namespace(dom.root());
    if !is_word_namespace(root_namespace.as_deref()) {
        return Err(EngineError::Structure);
    }
    let namespace = root_namespace.unwrap_or_default();
    let mut result = Vec::new();
    for paragraph in word_paragraphs(dom, &namespace) {
        let full_keys = if validate_native {
            native_keys(&paragraph_text(dom, paragraph, &namespace))?
        } else {
            Vec::new()
        };
        let protected = ancestors(dom, paragraph).any(|ancestor| {
            PROTECTED_CONTAINERS
                .iter()
                .any(|name| dom.local_is(ancestor, name))
        });
        if protected {
            if !full_keys.is_empty() {
                return Err(EngineError::Variables);
            }
            continue;
        }
        let mut walk = Walk {
            namespace: &namespace,
            part,
            validate_native,
            field_depth: 0,
            current: empty_segment(part),
            out: Vec::new(),
            supported: Vec::new(),
        };
        for child in dom.element_children(paragraph) {
            walk.visit(dom, child)?;
        }
        walk.flush()?;
        if full_keys != walk.supported {
            return Err(EngineError::Variables);
        }
        result.extend(walk.out);
    }
    Ok(result)
}

fn empty_segment(part: usize) -> Segment {
    Segment {
        part,
        text: String::new(),
        nodes: Vec::new(),
    }
}

fn ancestors(dom: &Dom, id: Id) -> impl Iterator<Item = Id> + '_ {
    std::iter::successors(dom.parent(id), move |current| dom.parent(*current))
}

struct Walk<'a> {
    namespace: &'a str,
    part: usize,
    validate_native: bool,
    field_depth: usize,
    current: Segment,
    out: Vec<Segment>,
    supported: Vec<String>,
}

impl Walk<'_> {
    fn flush(&mut self) -> Result<(), EngineError> {
        if !self.current.text.is_empty() {
            if self.validate_native {
                self.supported.extend(native_keys(&self.current.text)?);
            }
            let finished = std::mem::replace(&mut self.current, empty_segment(self.part));
            self.out.push(finished);
        } else {
            self.current = empty_segment(self.part);
        }
        Ok(())
    }

    fn visit(&mut self, dom: &Dom, element: Id) -> Result<(), EngineError> {
        let in_namespace = dom.namespace(element).as_deref() == Some(self.namespace);
        if in_namespace && dom.local_is(element, "fldChar") {
            match dom.attr(element, Some(self.namespace), "fldCharType") {
                Some("begin") => self.field_depth += 1,
                Some("end") => self.field_depth = self.field_depth.saturating_sub(1),
                _ => {}
            }
            return self.flush();
        }
        if dom
            .name(element)
            .is_some_and(|(_, local)| EXCLUDED.contains(&local))
        {
            return self.flush();
        }
        if in_namespace && dom.local_is(element, "t") && self.field_depth == 0 {
            let text = dom.text_content(element);
            if !text.is_empty() {
                let start = self.current.text.len();
                self.current.text.push_str(&text);
                let end = self.current.text.len();
                self.current.nodes.push(WordText {
                    node: element,
                    start,
                    end,
                });
            }
            return Ok(());
        }
        for child in dom.element_children(element) {
            self.visit(dom, child)?;
        }
        Ok(())
    }
}

/// Request-level inputs for the native path (`resolveNativeTargets`).
pub(crate) struct NativeRequest<'a> {
    pub variables: &'a [(String, u32)],
    pub fields: &'a [FieldSpec],
    /// Values after the reviewed reference pass (`reviewedReferenceValues`).
    pub values: &'a HashMap<String, String>,
    pub allow_incomplete: bool,
    pub uppercase: bool,
    pub bold_pagare_date: bool,
    /// Reviewed model whose reference values replace the formatted value (`reference`).
    pub reference: Option<ReviewedModel>,
    /// Bold fields of the reviewed layout (`layout.boldFields`).
    pub layout_bold: &'static [&'static str],
}

/// `resolveNativeTargets`: one edit per `{{clave}}` marker, in reading order per segment.
pub(crate) fn resolve_native(
    segments: &[Segment],
    request: &NativeRequest<'_>,
) -> Result<HashMap<usize, Vec<Edit>>, EngineError> {
    if request.variables.is_empty() || request.variables.len() > MAX_VARIABLES {
        return Err(EngineError::Variables);
    }
    let by_key: HashMap<&str, &FieldSpec> = request
        .fields
        .iter()
        .map(|field| (field.key.as_str(), field))
        .collect();
    // Per key: occurrences declared, occurrences left to match, and the formatted value.
    let mut expected: HashMap<&str, (usize, usize, String)> = HashMap::new();
    let mut total = 0usize;
    for (key, occurrences) in request.variables {
        let field = by_key.get(key.as_str()).ok_or(EngineError::Variables)?;
        if !valid_key(key) || expected.contains_key(key.as_str()) || *occurrences < 1 {
            return Err(EngineError::Variables);
        }
        total += *occurrences as usize;
        if total > MAX_OCCURRENCES {
            return Err(EngineError::Variables);
        }
        let raw = request.values.get(key).map(String::as_str).unwrap_or("");
        let value = format_word_value(field, raw, request.uppercase).map_err(EngineError::Value)?;
        if value.is_empty() && field.required && !request.allow_incomplete {
            return Err(EngineError::Value(format!(
                "Completa el campo «{}».",
                field.label
            )));
        }
        expected.insert(
            key.as_str(),
            (*occurrences as usize, *occurrences as usize, value),
        );
    }

    let mut by_segment: HashMap<usize, Vec<Edit>> = HashMap::new();
    for (index, segment) in segments.iter().enumerate() {
        let mut edits = Vec::new();
        for token in tokens(&segment.text) {
            let key = token.key.as_deref().ok_or(EngineError::Variables)?;
            let entry = expected.get_mut(key).ok_or(EngineError::Variables)?;
            if entry.1 == 0 {
                return Err(EngineError::Variables);
            }
            let occurrence = entry.0 - entry.1;
            entry.1 -= 1;
            let raw = request.values.get(key).map(String::as_str).unwrap_or("");
            let formatted = match request.reference {
                Some(model) => reference_word_value(model, key, occurrence, raw, &entry.2),
                None => entry.2.clone(),
            };
            let prefix = &segment.text[..token.start];
            let value = match formatted.strip_prefix("RD$") {
                Some(rest) if prefix.ends_with("RD$") => rest.to_owned(),
                _ => vehicle_identifier_value(key, &formatted, prefix),
            };
            let bold_field = request.layout_bold.contains(&key);
            let runs = if bold_field {
                None
            } else {
                pagare_date_runs(key, &value, request.bold_pagare_date)
            };
            edits.push(Edit {
                start: token.start,
                end: token.end,
                value,
                bold: bold_field || (request.reference.is_none() && is_contract_address_key(key)),
                runs,
            });
        }
        if !edits.is_empty() {
            edits.reverse();
            by_segment.insert(index, edits);
        }
    }
    if expected.values().any(|(_, remaining, _)| *remaining != 0) {
        return Err(EngineError::Variables);
    }
    Ok(by_segment)
}

fn valid_key(key: &str) -> bool {
    let bytes = key.as_bytes();
    (1..=64).contains(&bytes.len())
        && bytes[0].is_ascii_lowercase()
        && bytes
            .iter()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || *byte == b'_')
}

/// `wordVehicleIdentifierValue`: an empty plate or engine field becomes a handwriting line when its label precedes it.
fn vehicle_identifier_value(key: &str, value: &str, prefix: &str) -> String {
    let label = match key {
        "placa_del_vehiculo" | "vehiculo_matricula" => Some("NO.DE REGISTRO Y PLACA:"),
        "numero_de_serie_del_motor" | "vehiculo_motor" => Some("MOTOR O NO.DE SERIE:"),
        _ => None,
    };
    let Some(label) = label else {
        return value.to_owned();
    };
    if !value.is_empty() || !ends_with_label(prefix, label) {
        return value.to_owned();
    }
    if prefix.ends_with(':') {
        " ____________________".to_owned()
    } else {
        "____________________".to_owned()
    }
}

/// Case-insensitive match of `NO. DE` as `NO\.\s*DE` and of runs of whitespace as `\s+`, followed by optional trailing whitespace.
fn ends_with_label(prefix: &str, label: &str) -> bool {
    let normalized = prefix
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_uppercase()
        .replace("NO. DE", "NO.DE");
    normalized.trim_end().ends_with(label)
}

/// `pagareDateRuns`: bolds the day, month and year of a pagaré date.
fn pagare_date_runs(key: &str, value: &str, bold_pagare_date: bool) -> Option<Vec<TextRun>> {
    if !bold_pagare_date || !matches!(key, "fecha_firma" | "fecha_de_firma") || value.is_empty() {
        return None;
    }
    if let Some(runs) = act_date_runs(value) {
        return Some(runs);
    }
    if let Some(runs) = long_date_runs(value) {
        return Some(runs);
    }
    Some(vec![TextRun {
        text: value.to_owned(),
        bold: true,
    }])
}

fn text_run(text: &str, bold: bool) -> TextRun {
    TextRun {
        text: text.to_owned(),
        bold,
    }
}

fn act_date_runs(value: &str) -> Option<Vec<TextRun>> {
    let marker = " días del mes de ";
    let at = value.find(marker)?;
    let (head, rest) = (&value[..at], &value[at + marker.len()..]);
    let number_end = head.strip_suffix(')')?;
    let open = number_end.rfind('(')?;
    let digits = &number_end[open + 1..];
    if open == 0 || digits.is_empty() || !digits.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    let (month, year) = rest.split_once(" del año ")?;
    if month.is_empty()
        || !month.chars().all(|character| {
            character.is_uppercase() || character == ' ' || "ÁÉÍÓÚÑ".contains(character)
        })
    {
        return None;
    }
    if year.len() != 4 || !year.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    Some(vec![
        text_run(head, true),
        text_run(marker, false),
        text_run(month, true),
        text_run(" del año ", false),
        text_run(year, true),
    ])
}

fn long_date_runs(value: &str) -> Option<Vec<TextRun>> {
    let mut parts = value.splitn(3, " de ");
    let day = parts.next()?;
    let month = parts.next()?;
    let year = parts.next()?;
    if day.is_empty() || day.len() > 2 || !day.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    if month.is_empty()
        || !month
            .chars()
            .all(|character| character.is_lowercase() || "áéíóúñ".contains(character))
    {
        return None;
    }
    if year.len() != 4 || !year.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    Some(vec![
        text_run(day, true),
        text_run(" de ", false),
        text_run(month, true),
        text_run(" de ", false),
        text_run(year, true),
    ])
}

fn is_run_bold(dom: &Dom, run: Id, namespace: &str) -> bool {
    let Some(properties) = dom
        .element_children(run)
        .into_iter()
        .find(|child| dom.is_named(*child, namespace, "rPr"))
    else {
        return false;
    };
    let Some(bold) = dom
        .element_children(properties)
        .into_iter()
        .find(|child| dom.is_named(*child, namespace, "b"))
    else {
        return false;
    };
    let value = dom
        .attr(bold, Some(namespace), "val")
        .or_else(|| dom.attr(bold, None, "val"));
    !matches!(value, Some("0" | "false"))
}

fn ensure_run_bold(dom: &mut Dom, run: Id, namespace: &str) {
    let prefix = dom.prefix(run);
    let properties = match dom
        .element_children(run)
        .into_iter()
        .find(|child| dom.is_named(*child, namespace, "rPr"))
    {
        Some(properties) => properties,
        None => {
            let created = dom.create_element(Some(namespace), prefix.as_deref(), "rPr");
            dom.insert_before(run, created, dom.children(run).first().copied());
            created
        }
    };
    if let Some(existing) = dom
        .element_children(properties)
        .into_iter()
        .find(|child| dom.is_named(*child, namespace, "b"))
    {
        dom.remove_attr(existing, Some(namespace), "val");
        dom.remove_attr(existing, None, "val");
        return;
    }
    let bold = dom.create_element(Some(namespace), prefix.as_deref(), "b");
    let before = dom.element_children(properties).into_iter().find(|child| {
        dom.namespace(*child).as_deref() == Some(namespace)
            && dom
                .name(*child)
                .is_some_and(|(_, local)| RPR_AFTER_BOLD.contains(&local))
    });
    dom.insert_before(properties, bold, before);
}

fn clone_run_with_text(
    dom: &mut Dom,
    source_run: Id,
    source_text: Id,
    value: &str,
    bold: bool,
    namespace: &str,
) -> Id {
    let clone = dom.clone_shallow(source_run);
    if let Some(properties) = dom
        .element_children(source_run)
        .into_iter()
        .find(|child| dom.is_named(*child, namespace, "rPr"))
    {
        let copy = dom.clone_deep(properties);
        dom.insert_before(clone, copy, None);
    }
    let text_clone = dom.clone_shallow(source_text);
    dom.insert_before(clone, text_clone, None);
    if bold {
        ensure_run_bold(dom, clone, namespace);
    }
    write_word_text(dom, text_clone, value, namespace);
    clone
}

const XML_SPACE: (&str, &str) = ("http://www.w3.org/XML/1998/namespace", "space");

fn set_word_text_node(dom: &mut Dom, node: Id, text: &str) {
    dom.set_text_content(node, text);
    let needs_preserve =
        text.starts_with(char::is_whitespace) || text.ends_with(char::is_whitespace);
    if needs_preserve {
        dom.set_attr(
            node,
            Some(XML_SPACE.0),
            Some("xml"),
            XML_SPACE.1,
            "preserve",
        );
    } else {
        dom.remove_attr(node, Some(XML_SPACE.0), XML_SPACE.1);
    }
}

/// `writeWordText`: line breaks become `<w:br/>` followed by a copy of the text element.
fn write_word_text(dom: &mut Dom, node: Id, value: &str, namespace: &str) {
    let mut lines = value.split('\n');
    let first = lines.next().unwrap_or("");
    set_word_text_node(dom, node, first);
    let rest: Vec<&str> = lines.collect();
    if rest.is_empty() {
        return;
    }
    let Some(parent) = dom.parent(node) else {
        return;
    };
    let next = dom.next_sibling(node);
    let prefix = dom.prefix(node);
    for line in rest {
        let line_break = dom.create_element(Some(namespace), prefix.as_deref(), "br");
        dom.insert_before(parent, line_break, next);
        let continuation = dom.clone_shallow(node);
        set_word_text_node(dom, continuation, line);
        dom.insert_before(parent, continuation, next);
    }
}

/// `replaceInSegment`: applies edits right to left, splitting runs when a bold or dated value needs them.
pub(crate) fn replace_in_segment(
    dom: &mut Dom,
    segment: &Segment,
    edits: &[Edit],
    namespace: &str,
) {
    for edit in edits {
        let mut wrote_value = false;
        for text in &segment.nodes {
            if text.start >= edit.end || text.end <= edit.start {
                continue;
            }
            let current = dom.text_content(text.node);
            let prefix =
                current[..(edit.start.saturating_sub(text.start)).min(current.len())].to_owned();
            let suffix_from = (edit.end.min(text.end) - text.start).min(current.len());
            let suffix = current[suffix_from..].to_owned();
            let inserted = if wrote_value {
                String::new()
            } else {
                edit.value.clone()
            };
            let run = dom
                .parent(text.node)
                .filter(|parent| dom.local_is(*parent, "r"));
            let split_runs = if inserted.is_empty() {
                None
            } else {
                edit.runs
                    .clone()
                    .or_else(|| edit.bold.then(|| vec![text_run(&inserted, true)]))
            };
            match (split_runs, run) {
                (Some(parts), Some(run))
                    if !parts.is_empty()
                        && dom.parent(run).is_some()
                        && !is_run_bold(dom, run, namespace) =>
                {
                    let anchor = dom.next_sibling(run);
                    let parent_of_run = dom.parent(run).unwrap_or(run);
                    if prefix.is_empty() && suffix.is_empty() && parts.len() == 1 {
                        write_word_text(dom, text.node, &parts[0].text, namespace);
                        if parts[0].bold {
                            ensure_run_bold(dom, run, namespace);
                        }
                    } else if !prefix.is_empty() {
                        write_word_text(dom, text.node, &prefix, namespace);
                        for part in &parts {
                            let copy = clone_run_with_text(
                                dom, run, text.node, &part.text, part.bold, namespace,
                            );
                            dom.insert_before(parent_of_run, copy, anchor);
                        }
                        if !suffix.is_empty() {
                            let copy =
                                clone_run_with_text(dom, run, text.node, &suffix, false, namespace);
                            dom.insert_before(parent_of_run, copy, anchor);
                        }
                    } else {
                        let (first, rest) = parts.split_first().expect("non-empty parts");
                        write_word_text(dom, text.node, &first.text, namespace);
                        if first.bold {
                            ensure_run_bold(dom, run, namespace);
                        }
                        for part in rest {
                            let copy = clone_run_with_text(
                                dom, run, text.node, &part.text, part.bold, namespace,
                            );
                            dom.insert_before(parent_of_run, copy, anchor);
                        }
                        if !suffix.is_empty() {
                            let copy =
                                clone_run_with_text(dom, run, text.node, &suffix, false, namespace);
                            dom.insert_before(parent_of_run, copy, anchor);
                        }
                    }
                }
                _ => {
                    let combined = format!("{prefix}{inserted}{suffix}");
                    write_word_text(dom, text.node, &combined, namespace);
                }
            }
            wrote_value = true;
        }
    }
}
