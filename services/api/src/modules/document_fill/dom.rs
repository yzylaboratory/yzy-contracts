//! Minimal mutable XML tree for WordprocessingML parts.
//!
//! Nodes live in an arena and are addressed by `Id`, so inserting or cloning
//! siblings never invalidates the ids held by other pending edits. That mirrors
//! the DOM operations of `native-document.ts` (`insertBefore`, `cloneNode`).

use roxmltree::{Node as XmlNode, NodeType, ParsingOptions};

pub(crate) type Id = usize;

pub(crate) const XML_NAMESPACE: &str = "http://www.w3.org/XML/1998/namespace";
pub(crate) const XMLNS_NAMESPACE: &str = "http://www.w3.org/2000/xmlns/";

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Attr {
    pub ns: Option<String>,
    pub prefix: Option<String>,
    pub local: String,
    pub value: String,
}

#[derive(Clone, Debug)]
pub(crate) enum Kind {
    Element {
        ns: Option<String>,
        prefix: Option<String>,
        local: String,
        attrs: Vec<Attr>,
    },
    Text(String),
    /// Comments and processing instructions, kept verbatim.
    Raw(String),
}

#[derive(Clone, Debug)]
pub(crate) struct Node {
    pub parent: Option<Id>,
    pub kind: Kind,
    pub children: Vec<Id>,
}

#[derive(Debug)]
pub(crate) struct Dom {
    nodes: Vec<Node>,
    root: Id,
    /// Source text before the root element (XML declaration, whitespace).
    head: String,
}

#[derive(Debug, thiserror::Error)]
#[error("malformed XML part")]
pub(crate) struct ParseError;

impl Dom {
    pub(crate) fn parse(xml: &str) -> Result<Self, ParseError> {
        let options = ParsingOptions {
            allow_dtd: false,
            ..ParsingOptions::default()
        };
        let document =
            roxmltree::Document::parse_with_options(xml, options).map_err(|_| ParseError)?;
        let root_element = document.root_element();
        let mut dom = Dom {
            nodes: Vec::new(),
            root: 0,
            head: xml[..root_element.range().start].to_owned(),
        };
        dom.root = dom.import(root_element, xml, None);
        Ok(dom)
    }

    fn import(&mut self, source: XmlNode<'_, '_>, xml: &str, parent: Option<Id>) -> Id {
        let kind = match source.node_type() {
            NodeType::Element => {
                let tag = source.tag_name();
                let ns = tag.namespace().map(str::to_owned);
                let prefix = ns
                    .as_deref()
                    .and_then(|uri| prefix_for(&source, uri))
                    .map(str::to_owned);
                let inherited: Vec<(Option<&str>, &str)> = source
                    .parent_element()
                    .map(|parent| {
                        parent
                            .namespaces()
                            .map(|ns| (ns.name(), ns.uri()))
                            .collect()
                    })
                    .unwrap_or_default();
                let mut attrs: Vec<Attr> = source
                    .namespaces()
                    .filter(|declaration| {
                        !inherited.contains(&(declaration.name(), declaration.uri()))
                    })
                    .map(|declaration| Attr {
                        ns: Some(XMLNS_NAMESPACE.to_owned()),
                        prefix: declaration.name().map(|_| "xmlns".to_owned()),
                        local: declaration.name().unwrap_or("xmlns").to_owned(),
                        value: declaration.uri().to_owned(),
                    })
                    .collect();
                for attribute in source.attributes() {
                    let attr_ns = attribute.namespace().map(str::to_owned);
                    let attr_prefix = match attr_ns.as_deref() {
                        Some(XML_NAMESPACE) => Some("xml".to_owned()),
                        Some(uri) => prefix_for(&source, uri).map(str::to_owned),
                        None => None,
                    };
                    attrs.push(Attr {
                        ns: attr_ns,
                        prefix: attr_prefix,
                        local: attribute.name().to_owned(),
                        value: attribute.value().to_owned(),
                    });
                }
                Kind::Element {
                    ns,
                    prefix,
                    local: tag.name().to_owned(),
                    attrs,
                }
            }
            NodeType::Text => Kind::Text(source.text().unwrap_or_default().to_owned()),
            _ => Kind::Raw(xml[source.range()].to_owned()),
        };
        let id = self.nodes.len();
        self.nodes.push(Node {
            parent,
            kind,
            children: Vec::new(),
        });
        let children: Vec<Id> = source
            .children()
            .filter(|child| !matches!(child.node_type(), NodeType::Root))
            .map(|child| self.import(child, xml, Some(id)))
            .collect();
        self.nodes[id].children = children;
        id
    }

