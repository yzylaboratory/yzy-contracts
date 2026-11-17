use std::{
    collections::{HashMap, HashSet},
    io::{Cursor, Read},
};

use roxmltree::{Document, Node, ParsingOptions};
use zip::{CompressionMethod, ZipArchive};

use crate::{error::ApiError, modules::templates::NativeVariable};

const MAX_ENTRIES: usize = 4096;
const MAX_EXPANDED_BYTES: u64 = 64 * 1024 * 1024;
const MAX_XML_BYTES: u64 = 8 * 1024 * 1024;
const MAX_XML_DEPTH: usize = 128;
const MAX_VARIABLES: usize = 100;
const MAX_OCCURRENCES: usize = 1000;

const WORD_NAMESPACES: [&str; 2] = [
    "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
    "http://purl.oclc.org/ooxml/wordprocessingml/main",
];

pub(crate) fn read_variables(bytes: &[u8]) -> Result<Vec<NativeVariable>, ApiError> {
    let invalid = |_| ApiError::InvalidDocxTemplate;
    let mut archive = ZipArchive::new(Cursor::new(bytes)).map_err(invalid)?;
    if archive.len() > MAX_ENTRIES {
        return Err(ApiError::InvalidDocxTemplate);
    }
    archive.validate_header_consistency().map_err(invalid)?;

    let mut names = HashSet::new();
    let mut expanded_bytes = 0;
    let mut variables: Vec<NativeVariable> = Vec::new();
    let mut indices: HashMap<String, usize> = HashMap::new();
    let mut occurrences = 0;

    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).map_err(invalid)?;
        let name = entry.name().map_err(invalid)?.into_owned();
        let is_word_part = word_part(&name);
        expanded_bytes += entry.size().min(MAX_EXPANDED_BYTES + 1);
        if expanded_bytes > MAX_EXPANDED_BYTES
            || !matches!(
                entry.compression(),
                CompressionMethod::Stored | CompressionMethod::Deflated
            )
            || name.starts_with('/')
            || name.contains(['\\', '\0'])
            || name.to_ascii_lowercase().starts_with("_xmlsignatures/")
            || name
                .split('/')
                .any(|part| matches!(part, ".." | "__proto__" | "constructor" | "prototype"))
            || !names.insert(name)
        {
            return Err(ApiError::InvalidDocxTemplate);
        }
        if !is_word_part {
            continue;
        }
        if entry.size() > MAX_XML_BYTES {
            return Err(ApiError::InvalidDocxTemplate);
        }
        let mut xml = String::new();
        entry
            .by_ref()
            .take(MAX_XML_BYTES + 1)
            .read_to_string(&mut xml)
            .map_err(|_| ApiError::InvalidDocxTemplate)?;
        if xml.len() as u64 != entry.size() || xml.len() as u64 > MAX_XML_BYTES {
            return Err(ApiError::InvalidDocxTemplate);
        }
        read_part(&xml, |key| {
            occurrences += 1;
            if occurrences > MAX_OCCURRENCES {
                return Err(ApiError::InvalidDocxVariables);
            }
            if let Some(&position) = indices.get(key) {
                variables[position].occurrences += 1;
            } else {
                if variables.len() == MAX_VARIABLES {
                    return Err(ApiError::InvalidDocxVariables);
                }
                indices.insert(key.to_owned(), variables.len());
                variables.push(NativeVariable {
                    key: key.to_owned(),
                    occurrences: 1,
                });
            }
            Ok(())
        })?;
    }

    if !names.contains("[Content_Types].xml") || !names.contains("word/document.xml") {
        return Err(ApiError::InvalidDocxTemplate);
    }
    if variables.is_empty() {
        return Err(ApiError::DocxVariablesRequired);
    }
    Ok(variables)
}

