const wordParts = /^word\/(?:document|header\d+|footer\d+|footnotes|endnotes|fontTable)\.xml$/;
const wordNamespaces = [
  "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
  "http://purl.oclc.org/ooxml/wordprocessingml/main",
];
const customProperties = "http://schemas.openxmlformats.org/officeDocument/2006/custom-properties";
const markupCompatibility = "http://schemas.openxmlformats.org/markup-compatibility/2006";

function removeEmptyCustomProperties(doc: Document) {
  let changed = false;
  for (const property of Array.from(doc.getElementsByTagNameNS(customProperties, "property"))) {
    if (!property.attributes.length && !property.children.length && !property.textContent?.trim()) {
      property.remove();
      changed = true;
    }
  }
  return changed;
}

function repairWordPart(doc: Document, namespace: string) {
  let changed = false;
  for (const element of Array.from(doc.getElementsByTagName("*"))) {
    const ignorable = element.getAttributeNodeNS(markupCompatibility, "Ignorable");
    if (!ignorable) continue;
    const prefixes = ignorable.value.trim().split(/\s+/);
    const defined = prefixes.filter(prefix => element.lookupNamespaceURI(prefix));
    if (defined.length === prefixes.length) continue;
    if (defined.length) ignorable.value = defined.join(" ");
    else element.removeAttributeNode(ignorable);
    changed = true;
  }

  for (const run of Array.from(doc.getElementsByTagNameNS(namespace, "rPr"))) {
    const children = Array.from(run.children).filter(child => child.namespaceURI === namespace);
    const firstFormatting = children.find(child => child.localName !== "rStyle");
    const fonts = children.find(child => child.localName === "rFonts");
    if (fonts && firstFormatting && fonts !== firstFormatting) {
      run.insertBefore(fonts, firstFormatting);
      changed = true;
    }

    const seen = new Map<string, Element>();
    for (const property of children.filter(child => child.localName === "b" || child.localName === "i")) {
      const preceding = seen.get(property.localName);
      if (preceding?.isEqualNode(property)) {
        property.remove();
        changed = true;
      } else {
        seen.set(property.localName, property);
      }
    }
  }

  for (const paragraph of Array.from(doc.getElementsByTagNameNS(namespace, "pPr"))) {
    const children = Array.from(paragraph.children).filter(child => child.namespaceURI === namespace);
    const afterSpacing = children.find(child =>
      ["ind", "contextualSpacing", "mirrorIndents", "suppressOverlap", "jc"].includes(child.localName));
    const spacing = children.find(child => child.localName === "spacing");
    if (spacing && afterSpacing && children.indexOf(spacing) > children.indexOf(afterSpacing)) {
      paragraph.insertBefore(spacing, afterSpacing);
      changed = true;
    }
  }

  for (const charset of Array.from(doc.getElementsByTagNameNS(namespace, "charset"))) {
    const value = charset.getAttributeNS(namespace, "val");
    const characterSet = charset.getAttributeNS(namespace, "characterSet");
    // The legacy numeric charset already conveys the information Word supports.
    if (value && /^[0-9a-f]{2}$/i.test(value) && /^(?:utf-8|windows-1252)$/i.test(characterSet ?? "")) {
      charset.removeAttributeNS(namespace, "characterSet");
      changed = true;
    }
  }
  return changed;
}

/** Repair malformed properties copied from older templates, without changing document text. */
export function repairWordPackage(files: Record<string, Uint8Array>): boolean {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const parser = new DOMParser();
  const serializer = new XMLSerializer();
  let changed = false;
  for (const [name, bytes] of Object.entries(files)) {
    if (name !== "docProps/custom.xml" && !wordParts.test(name)) continue;
    const doc = parser.parseFromString(decoder.decode(bytes), "application/xml");
    const namespace = doc.documentElement.namespaceURI;
    const repaired = name === "docProps/custom.xml"
      ? removeEmptyCustomProperties(doc)
      : namespace && wordNamespaces.includes(namespace) && repairWordPart(doc, namespace);
    if (!repaired) continue;
    files[name] = encoder.encode(serializer.serializeToString(doc));
    changed = true;
  }
  return changed;
}
