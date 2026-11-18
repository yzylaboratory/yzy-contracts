export const gpsBoldFields = ["fecha_firma", "empresa_direccion"];

export function formatGps(doc: Document): void {
  const namespace = doc.documentElement.namespaceURI;
  if (!namespace) return;
  const paragraphs = Array.from(doc.getElementsByTagNameNS(namespace, "p"));
  for (const paragraph of paragraphs) {
    const runs = Array.from(paragraph.getElementsByTagNameNS(namespace, "t"));
    const text = runs.map(run => run.textContent).join("").trim();
    if (text === "ABOGADO NOTARIO") {
      const signature = paragraph.previousElementSibling;
      if (signature?.namespaceURI !== namespace || signature.localName !== "p") continue;
      const properties = signature.getElementsByTagNameNS(namespace, "pPr")[0];
      const spacing = properties?.getElementsByTagNameNS(namespace, "spacing")[0];
      if (!spacing) continue;

      // Reserve room for the handwritten signature above the underlined name.
      spacing.setAttributeNS(namespace, `${signature.prefix || "w"}:before`, "1080");
      properties.getElementsByTagNameNS(namespace, "contextualSpacing")[0]?.remove();
      continue;
    }
    if (text !== "SEGUNDA PARTE O DEUDOR") continue;

    // The original uses leading spaces to align this label with the signature.
    for (const run of runs) {
      const content = run.textContent?.trimStart() ?? "";
      run.textContent = content;
      if (content) break;
    }

    const prefix = paragraph.prefix ? `${paragraph.prefix}:` : "";
    let properties = paragraph.getElementsByTagNameNS(namespace, "pPr")[0];
    if (!properties) {
      properties = doc.createElementNS(namespace, `${prefix}pPr`);
      paragraph.prepend(properties);
    }
    let alignment = properties.getElementsByTagNameNS(namespace, "jc")[0];
    if (!alignment) {
      alignment = doc.createElementNS(namespace, `${prefix}jc`);
      // In this signature paragraph, justification follows spacing and precedes run properties.
      properties.insertBefore(alignment, properties.getElementsByTagNameNS(namespace, "rPr")[0] ?? null);
    }
    alignment.setAttributeNS(namespace, `${prefix || "w:"}val`, "center");
  }
}
