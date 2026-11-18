import { declaracionJuradaSignatureName } from "./word-declaracion-jurada";

const handwrittenDate = "los          (  ) días del mes de(                  )del AÑO DOS MIL_____________________ (    )";

function formatWitnessSignatures(doc: Document, namespace: string): void {
  const text = (element: Element) =>
    Array.from(element.getElementsByTagNameNS(namespace, "t"), node => node.textContent ?? "").join("").trim();
  const childElements = (parent: Element, localName: string) =>
    Array.from(parent.children).filter(child => child.namespaceURI === namespace && child.localName === localName);

  for (const table of Array.from(doc.getElementsByTagNameNS(namespace, "tbl"))) {
    const rows = childElements(table, "tr");
    if (rows.length !== 3) continue;
    const lines = childElements(rows[0], "tc");
    const names = childElements(rows[1], "tc");
    const labels = childElements(rows[2], "tc");
    if (lines.length !== 2 || names.length !== 2 || labels.length !== 2) continue;
    if (!lines.every(cell => /^_{20,}$/.test(text(cell))) || !labels.every(cell => text(cell) === "TESTIGO")) continue;

    for (const cell of names) {
      const nodes = Array.from(cell.getElementsByTagNameNS(namespace, "t"));
      const value = nodes.map(node => node.textContent ?? "").join("").trim();
      if (!value || !nodes[0]) continue;
      const signature = declaracionJuradaSignatureName(value);
      if (signature === value) continue;
      nodes[0].textContent = signature;
      for (const extra of nodes.slice(1)) extra.textContent = "";
    }
    return;
  }
}

export function formatEntregaVoluntaria(doc: Document): void {
  const namespace = doc.documentElement.namespaceURI;
  if (!namespace) return;
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
    break;
  }
  formatWitnessSignatures(doc, namespace);
}
