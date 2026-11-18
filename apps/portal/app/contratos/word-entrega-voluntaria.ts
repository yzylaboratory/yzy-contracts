const handwrittenDate = "los          (  ) días del mes de(                  )del AÑO DOS MIL_____________________ (    )";

export function formatEntregaVoluntaria(doc: Document): void {
  const namespace = doc.documentElement.namespaceURI;
  const paragraphs = Array.from(doc.getElementsByTagNameNS(namespace, "p"));
  for (const paragraph of paragraphs) {
    const nodes = Array.from(paragraph.getElementsByTagNameNS(namespace, "t"));
    const text = nodes.map(node => node.textContent ?? "").join("").trimStart();
    if (!text.startsWith("En la  Ciudad de Santo Domingo, Distrito Nacional, Capital de la República") ||
        !text.includes("; por ante mí ")) continue;

    // The reviewed template stores its opening date in the same run as this prefix.
    const prefix = "Dominicana, a ";
    const date = nodes.find(node => node.textContent?.startsWith(prefix));
    if (date) date.textContent = prefix + handwrittenDate;
    return;
  }
}