    pub(crate) fn root(&self) -> Id {
        self.root
    }

    pub(crate) fn parent(&self, id: Id) -> Option<Id> {
        self.nodes[id].parent
    }

    pub(crate) fn children(&self, id: Id) -> Vec<Id> {
        self.nodes[id].children.clone()
    }

    pub(crate) fn element_children(&self, id: Id) -> Vec<Id> {
        self.nodes[id]
            .children
            .iter()
            .copied()
            .filter(|child| self.is_element(*child))
            .collect()
    }

    pub(crate) fn is_element(&self, id: Id) -> bool {
        matches!(self.nodes[id].kind, Kind::Element { .. })
    }

    /// `(namespace, local name)` of an element.
    pub(crate) fn name(&self, id: Id) -> Option<(Option<&str>, &str)> {
        match &self.nodes[id].kind {
            Kind::Element { ns, local, .. } => Some((ns.as_deref(), local.as_str())),
            _ => None,
        }
    }

    pub(crate) fn is_named(&self, id: Id, ns: &str, local: &str) -> bool {
        self.name(id) == Some((Some(ns), local))
    }

    pub(crate) fn local_is(&self, id: Id, local: &str) -> bool {
        self.name(id).is_some_and(|(_, name)| name == local)
    }

    pub(crate) fn prefix(&self, id: Id) -> Option<String> {
        match &self.nodes[id].kind {
            Kind::Element { prefix, .. } => prefix.clone(),
            _ => None,
        }
    }

    pub(crate) fn namespace(&self, id: Id) -> Option<String> {
        match &self.nodes[id].kind {
            Kind::Element { ns, .. } => ns.clone(),
            _ => None,
        }
    }

    pub(crate) fn attrs(&self, id: Id) -> &[Attr] {
        match &self.nodes[id].kind {
            Kind::Element { attrs, .. } => attrs,
            _ => &[],
        }
    }

    /// Attribute value looked up by namespace and local name; `None` namespace matches unqualified attributes.
    pub(crate) fn attr(&self, id: Id, ns: Option<&str>, local: &str) -> Option<&str> {
        self.attrs(id)
            .iter()
            .find(|attr| attr.local == local && attr.ns.as_deref() == ns)
            .map(|attr| attr.value.as_str())
    }

    pub(crate) fn set_attr(
        &mut self,
        id: Id,
        ns: Option<&str>,
        prefix: Option<&str>,
        local: &str,
        value: &str,
    ) {
        if let Kind::Element { attrs, .. } = &mut self.nodes[id].kind {
            match attrs
                .iter_mut()
                .find(|attr| attr.local == local && attr.ns.as_deref() == ns)
            {
                Some(attr) => attr.value = value.to_owned(),
                None => attrs.push(Attr {
                    ns: ns.map(str::to_owned),
                    prefix: prefix.map(str::to_owned),
                    local: local.to_owned(),
                    value: value.to_owned(),
                }),
            }
        }
    }

    pub(crate) fn remove_attr(&mut self, id: Id, ns: Option<&str>, local: &str) {
        if let Kind::Element { attrs, .. } = &mut self.nodes[id].kind {
            attrs.retain(|attr| !(attr.local == local && attr.ns.as_deref() == ns));
        }
    }

    /// Concatenated text of all descendants, like DOM `textContent`.
    pub(crate) fn text_content(&self, id: Id) -> String {
        let mut out = String::new();
        self.collect_text(id, &mut out);
        out
    }

    fn collect_text(&self, id: Id, out: &mut String) {
        match &self.nodes[id].kind {
            Kind::Text(text) => out.push_str(text),
            Kind::Element { .. } => {
                for child in &self.nodes[id].children {
                    self.collect_text(*child, out);
                }
            }
            Kind::Raw(_) => {}
        }
    }

    pub(crate) fn set_text_content(&mut self, id: Id, text: &str) {
        for child in std::mem::take(&mut self.nodes[id].children) {
            self.nodes[child].parent = None;
        }
        let text_id = self.push(Kind::Text(text.to_owned()), Some(id));
        self.nodes[id].children.push(text_id);
    }

    pub(crate) fn create_element(
        &mut self,
        ns: Option<&str>,
        prefix: Option<&str>,
        local: &str,
    ) -> Id {
        self.push(
            Kind::Element {
                ns: ns.map(str::to_owned),
                prefix: prefix.map(str::to_owned),
                local: local.to_owned(),
                attrs: Vec::new(),
            },
            None,
        )
    }

