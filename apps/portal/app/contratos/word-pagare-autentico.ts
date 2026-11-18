import { declaracionJuradaSignatureName } from "./word-declaracion-jurada";

export const pagareAutenticoBoldFields = ["fecha_firma"];

export function formatPagareAutentico(doc: Document): void {
  const ns = doc.documentElement.namespaceURI;
  if (!ns) return;
  const body = doc.getElementsByTagNameNS(ns, "body")[0];
  if (!body) return;

  const text = (element: Element) =>
    Array.from(element.getElementsByTagNameNS(ns, "t"), node => node.textContent ?? "").join("");

  const section = body.getElementsByTagNameNS(ns, "sectPr")[0];
  const pageWidth = Number(section?.getElementsByTagNameNS(ns, "pgSz")[0]?.getAttributeNS(ns, "w"));
  const margins = section?.getElementsByTagNameNS(ns, "pgMar")[0];
  const contentWidth = pageWidth - Number(margins?.getAttributeNS(ns, "left")) -
    Number(margins?.getAttributeNS(ns, "right"));
  const columnWidth = Math.floor(contentWidth / 2);
  if (!(columnWidth > 0)) return;

  function word(tag: string, attributes: Record<string, string | number> = {}) {
    const element = doc.createElementNS(ns, `w:${tag}`);
    for (const [name, value] of Object.entries(attributes)) element.setAttributeNS(ns, `w:${name}`, String(value));
    return element;
  }

  function cloneRunWithText(source: Element, value: string) {
    const run = source.cloneNode(false) as Element;
    const runProperties = source.getElementsByTagNameNS(ns, "rPr")[0];
    if (runProperties) run.append(runProperties.cloneNode(true));
    const content = word("t");
    content.textContent = value;
    run.append(content);
    return run;
  }

  // Separate the ACTO / Número, line from the opening body paragraph so LibreOffice and Word align both edges cleanly.
  const opening = Array.from(body.children).find(element =>
    element.localName === "p" && /^ACTO\s+Número,\s+En la\s+Ciudad\b/u.test(text(element)));
  if (opening) {
    const runs = Array.from(opening.getElementsByTagNameNS(ns, "r"));
    const actoIndex = runs.findIndex(run => text(run).trim() === "ACTO");
    const numeroIndex = actoIndex >= 0
      ? runs.findIndex((run, index) => index > actoIndex && text(run).trim() === "Número")
      : -1;
    const commaIndex = numeroIndex >= 0
      ? runs.findIndex((run, index) => index > numeroIndex && text(run).trim() === ",")
      : -1;
    const cityIndex = commaIndex >= 0
      ? runs.findIndex((run, index) => index > commaIndex && text(run).trimStart().startsWith("En la"))
      : -1;
    const onlyWhitespaceBetween = actoIndex >= 0 && cityIndex > commaIndex && runs.slice(0, cityIndex)
      .every((run, index) => index === actoIndex || index === numeroIndex || index === commaIndex || !text(run).trim());

    if (onlyWhitespaceBetween) {
      const rightWidth = contentWidth - columnWidth;
      const headerTable = word("tbl");
      const headerProperties = word("tblPr");
      const borders = word("tblBorders");
      for (const edge of ["top", "left", "bottom", "right", "insideH", "insideV"]) {
        borders.append(word(edge, { val: "none", sz: 0, space: 0, color: "auto" }));
      }
      const cellMargins = word("tblCellMar");
      for (const side of ["top", "left", "bottom", "right"]) {
        cellMargins.append(word(side, { w: 0, type: "dxa" }));
      }
      headerProperties.append(
        word("tblW", { w: contentWidth, type: "dxa" }),
        borders,
        word("tblLayout", { type: "fixed" }),
        cellMargins,
      );
      const headerGrid = word("tblGrid");
      headerGrid.append(word("gridCol", { w: columnWidth }), word("gridCol", { w: rightWidth }));
      headerTable.append(headerProperties, headerGrid);

      const headerRow = word("tr");
      const headerRowProperties = word("trPr");
      headerRowProperties.append(word("cantSplit"));
      headerRow.append(headerRowProperties);

      const headerCells = [
        { width: columnWidth, align: "left", runs: [cloneRunWithText(runs[actoIndex], "ACTO")] },
        {
          width: rightWidth,
          align: "right",
          runs: [cloneRunWithText(runs[numeroIndex], "Número"), cloneRunWithText(runs[commaIndex], ",")],
        },
      ];
      for (const { width, align, runs: cellRuns } of headerCells) {
        const cell = word("tc");
        const cellProperties = word("tcPr");
        cellProperties.append(word("tcW", { w: width, type: "dxa" }));
        const paragraph = word("p");
        const properties = word("pPr");
        properties.append(word("keepNext"), word("spacing", { before: 0, after: 0 }), word("jc", { val: align }));
        paragraph.append(properties, ...cellRuns);
        cell.append(cellProperties, paragraph);
        headerRow.append(cell);
      }
      headerTable.append(headerRow);
      body.insertBefore(headerTable, opening);

      for (const run of runs.slice(0, cityIndex)) run.remove();
      for (const node of Array.from(runs[cityIndex].getElementsByTagNameNS(ns, "t"))) {
        const trimmed = (node.textContent ?? "").trimStart();
        if (!trimmed) {
          node.remove();
          continue;
        }
        node.textContent = trimmed;
        if (/^\s|\s$/.test(trimmed)) {
          node.setAttributeNS("http://www.w3.org/XML/1998/namespace", "xml:space", "preserve");
        } else {
          node.removeAttributeNS("http://www.w3.org/XML/1998/namespace", "space");
        }
        break;
      }
    }
  }

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

  const table = word("tbl");
  const tableProperties = word("tblPr");
  tableProperties.append(word("tblW", { w: columnWidth * 2, type: "dxa" }), word("tblLayout", { type: "fixed" }));
  const grid = word("tblGrid");
  grid.append(word("gridCol", { w: columnWidth }), word("gridCol", { w: columnWidth }));
  table.append(tableProperties, grid);

  // Separate each line, name and caption into rows so both captions stay aligned if a long name wraps.
  const rows = [
    [{ source: signatureLines, value: lines[0] }, { source: signatureLines, value: lines[1] }],
    [
      { source: leftName, value: declaracionJuradaSignatureName(names[0]) },
      { source: rightNameAndLabels, value: declaracionJuradaSignatureName(names[1]) },
    ],
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
      const run = cloneRunWithText(source, value);
      paragraph.append(properties, run);
      cell.append(cellProperties, paragraph);
      row.append(cell);
    }
    table.append(row);
  }
  witnessBlock.replaceWith(table);
}
