//! Package repairs that `fillOriginalWord` runs on every output: `repairWordPackage` (malformed
//! properties of `word/*.xml` and `docProps/custom.xml`) and `removeEmptyExtendedProperties`
//! (`docProps/app.xml`). Mirrors `word-package-compatibility.ts` and `native-document.ts`.

use super::{Entry, dom::Dom};
use crate::error::ApiError;

const MARKUP_COMPATIBILITY_NS: &str = "http://schemas.openxmlformats.org/markup-compatibility/2006";
const CUSTOM_PROPERTIES_NS: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/custom-properties";
const EXTENDED_PROPERTIES_NS: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/extended-properties";
const CUSTOM_PROPERTIES_PART: &str = "docProps/custom.xml";
const EXTENDED_PROPERTIES_PART: &str = "docProps/app.xml";

/// Parts repaired by `repairWordPackage` (`wordParts` there, which includes `fontTable`).
fn repairable_word_part(name: &str) -> bool {
    let Some(stem) = name
        .strip_prefix("word/")
        .and_then(|part| part.strip_suffix(".xml"))
    else {
        return false;
    };
    matches!(stem, "document" | "footnotes" | "endnotes" | "fontTable")
        || ["header", "footer"].iter().any(|prefix| {
            stem.strip_prefix(prefix).is_some_and(|number| {
                !number.is_empty() && number.bytes().all(|byte| byte.is_ascii_digit())
            })
        })
}

/// `repairWordPackage`: repairs each part in place. Returns whether any part changed.
pub(crate) fn repair_word_package(entries: &mut [Entry]) -> bool {
    let mut changed = false;
    for entry in entries.iter_mut() {
        let is_custom = entry.name == CUSTOM_PROPERTIES_PART;
        if !is_custom && !repairable_word_part(&entry.name) {
            continue;
        }
        let Ok(xml) = std::str::from_utf8(&entry.bytes) else {
            continue;
        };
        let Ok(mut dom) = Dom::parse(xml) else {
            continue;
        };
        let namespace = dom.namespace(dom.root()).unwrap_or_default();
        let repaired = if is_custom {
            remove_empty_custom_properties(&mut dom)
        } else {
            is_word_namespace(&namespace) && repair_word_part(&mut dom, &namespace)
        };
        if repaired {
            entry.bytes = dom.serialize().into_bytes();
            changed = true;
        }
    }
    changed
}

fn is_word_namespace(namespace: &str) -> bool {
    matches!(
        namespace,
        "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
            | "http://purl.oclc.org/ooxml/wordprocessingml/main"
    )
}

fn remove_empty_custom_properties(dom: &mut Dom) -> bool {
    let mut changed = false;
    let root = dom.root();
    for property in dom.descendants_named(root, CUSTOM_PROPERTIES_NS, "property") {
        let empty = dom.attrs(property).is_empty()
            && dom.element_children(property).is_empty()
            && dom.text_content(property).trim().is_empty();
        if empty {
            dom.remove(property);
            changed = true;
        }
    }
    changed
}