    fn push(&mut self, kind: Kind, parent: Option<Id>) -> Id {
        self.nodes.push(Node {
            parent,
            kind,
            children: Vec::new(),
        });
        self.nodes.len() - 1
    }

    /// Copies an element without its children (`cloneNode(false)`).
    pub(crate) fn clone_shallow(&mut self, id: Id) -> Id {
        let kind = self.nodes[id].kind.clone();
        self.push(kind, None)
    }

    /// Copies an element and its descendants (`cloneNode(true)`).
    pub(crate) fn clone_deep(&mut self, id: Id) -> Id {
        let copy = self.clone_shallow(id);
        for child in self.children(id) {
            let child_copy = self.clone_deep(child);
            self.append(copy, child_copy);
        }
        copy
    }

    /// Inserts `child` before `reference`, or appends when `reference` is `None`.
    pub(crate) fn insert_before(&mut self, parent: Id, child: Id, reference: Option<Id>) {
        if let Some(old) = self.nodes[child].parent {
            self.nodes[old]
                .children
                .retain(|candidate| *candidate != child);
        }
        self.nodes[child].parent = Some(parent);
        let position = match reference {
            Some(reference) => self.nodes[parent]
                .children
                .iter()
                .position(|candidate| *candidate == reference)
                .unwrap_or(self.nodes[parent].children.len()),
            None => self.nodes[parent].children.len(),
        };
        self.nodes[parent].children.insert(position, child);
    }

    pub(crate) fn next_sibling(&self, id: Id) -> Option<Id> {
        let parent = self.nodes[id].parent?;
        let siblings = &self.nodes[parent].children;
        let position = siblings.iter().position(|candidate| *candidate == id)?;
        siblings.get(position + 1).copied()
    }

    /// Detaches `id` from its parent (`node.remove()`).
    pub(crate) fn remove(&mut self, id: Id) {
        if let Some(parent) = self.nodes[id].parent.take() {
            self.nodes[parent].children.retain(|child| *child != id);
        }
    }

    /// Replaces `old` with `new` in place (`node.replaceWith()`); no-op when `old` is detached.
    pub(crate) fn replace_with(&mut self, old: Id, new: Id) {
        let Some(parent) = self.nodes[old].parent else {
            return;
        };
        self.insert_before(parent, new, Some(old));
        self.remove(old);
    }

    /// Inserts `child` as the first child of `parent` (`node.prepend()`).
    pub(crate) fn prepend(&mut self, parent: Id, child: Id) {
        let first = self.nodes[parent].children.first().copied();
        self.insert_before(parent, child, first);
    }

    /// Appends `child` as the last child of `parent` (`node.append()`).
    pub(crate) fn append(&mut self, parent: Id, child: Id) {
        self.insert_before(parent, child, None);
    }

    pub(crate) fn previous_element_sibling(&self, id: Id) -> Option<Id> {
        let parent = self.nodes[id].parent?;
        let siblings = &self.nodes[parent].children;
        let position = siblings.iter().position(|candidate| *candidate == id)?;
        siblings[..position]
            .iter()
            .rev()
            .find(|candidate| self.is_element(**candidate))
            .copied()
    }

    pub(crate) fn next_element_sibling(&self, id: Id) -> Option<Id> {
        let parent = self.nodes[id].parent?;
        let siblings = &self.nodes[parent].children;
        let position = siblings.iter().position(|candidate| *candidate == id)?;
        siblings[position + 1..]
            .iter()
            .find(|candidate| self.is_element(**candidate))
            .copied()
    }

    /// Descendant elements named `{ns}local` in document order, excluding `root` (`element.getElementsByTagNameNS`).
    pub(crate) fn descendants_named(&self, root: Id, ns: &str, local: &str) -> Vec<Id> {
        let mut found = Vec::new();
        self.collect_named(root, ns, local, &mut found);
        found
    }

    fn collect_named(&self, id: Id, ns: &str, local: &str, found: &mut Vec<Id>) {
        for child in self.element_children(id) {
            if self.is_named(child, ns, local) {
                found.push(child);
            }
            self.collect_named(child, ns, local, found);
        }
    }

    /// Every element of the tree, `root` included, in document order (`getElementsByTagName("*")`).
    pub(crate) fn all_elements(&self, root: Id) -> Vec<Id> {
        let mut found = vec![root];
        let mut stack = self.element_children(root);
        stack.reverse();
        while let Some(element) = stack.pop() {
            found.push(element);
            let mut children = self.element_children(element);
            children.reverse();
            stack.extend(children);
        }
        found
    }

