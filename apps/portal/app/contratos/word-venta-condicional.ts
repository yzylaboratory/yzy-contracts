export const ventaCondicionalBoldFields: readonly string[] = [];

export function formatVentaCondicional(doc: Document): void {
  const ns = doc.documentElement.namespaceURI;
  const textNodes = (element: Element) => Array.from(element.getElementsByTagNameNS(ns, "t"));
  const text = (element: Element) => textNodes(element).map(node => node.textContent ?? "").join("");
  const body = doc.getElementsByTagNameNS(ns, "body").item(0);
  if (!body) return;

  const paragraphs = Array.from(body.children).filter(child => child.localName === "p");
  const titleIndex = paragraphs.findIndex(p => text(p).trim() === "CONTRATO DE VENTA CONDICIONAL DE MUEBLES");
  if (titleIndex >= 0) {
    const subtitle = paragraphs[titleIndex + 1];
    if (subtitle && /^Fecha del contrato:/i.test(text(subtitle).trim())) subtitle.remove();

    const comparecencia = paragraphs.slice(titleIndex + 1)
      .find(p => p.isConnected && text(p).trim());
    if (comparecencia) {
      for (const node of textNodes(comparecencia)) {
        const value = node.textContent?.trimStart();
        if (value) {
          node.textContent = value;
          break;
        }
        node.remove();
      }
      comparecencia.getElementsByTagNameNS(ns, "ind").item(0)?.remove();
      comparecencia.getElementsByTagNameNS(ns, "tabs").item(0)?.remove();
    }

    const firstClause = paragraphs.find(p => text(p).startsWith("CLÁUSULA PRIMERA:"));
    firstClause?.getElementsByTagNameNS(ns, "ind").item(0)?.remove();
  }

  const buyerSignature = paragraphs.find(p => text(p).trim() === "FIRMA DEL COMPRADOR");
  const buyerFields = buyerSignature?.nextElementSibling;
  if (buyerFields?.localName !== "tbl") return;
  for (const label of ["Nombre:", "Cédula:", "Dirección:"]) {
    const field = Array.from(buyerFields.getElementsByTagNameNS(ns, "p"))
      .find(p => text(p).startsWith(label));
    const originalRun = field && textNodes(field)[0]?.parentElement;
    if (!field || !originalRun) continue;

    // Put the writing line below its label to use the full width of the cell.
    const labelRun = originalRun.cloneNode(false) as Element;
    const style = originalRun.getElementsByTagNameNS(ns, "rPr").item(0);
    if (style) labelRun.appendChild(style.cloneNode(true));
    const labelText = textNodes(field)[0].cloneNode(false) as Element;
    labelText.textContent = label;
    labelRun.appendChild(labelText);
    for (const run of Array.from(field.getElementsByTagNameNS(ns, "r"))) run.remove();
    field.appendChild(labelRun);

    const lineBreak = doc.createElementNS(ns, labelRun.prefix ? `${labelRun.prefix}:br` : "br");
    const writingLine = labelText.cloneNode(false) as Element;
    writingLine.textContent = "____________________";
    labelRun.append(lineBreak, writingLine);
  }
}
