export const entregaVehiculoBoldFields = ["fecha_firma"];

export function formatEntregaVehiculo(doc: Document): void {
  const ns = doc.documentElement.namespaceURI;
  if (!ns) return;

  const body = doc.getElementsByTagNameNS(ns, "body")[0];
  if (!body) return;

  const paragraphs = Array.from(body.children);
  const text = (paragraph: Element) => Array.from(paragraph.getElementsByTagNameNS(ns, "t"))
    .map(node => node.textContent ?? "").join("").trim();
  const received = paragraphs.findIndex(p => p.localName === "p" && text(p) === "RECIBIDO POR:");
  const delivered = paragraphs.findIndex(p => p.localName === "p" && text(p) === "ENTREGADO POR:");
  if (received < 1 || delivered <= received + 1) return;

  const names = [paragraphs[received - 1], paragraphs[delivered - 1]];
  const labels = [paragraphs[received], paragraphs[delivered]];
  const separators = paragraphs.slice(received + 1, delivered - 1);
  if ([...names, ...separators].some(p => p.localName !== "p") || separators.some(p => text(p))) return;

  const section = body.getElementsByTagNameNS(ns, "sectPr")[0];
  const width = Number(section?.getElementsByTagNameNS(ns, "pgSz")[0]?.getAttributeNS(ns, "w"));
  const margins = section?.getElementsByTagNameNS(ns, "pgMar")[0];
  const columnWidth = Math.floor((width - Number(margins?.getAttributeNS(ns, "left")) -
    Number(margins?.getAttributeNS(ns, "right"))) / 2);
  if (!Number.isFinite(columnWidth) || columnWidth <= 0) return;

  const word = (tag: string, attrs: Record<string, string | number> = {}) => {
    const element = doc.createElementNS(ns, `w:${tag}`);
    for (const [name, value] of Object.entries(attrs)) element.setAttributeNS(ns, `w:${name}`, String(value));
    return element;
  };
  const table = word("tbl");
  const properties = word("tblPr");
  properties.append(word("tblW", { w: columnWidth * 2, type: "dxa" }), word("tblLayout", { type: "fixed" }));
  const grid = word("tblGrid");
  grid.append(word("gridCol", { w: columnWidth }), word("gridCol", { w: columnWidth }));
  table.append(properties, grid);
  body.insertBefore(table, names[0]);

  // Separate rows keep the captions aligned even if one name wraps.
  for (const [index, blocks] of [names, labels].entries()) {
    const row = word("tr");
    const rowProperties = word("trPr");
    rowProperties.append(word("cantSplit"));
    row.append(rowProperties);
    for (const paragraph of blocks) {
      const pPr = paragraph.getElementsByTagNameNS(ns, "pPr")[0];
      pPr?.getElementsByTagNameNS(ns, "tabs")[0]?.remove();
      pPr?.getElementsByTagNameNS(ns, "ind")[0]?.remove();
      if (index === 0) pPr?.prepend(word("keepNext"));
      if (index === 1) {
        for (const run of paragraph.getElementsByTagNameNS(ns, "r")) {
          const rPr = run.getElementsByTagNameNS(ns, "rPr")[0];
          if (rPr && !rPr.getElementsByTagNameNS(ns, "u").length) {
            rPr.insertBefore(word("u", { val: "single" }), rPr.getElementsByTagNameNS(ns, "lang")[0] ?? null);
          }
        }
      }
      const cell = word("tc");
      const cellProperties = word("tcPr");
      cellProperties.append(word("tcW", { w: columnWidth, type: "dxa" }));
      cell.append(cellProperties, paragraph);
      row.append(cell);
    }
    table.append(row);
  }
  separators.forEach(p => p.remove());
}