    /// Nearest self-or-ancestor element with the local name `local` (`element.closest`).
    pub(crate) fn closest_local(&self, id: Id, local: &str) -> Option<Id> {
        std::iter::successors(Some(id), |current| self.parent(*current))
            .find(|current| self.local_is(*current, local))
    }

    /// `lookupNamespaceURI(prefix)`: the namespace bound to `prefix` on the element or an ancestor.
    pub(crate) fn lookup_namespace(&self, id: Id, prefix: &str) -> Option<String> {
        std::iter::successors(Some(id), |current| self.parent(*current)).find_map(|current| {
            self.attrs(current).iter().find_map(|attr| {
                if attr.ns.as_deref() != Some(XMLNS_NAMESPACE) {
                    return None;
                }
                let declared = if attr.local == "xmlns" {
                    ""
                } else {
                    attr.local.as_str()
                };
                (declared == prefix && !attr.value.is_empty()).then(|| attr.value.clone())
            })
        })
    }

    /// `isEqualNode`: same kind, name, namespace, attributes and children, recursively.
    pub(crate) fn is_equal_node(&self, left: Id, right: Id) -> bool {
        let (Kind::Element { .. }, Kind::Element { .. }) =
            (&self.nodes[left].kind, &self.nodes[right].kind)
        else {
            return match (&self.nodes[left].kind, &self.nodes[right].kind) {
                (Kind::Text(a), Kind::Text(b)) => a == b,
                (Kind::Raw(a), Kind::Raw(b)) => a == b,
                _ => false,
            };
        };
        if self.namespace(left) != self.namespace(right)
            || self.name(left) != self.name(right)
            || self.prefix(left) != self.prefix(right)
        {
            return false;
        }
        let (a, b) = (self.attrs(left), self.attrs(right));
        if a.len() != b.len() || !a.iter().all(|attr| b.contains(attr)) {
            return false;
        }
        let (ca, cb) = (self.children(left), self.children(right));
        ca.len() == cb.len()
            && ca
                .iter()
                .zip(cb.iter())
                .all(|(x, y)| self.is_equal_node(*x, *y))
    }

    /// `setAttributeNS` on an existing or new attribute, keeping the prefix already on the attribute.
    pub(crate) fn set_attr_value(&mut self, id: Id, ns: &str, local: &str, value: &str) {
        if let Kind::Element { attrs, .. } = &mut self.nodes[id].kind
            && let Some(attr) = attrs
                .iter_mut()
                .find(|attr| attr.local == local && attr.ns.as_deref() == Some(ns))
        {
            attr.value = value.to_owned();
        }
    }

    /// Has the element an attribute with this namespace and local name (`getAttributeNodeNS` is not null).
    pub(crate) fn has_attr(&self, id: Id, ns: &str, local: &str) -> bool {
        self.attrs(id)
            .iter()
            .any(|attr| attr.local == local && attr.ns.as_deref() == Some(ns))
    }

    pub(crate) fn serialize(&self) -> String {
        let mut out = self.head.clone();
        self.write(self.root, &mut out);
        out
    }

    fn write(&self, id: Id, out: &mut String) {
        let node = &self.nodes[id];
        match &node.kind {
            Kind::Text(text) => out.push_str(&escape_text(text)),
            Kind::Raw(raw) => out.push_str(raw),
            Kind::Element {
                prefix,
                local,
                attrs,
                ..
            } => {
                let name = qualified(prefix.as_deref(), local);
                out.push('<');
                out.push_str(&name);
                for attr in attrs {
                    out.push(' ');
                    out.push_str(&qualified(attr.prefix.as_deref(), &attr.local));
                    out.push_str("=\"");
                    out.push_str(&escape_attr(&attr.value));
                    out.push('"');
                }
                if node.children.is_empty() {
                    out.push_str("/>");
                } else {
                    out.push('>');
                    for child in &node.children {
                        self.write(*child, out);
                    }
                    out.push_str("</");
                    out.push_str(&name);
                    out.push('>');
                }
            }
        }
    }
}

fn prefix_for<'a>(node: &XmlNode<'a, '_>, uri: &str) -> Option<&'a str> {
    node.lookup_prefix(uri).filter(|prefix| !prefix.is_empty())
}

fn qualified(prefix: Option<&str>, local: &str) -> String {
    match prefix {
        Some(prefix) => format!("{prefix}:{local}"),
        None => local.to_owned(),
    }
}

fn escape_text(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

fn escape_attr(value: &str) -> String {
    escape_text(value)
        .replace('"', "&quot;")
        .replace('\n', "&#10;")
        .replace('\r', "&#13;")
        .replace('\t', "&#9;")
}