fn word_part(name: &str) -> bool {
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

fn protected(name: &str) -> bool {
    matches!(
        name,
        "del"
            | "ins"
            | "moveFrom"
            | "moveTo"
            | "fldSimple"
            | "hyperlink"
            | "sdt"
            | "AlternateContent"
    )
}

fn barrier(name: &str) -> bool {
    protected(name)
        || matches!(
            name,
            "instrText"
                | "drawing"
                | "object"
                | "pict"
                | "tab"
                | "br"
                | "cr"
                | "sym"
                | "noBreakHyphen"
                | "softHyphen"
                | "footnoteReference"
                | "endnoteReference"
                | "commentReference"
        )
}

fn read_part(
    xml: &str,
    mut on_key: impl FnMut(&str) -> Result<(), ApiError>,
) -> Result<(), ApiError> {
    // No DTD, external entities, or unbounded XML node allocation.
    let doc = Document::parse_with_options(
        xml,
        ParsingOptions {
            nodes_limit: 300_000,
            ..ParsingOptions::default()
        },
    )
    .map_err(|_| ApiError::InvalidDocxTemplate)?;
    let namespace = doc
        .root_element()
        .tag_name()
        .namespace()
        .filter(|name| WORD_NAMESPACES.contains(name))
        .ok_or(ApiError::InvalidDocxTemplate)?;

    for paragraph in doc
        .descendants()
        .filter(|node| node.has_tag_name((namespace, "p")))
    {
        let mut editable = true;
        for (depth, ancestor) in paragraph.ancestors().skip(1).enumerate() {
            if depth == MAX_XML_DEPTH {
                return Err(ApiError::InvalidDocxTemplate);
            }
            if ancestor.is_element() && protected(ancestor.tag_name().name()) {
                editable = false;
            }
        }
        let mut text = ParagraphText::default();
        for child in paragraph.children().filter(Node::is_element) {
            text.visit(child, namespace, editable, 0)?;
        }
        text.flush();

        // Whole-paragraph text includes protected runs. Comparing it to the
        // editable segments prevents silently ignoring markers in those runs,
        // or markers spanning a tab, a line break, or a field boundary.
        let full_keys = marker_keys(&text.full)?;
        let mut editable_keys = Vec::new();
        for segment in &text.segments {
            editable_keys.extend(marker_keys(segment)?);
        }
        if full_keys != editable_keys {
            return Err(ApiError::InvalidDocxVariables);
        }
        for key in editable_keys {
            on_key(key)?;
        }
    }
    Ok(())
}

#[derive(Default)]
struct ParagraphText {
    full: String,
    current: String,
    segments: Vec<String>,
    field_depth: usize,
}

impl ParagraphText {
    fn flush(&mut self) {
        if !self.current.is_empty() {
            self.segments.push(std::mem::take(&mut self.current));
        }
    }

    fn visit(
        &mut self,
        node: Node<'_, '_>,
        namespace: &str,
        editable: bool,
        depth: usize,
    ) -> Result<(), ApiError> {
        if depth == MAX_XML_DEPTH {
            return Err(ApiError::InvalidDocxTemplate);
        }
        let tag = node.tag_name();
        let name = tag.name();
        let in_word = tag.namespace() == Some(namespace);
        if name == "p" {
            if editable {
                self.flush();
            }
            return Ok(());
        }
        if in_word && matches!(name, "t" | "delText" | "instrText") {
            // Word stores run text in one text node; multiple XML character-data
            // nodes can be merged by the browser and are also joined here.
            for value in node
                .children()
                .filter_map(|child| child.text().filter(|_| child.is_text()))
            {
                self.full.push_str(value);
                if editable && name == "t" && self.field_depth == 0 {
                    self.current.push_str(value);
                }
            }
            if editable && name == "instrText" {
                self.flush();
            }
            return Ok(());
        }
        if editable && in_word && name == "fldChar" {
            match node.attribute((namespace, "fldCharType")) {
                Some("begin") => self.field_depth += 1,
                Some("end") => self.field_depth = self.field_depth.saturating_sub(1),
                _ => {}
            }
            self.flush();
            return Ok(());
        }
        let child_editable = editable && !barrier(name);
        if editable && !child_editable {
            self.flush();
        }
        for child in node.children().filter(Node::is_element) {
            self.visit(child, namespace, child_editable, depth + 1)?;
        }
        Ok(())
    }
}

fn marker_keys(mut text: &str) -> Result<Vec<&str>, ApiError> {
    let mut keys = Vec::new();
    loop {
        let open = text.find("{{");
        let close = text.find("}}");
        match (open, close) {
            (None, None) => return Ok(keys),
            (Some(start), Some(end)) if start < end => {
                let key = text
                    .get(start + 2..end)
                    .ok_or(ApiError::InvalidDocxVariables)?;
                let mut bytes = key.bytes();
                if key.len() > 64
                    || !bytes.next().is_some_and(|byte| byte.is_ascii_lowercase())
                    || !bytes.all(|byte| {
                        byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_'
                    })
                    || keys.len() == MAX_OCCURRENCES
                {
                    return Err(ApiError::InvalidDocxVariables);
                }
                keys.push(key);
                text = &text[end + 2..];
            }
            _ => return Err(ApiError::InvalidDocxVariables),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use zip::{ZipWriter, write::SimpleFileOptions};

    fn package(parts: &[(&str, &str)]) -> Vec<u8> {
        let mut zip = ZipWriter::new(Cursor::new(Vec::new()));
        for (name, xml) in
            std::iter::once(("[Content_Types].xml", "<Types/>")).chain(parts.iter().copied())
        {
            zip.start_file(name, SimpleFileOptions::default())
                .expect("entry");
            zip.write_all(xml.as_bytes()).expect("xml");
        }
        zip.finish().expect("zip").into_inner()
    }

    fn document(content: &str) -> String {
        format!(
            "<w:document xmlns:w=\"{}\"><w:body>{content}</w:body></w:document>",
            WORD_NAMESPACES[0]
        )
    }

    #[test]
    fn variables_span_runs_and_group_across_tables_and_headers() {
        let body = document(
            "<w:p><w:r><w:t>{{cliente_</w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>nombre}}</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>{{constructor}} {{cliente_nombre}}</w:t></w:r></w:p></w:tc></w:tr></w:tbl>",
        );
        let header = format!(
            "<w:hdr xmlns:w=\"{}\"><w:p><w:r><w:t>{{{{cliente_nombre}}}}</w:t></w:r></w:p></w:hdr>",
            WORD_NAMESPACES[0]
        );
        let fields = read_variables(&package(&[
            ("word/document.xml", &body),
            ("word/header1.xml", &header),
        ]))
        .expect("variables");
        assert_eq!(
            fields,
            vec![
                NativeVariable {
                    key: "cliente_nombre".into(),
                    occurrences: 3
                },
                NativeVariable {
                    key: "constructor".into(),
                    occurrences: 1
                }
            ]
        );
    }

    #[test]
    fn malformed_or_protected_markers_are_rejected() {
        for content in [
            "<w:p><w:r><w:t>{{Nombre}}</w:t></w:r></w:p>",
            "<w:p><w:r><w:t>{{nombre</w:t></w:r></w:p>",
            "<w:p><w:r><w:t>nombre}}</w:t></w:r></w:p>",
            "<w:p><w:r><w:t>{{a b}}</w:t></w:r></w:p>",
            "<w:p><w:r><w:t>{{nombre</w:t><w:br/><w:t>}}</w:t></w:r></w:p>",
            "<w:p><w:hyperlink><w:r><w:t>{{nombre}}</w:t></w:r></w:hyperlink></w:p>",
            "<w:sdt><w:sdtContent><w:p><w:r><w:t>{{nombre}}</w:t></w:r></w:p></w:sdtContent></w:sdt>",
            "<w:p><w:r><w:fldChar w:fldCharType=\"begin\"/></w:r><w:r><w:t>{{nombre}}</w:t></w:r><w:r><w:fldChar w:fldCharType=\"end\"/></w:r></w:p>",
        ] {
            let body = document(content);
            assert!(
                matches!(
                    read_variables(&package(&[("word/document.xml", &body)])),
                    Err(ApiError::InvalidDocxVariables)
                ),
                "{content}"
            );
        }
    }

    #[test]
    fn missing_variables_and_damaged_word_are_distinct_errors() {
        assert!(matches!(
            read_variables(b"PK\x03\x04x"),
            Err(ApiError::InvalidDocxTemplate)
        ));
        let body = document("<w:p><w:r><w:t>Contrato de ejemplo</w:t></w:r></w:p>");
        assert!(matches!(
            read_variables(&package(&[("word/document.xml", &body)])),
            Err(ApiError::DocxVariablesRequired)
        ));
    }

    #[test]
    fn required_parts_and_xml_entities_are_validated() {
        assert!(matches!(
            read_variables(&package(&[("word/styles.xml", "<styles/>")])),
            Err(ApiError::InvalidDocxTemplate)
        ));
        let entity = format!(
            "<!DOCTYPE x [<!ENTITY variable \"{{{{nombre}}}}\">]><w:document xmlns:w=\"{}\"><w:body><w:p><w:r><w:t>&variable;</w:t></w:r></w:p></w:body></w:document>",
            WORD_NAMESPACES[0]
        );
        assert!(matches!(
            read_variables(&package(&[("word/document.xml", &entity)])),
            Err(ApiError::InvalidDocxTemplate)
        ));
    }
}
