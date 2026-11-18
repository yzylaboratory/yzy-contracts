import { companyProfileValue, declarationWitnessNameKey } from "../configuracion/empresas/company-fields";

export const declaracionJuradaBoldFields = ["fecha_firma"];

export function declaracionJuradaSignatureName(name: string) {
  const parts = name.trim().split(/\s+/u);
  // Only a first name, a second name and two surnames can be split reliably.
  if (parts.length !== 4 || parts.some(part => /^(?:de|del|la|las|los|y)$/iu.test(part))) return name;
  const initial = /^\p{L}\p{M}*/u.exec(parts[1]);
  if (!initial || parts[1].length === 1 || parts[1] === `${initial[0]}.`) return name;
  parts[1] = `${initial[0]}.`;
  return parts.join(" ");
}

function normalizedName(name: string) {
  return name.normalize("NFD").replace(/\p{M}/gu, "").trim().replace(/\s+/gu, " ").toLocaleUpperCase("es");
}

export function declaracionJuradaWitnessValue(values: Record<string, string>, key: string): string | undefined {
  if (key !== "empresa_testigo_richard" && key !== "empresa_testigo_usuario") return undefined;
  const name = companyProfileValue(values, key);
  if (key === "empresa_testigo_richard") return name;
  const fullName = values[declarationWitnessNameKey]?.trim();
  // A saved full name only supplements the matching abbreviated witness.
  return fullName && normalizedName(declaracionJuradaSignatureName(fullName)) === normalizedName(name)
    ? fullName
    : name;
}

export function formatDeclaracionJurada(doc: Document): void {
  const ns = doc.documentElement.namespaceURI;
  if (!ns) return;
  const body = doc.getElementsByTagNameNS(ns, "body")[0];
  if (!body) return;
  const text = (element: Element) =>
    Array.from(element.getElementsByTagNameNS(ns, "t"), node => node.textContent ?? "").join("").trim();
  const labels = Array.from(body.children).find(element =>
    element.localName === "p" && /^TESTIGO\s+TESTIGO$/.test(text(element)));
  const signatures = labels?.previousElementSibling;
  if (!labels || signatures?.localName !== "p") return;

  const signatureRuns = Array.from(signatures.getElementsByTagNameNS(ns, "r"));
  const lineStyle = signatureRuns.find(run => /^_{20,}$/.test(text(run)));
  const names = signatureRuns.filter(run => /\p{L}/u.test(text(run)));
  const labelStyle = Array.from(labels.getElementsByTagNameNS(ns, "r")).find(run => text(run) === "TESTIGO");
  if (!lineStyle || names.length !== 2 || !labelStyle) return;

  const section = body.getElementsByTagNameNS(ns, "sectPr")[0];
  const page = Number(section?.getElementsByTagNameNS(ns, "pgSz")[0]?.getAttributeNS(ns, "w"));
  const margins = section?.getElementsByTagNameNS(ns, "pgMar")[0];
  const columnWidth = Math.floor((page - Number(margins?.getAttributeNS(ns, "left")) -
    Number(margins?.getAttributeNS(ns, "right"))) / 2);
  if (!columnWidth || columnWidth < 0) return;

  const word = (tag: string, attributes: Record<string, string | number> = {}) => {
    const element = doc.createElementNS(ns, `w:${tag}`);
    for (const [name, value] of Object.entries(attributes)) element.setAttributeNS(ns, `w:${name}`, String(value));
    return element;
  };
  const table = word("tbl");
  const tableProperties = word("tblPr");
  tableProperties.append(word("tblW", { w: columnWidth * 2, type: "dxa" }), word("tblLayout", { type: "fixed" }));
  const grid = word("tblGrid");
  grid.append(word("gridCol", { w: columnWidth }), word("gridCol", { w: columnWidth }));
  table.append(tableProperties, grid);

  // Distinct rows keep the labels aligned even when one witness's name wraps.
  const rows = [
    [lineStyle, lineStyle],
    names,
    [labelStyle, labelStyle],
  ];
  for (const [index, sources] of rows.entries()) {
    const row = word("tr");
    const rowProperties = word("trPr");
    rowProperties.append(word("cantSplit"));
    row.append(rowProperties);
    for (const source of sources) {
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
      const value = text(source);
      content.textContent = index === 1 ? declaracionJuradaSignatureName(value) : value;
      run.append(content);
      paragraph.append(properties, run);
      cell.append(cellProperties, paragraph);
      row.append(cell);
    }
    table.append(row);
  }

  signatures.replaceWith(table);
  labels.remove();
}
