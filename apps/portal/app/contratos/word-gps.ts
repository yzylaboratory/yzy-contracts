export const gpsBoldFields = ["fecha_firma"];

export function formatGps(doc: Document): void {
  const namespace = doc.documentElement.namespaceURI;
  if (!namespace) return;
  const paragraphs = Array.from(doc.getElementsByTagNameNS(namespace, "p"));
  for (const paragraph of paragraphs) {
    const runs = Array.from(paragraph.getElementsByTagNameNS(namespace, "t"));
    if (runs.map(run => run.textContent).join("").trim() !== "SEGUNDA PARTE O DEUDOR") continue;

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
    return;
  }
}