/// `repairWordPart`: the malformed properties that older templates carry.
fn repair_word_part(dom: &mut Dom, namespace: &str) -> bool {
    let mut changed = false;
    let root = dom.root();

    for element in dom.all_elements(root) {
        if !dom.has_attr(element, MARKUP_COMPATIBILITY_NS, "Ignorable") {
            continue;
        }
        let value = dom
            .attr(element, Some(MARKUP_COMPATIBILITY_NS), "Ignorable")
            .unwrap_or("")
            .to_owned();
        let trimmed = value.trim();
        let prefixes: Vec<&str> = if trimmed.is_empty() {
            vec![""]
        } else {
            trimmed.split_whitespace().collect()
        };
        let defined: Vec<&str> = prefixes
            .iter()
            .copied()
            .filter(|prefix| dom.lookup_namespace(element, prefix).is_some())
            .collect();
        if defined.len() == prefixes.len() {
            continue;
        }
        if defined.is_empty() {
            dom.remove_attr(element, Some(MARKUP_COMPATIBILITY_NS), "Ignorable");
        } else {
            dom.set_attr_value(
                element,
                MARKUP_COMPATIBILITY_NS,
                "Ignorable",
                &defined.join(" "),
            );
        }
        changed = true;
    }

    for run_properties in dom.descendants_named(root, namespace, "rPr") {
        let children = child_named_any(dom, run_properties, namespace);
        let first_formatting = children
            .iter()
            .copied()
            .find(|child| !dom.local_is(*child, "rStyle"));
        let fonts = children
            .iter()
            .copied()
            .find(|child| dom.local_is(*child, "rFonts"));
        if let (Some(fonts), Some(first_formatting)) = (fonts, first_formatting)
            && fonts != first_formatting
        {
            dom.insert_before(run_properties, fonts, Some(first_formatting));
            changed = true;
        }

        let mut seen: Vec<(String, super::dom::Id)> = Vec::new();
        let properties: Vec<super::dom::Id> = children
            .iter()
            .copied()
            .filter(|child| dom.local_is(*child, "b") || dom.local_is(*child, "i"))
            .collect();
        for property in properties {
            let local = dom
                .name(property)
                .map(|(_, local)| local.to_owned())
                .unwrap_or_default();
            let preceding = seen
                .iter()
                .find(|(name, _)| *name == local)
                .map(|(_, id)| *id);
            match preceding {
                Some(preceding) if dom.is_equal_node(preceding, property) => {
                    dom.remove(property);
                    changed = true;
                }
                _ => {
                    seen.retain(|(name, _)| *name != local);
                    seen.push((local, property));
                }
            }
        }
    }

    for paragraph_properties in dom.descendants_named(root, namespace, "pPr") {
        let children = child_named_any(dom, paragraph_properties, namespace);
        let after_spacing = children.iter().copied().find(|child| {
            [
                "ind",
                "contextualSpacing",
                "mirrorIndents",
                "suppressOverlap",
                "jc",
            ]
            .iter()
            .any(|local| dom.local_is(*child, local))
        });
        let spacing = children
            .iter()
            .copied()
            .find(|child| dom.local_is(*child, "spacing"));
        let (Some(spacing), Some(after_spacing)) = (spacing, after_spacing) else {
            continue;
        };
        let spacing_index = children.iter().position(|child| *child == spacing);
        let after_index = children.iter().position(|child| *child == after_spacing);
        if spacing_index > after_index {
            dom.insert_before(paragraph_properties, spacing, Some(after_spacing));
            changed = true;
        }
    }

    for charset in dom.descendants_named(root, namespace, "charset") {
        let value = dom.attr(charset, Some(namespace), "val").map(str::to_owned);
        let character_set = dom
            .attr(charset, Some(namespace), "characterSet")
            .map(str::to_owned);
        let hex_value = value.as_deref().is_some_and(|value| {
            value.len() == 2 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
        });
        let known_set = character_set.as_deref().is_some_and(|set| {
            set.eq_ignore_ascii_case("utf-8") || set.eq_ignore_ascii_case("windows-1252")
        });
        if hex_value && known_set {
            dom.remove_attr(charset, Some(namespace), "characterSet");
            changed = true;
        }
    }
    changed
}

/// Element children in the word namespace (`Array.from(parent.children).filter(...)`).
fn child_named_any(dom: &Dom, parent: super::dom::Id, namespace: &str) -> Vec<super::dom::Id> {
    dom.element_children(parent)
        .into_iter()
        .filter(|child| dom.namespace(*child).as_deref() == Some(namespace))
        .collect()
}

/// `removeEmptyExtendedProperties`: drops empty `HeadingPairs` and `TitlesOfParts` from `docProps/app.xml`.
pub(crate) fn remove_empty_extended_properties(entries: &mut [Entry]) -> Result<bool, ApiError> {
    let Some(entry) = entries
        .iter_mut()
        .find(|entry| entry.name == EXTENDED_PROPERTIES_PART)
    else {
        return Ok(false);
    };
    let xml = std::str::from_utf8(&entry.bytes).map_err(|_| ApiError::InvalidDocxTemplate)?;
    if xml.to_ascii_uppercase().contains("<!DOCTYPE")
        || xml.to_ascii_uppercase().contains("<!ENTITY")
    {
        return Err(ApiError::InvalidDocxTemplate);
    }
    let mut dom = Dom::parse(xml).map_err(|_| ApiError::InvalidDocxTemplate)?;
    let root = dom.root();
    let empty: Vec<super::dom::Id> = dom
        .element_children(root)
        .into_iter()
        .filter(|property| {
            dom.namespace(*property).as_deref() == Some(EXTENDED_PROPERTIES_NS)
                && (dom.local_is(*property, "HeadingPairs")
                    || dom.local_is(*property, "TitlesOfParts"))
                && dom.element_children(*property).is_empty()
                && dom.text_content(*property).trim().is_empty()
        })
        .collect();
    if empty.is_empty() {
        return Ok(false);
    }
    for property in empty {
        dom.remove(property);
    }
    entry.bytes = dom.serialize().into_bytes();
    Ok(true)
}
