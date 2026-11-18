export const pagareAutenticoBoldFields = ["fecha_firma"];

export function formatPagareAutentico(doc: Document): void {
  const ns = doc.documentElement.namespaceURI;
  if (!ns) return;
  const body = doc.getElementsByTagNameNS(ns, "body")[0];
  if (!body) return;

  const text = (element: Element) =>
    Array.from(element.getElementsByTagNameNS(ns, "t"), node => node.textContent ?? "").join("");
  const witnessLabels = /\s+TESTIGO\s+TESTIGO\s+$/u;
  const witnessBlock = Array.from(body.children).find(element =>
    element.localName === "p" && /^_{20,}\s+_{20,}\s+.+\s+TESTIGO\s+TESTIGO\s+_\s*$/u.test(text(element)));

  if (!witnessBlock) return;
  const [signatureLines, leftName, rightNameAndLabels] = Array.from(witnessBlock.getElementsByTagNameNS(ns, "r"));
  if (!signatureLines || !leftName || !rightNameAndLabels) return;
  const lines = text(signatureLines).trim().split(/\s+/u);
  if (lines.length !== 2 || !lines.every(line => /^_{20,}$/u.test(line))) return;
  const right = text(rightNameAndLabels);
  if (!witnessLabels.test(right)) return;
  const names = [text(leftName).trim(), right.replace(witnessLabels, "").trim()];

  const section = body.getElementsByTagNameNS(ns, "sectPr")[0];
  const pageWidth = Number(section?.getElementsByTagNameNS(ns, "pgSz")[0]?.getAttributeNS(ns, "w"));
  const margins = section?.getElementsByTagNameNS(ns, "pgMar")[0];
  const columnWidth = Math.floor((pageWidth - Number(margins?.getAttributeNS(ns, "left")) -
    Number(margins?.getAttributeNS(ns, "right"))) / 2);
  if (!(columnWidth > 0)) return;

  function word(tag: string, attributes: Record<string, string | number> = {}) {
    const element = doc.createElementNS(ns, `w:${tag}`);
    for (const [name, value] of Object.entries(attributes)) element.setAttributeNS(ns, `w:${name}`, String(value));
    return element;
  }

  const table = word("tbl");
  const tableProperties = word("tblPr");
  tableProperties.append(word("tblW", { w: columnWidth * 2, type: "dxa" }), word("tblLayout", { type: "fixed" }));
  const grid = word("tblGrid");
  grid.append(word("gridCol", { w: columnWidth }), word("gridCol", { w: columnWidth }));
  table.append(tableProperties, grid);

  // Separate each line, name and caption into rows so both captions stay aligned if a long name wraps.
  const rows = [
    [{ source: signatureLines, value: lines[0] }, { source: signatureLines, value: lines[1] }],
    [{ source: leftName, value: names[0] }, { source: rightNameAndLabels, value: names[1] }],
    [{ source: rightNameAndLabels, value: "TESTIGO" }, { source: rightNameAndLabels, value: "TESTIGO" }],
  ];
  for (const [index, cells] of rows.entries()) {
    const row = word("tr");
    const rowProperties = word("trPr");
    rowProperties.append(word("cantSplit"));
    row.append(rowProperties);
    for (const { source, value } of cells) {
      const cell = word("tc");
      const cellProperties = word("tcPr");
      cellProperties.append(word("tcW", { w: columnWidth, type: "dxa" }));
      const paragraph = word("p");
      const properties = word("pPr");
      if (index < rows.length - 1) properties.append(word("keepNext"));
      properties.append(word("spacing", { before: 0, after: 0 }), word("jc", { val: "center" }));
      const run = source.cloneNode(false) as Element;
      const runProperties = source.getElementsByTagNameNS(ns, "rPr")[0];
      if (runProperties) run.append(runProperties.cloneNode(true));
      const content = word("t");
      content.textContent = value;
      run.append(content);
      paragraph.append(properties, run);
      cell.append(cellProperties, paragraph);
      row.append(cell);
    }
    table.append(row);
  }
  witnessBlock.replaceWith(table);
}
