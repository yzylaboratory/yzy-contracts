import { ApiError } from "@/lib/api";
import { getContractDownload, renderContractPdf, type NativeVariable } from "./contracts-api";
import { hasInsuranceCompanyNameInText } from "./document-catalog";
import { documentClauseCase, isContractAddressKey, multilinePaymentFields } from "./expediente-fields";
import type { DocumentFormat } from "./generated-documents-api";
import { countTemplateFields, fieldToken, formatTemplateValue, type TemplateField } from "./template-fields";

const fileLimit = 20 * 1024 * 1024;
const xmlLimit = 8 * 1024 * 1024;
const zipLimit = 64 * 1024 * 1024;
const wordMime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const wordNamespaces = [
  "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
  "http://purl.oclc.org/ooxml/wordprocessingml/main",
];
const wordParts = /^word\/(?:document|header\d+|footer\d+|footnotes|endnotes)\.xml$/;
const protectedContainers = new Set([
  "del", "ins", "moveFrom", "moveTo", "fldSimple", "hyperlink", "sdt", "AlternateContent",
]);
const excluded = new Set([
  ...protectedContainers,
  "p", "instrText", "drawing", "object", "pict", "tab", "br", "cr", "sym", "noBreakHyphen",
  "softHyphen", "footnoteReference", "endnoteReference", "commentReference",
]);
const nativeTextElements = new Set(["t", "delText", "instrText"]);
const variableKey = /^[a-z][a-z0-9_]{0,63}$/;
const variableToken = /\{\{([a-z][a-z0-9_]{0,63})\}\}|\{\{|\}\}/g;
const variableLimit = 100;
const occurrenceLimit = 1000;
const invalidVariables = "Las variables del Word original no coinciden con la plantilla. Revisa los marcadores y sube el archivo de nuevo.";

export class NativeDocumentError extends Error {}

type WordText = { node: Element; start: number; end: number };
type Segment = { part: string; text: string; nodes: WordText[] };
type Match = { segment: Segment; start: number; end: number };
type TextRun = { text: string; bold: boolean };
type Replacement = Match & { value: string; bold?: boolean; runs?: readonly TextRun[] };

const salePaymentColumns = ["cuotas_intereses_numeros", "cuotas_intereses_fechas", "cuotas_intereses_montos"];
const pagareDateKeys = new Set(["fecha_firma", "fecha_de_firma"]);

// Un vehículo importado con bill of lading no tiene placa ni motor: sin valor, su etiqueta tampoco se imprime.
const plateLabel = { before: /NO\.\s*DE\s+REGISTRO\s+Y\s+PLACA:\s*$/i, after: /^\s+/ };
const engineLabel = { before: /,\s*MOTOR\s+O\s+NO\.\s*DE\s+SERIE:\s*$/i };
const emptyVehicleLabels: Record<string, { before: RegExp; after?: RegExp }> = {
  placa_del_vehiculo: plateLabel,
  vehiculo_matricula: plateLabel,
  numero_de_serie_del_motor: engineLabel,
  vehiculo_motor: engineLabel,
};

/** Amplía el rango de un marcador vacío para incluir la etiqueta que lo describe en el Word. */
export function emptyLabelRange(key: string, text: string, start: number, end: number) {
  const label = emptyVehicleLabels[key];
  if (!label) return { start, end };
  const before = label.before.exec(text.slice(0, start));
  if (!before) return { start, end };
  const after = label.after?.exec(text.slice(end));
  return { start: before.index, end: end + (after?.[0].length ?? 0) };
}

function isBoldAddressField(key: string) {
  return isContractAddressKey(key);
}

export function pagareDateRuns(key: string, value: string, boldPagareDate: boolean): readonly TextRun[] | undefined {
  if (!boldPagareDate || !pagareDateKeys.has(key) || !value) return undefined;
  const actMatch = /^(.+?\(\d+\))( días del mes de )([A-ZÁÉÍÓÚÑ]+)( del año )(\d{4})$/.exec(value);
  if (actMatch) {
    return [
      { text: actMatch[1], bold: true },
      { text: actMatch[2], bold: false },
      { text: actMatch[3], bold: true },
      { text: actMatch[4], bold: false },
      { text: actMatch[5], bold: true },
    ];
  }
  const longMatch = /^(\d{1,2})( de )([a-záéíóúñ]+)( de )(\d{4})$/.exec(value);
  if (longMatch) {
    return [
      { text: longMatch[1], bold: true },
      { text: longMatch[2], bold: false },
      { text: longMatch[3], bold: true },
      { text: longMatch[4], bold: false },
      { text: longMatch[5], bold: true },
    ];
  }
  return [{ text: value, bold: true }];
}

function nativeKeys(text: string) {
  const keys: string[] = [];
  for (const match of text.matchAll(variableToken)) {
    if (!match[1] || keys.length === occurrenceLimit) throw new NativeDocumentError(invalidVariables);
    keys.push(match[1]);
  }
  return keys;
}

function paragraphText(paragraph: Element, namespace: string) {
  const chunks: string[] = [];
  function collect(element: Element) {
    if (element.localName === "p") return;
    if (element.namespaceURI === namespace) {
      if (nativeTextElements.has(element.localName)) {
        chunks.push(element.textContent ?? "");
        return;
      }
    }
    for (const child of Array.from(element.children)) collect(child);
  }
  for (const child of Array.from(paragraph.children)) collect(child);
  return chunks.join("");
}

function wordSegments(doc: Document, part: string, validateNative: boolean): Segment[] {
  const namespace = doc.documentElement.namespaceURI;
  if (!namespace || !wordNamespaces.includes(namespace)) {
    throw new NativeDocumentError("El archivo Word tiene una estructura que no podemos editar.");
  }
  const segments: Segment[] = [];
  for (const paragraph of Array.from(doc.getElementsByTagNameNS(namespace, "p"))) {
    const fullKeys = validateNative ? nativeKeys(paragraphText(paragraph, namespace)) : [];
    let ancestor = paragraph.parentElement;
    while (ancestor && !protectedContainers.has(ancestor.localName)) ancestor = ancestor.parentElement;
    if (ancestor) {
      if (fullKeys.length) throw new NativeDocumentError(invalidVariables);
      continue;
    }
    let fieldDepth = 0;
    const supportedKeys: string[] = [];
    let current: Segment = { part, text: "", nodes: [] };
    const flush = () => {
      if (current.text) {
        segments.push(current);
        if (validateNative) supportedKeys.push(...nativeKeys(current.text));
      }
      current = { part, text: "", nodes: [] };
    };
    function visit(element: Element) {
      if (element.namespaceURI === namespace && element.localName === "fldChar") {
        const kind = element.getAttributeNS(namespace, "fldCharType");
        if (kind === "begin") fieldDepth++;
        if (kind === "end") fieldDepth = Math.max(0, fieldDepth - 1);
        flush();
        return;
      }
      if (excluded.has(element.localName)) {
        flush();
        return;
      }
      if (element.namespaceURI === namespace && element.localName === "t" && !fieldDepth) {
        const text = element.textContent ?? "";
        if (text) {
          const start = current.text.length;
          current.text += text;
          current.nodes.push({ node: element, start, end: current.text.length });
        }
        return;
      }
      for (const child of Array.from(element.children)) visit(child);
    }
    for (const child of Array.from(paragraph.children)) visit(child);
    flush();
    if (fullKeys.length !== supportedKeys.length || fullKeys.some((key, index) => key !== supportedKeys[index])) {
      throw new NativeDocumentError(invalidVariables);
    }
  }
  return segments;
}

function textMatches(segments: Segment[], needle: string) {
  const result: Match[] = [];
  const word = /[\p{L}\p{N}\p{M}]/u;
  for (const segment of segments) {
    let start = segment.text.indexOf(needle);
    while (start !== -1) {
      const end = start + needle.length;
      const startsInsideWord = word.test(needle[0]) && start > 0 && word.test(segment.text[start - 1]);
      const endsInsideWord = word.test(needle[needle.length - 1]) && end < segment.text.length && word.test(segment.text[end]);
      if (!startsInsideWord && !endsInsideWord) result.push({ segment, start, end });
      start = segment.text.indexOf(needle, start + 1);
    }
  }
  return result;
}

function resolveTargets(segments: Segment[], markdown: string, fields: TemplateField[], values: Record<string, string>, uppercase = false, boldPagareDate = false) {
  const counts = countTemplateFields(markdown);
  const bySegment = new Map<Segment, Replacement[]>();
  for (const field of fields) {
    const expected = counts.get(field.key) ?? 0;
    const token = fieldToken(field.key);
    const matches = textMatches(segments, token);
    const missing = expected - matches.length;
    if (missing > 0) {
      const linked = field.sourceTexts?.filter(text => text && text !== token) ?? [];
      const candidates = new Map<string, number>();
      for (const text of linked) candidates.set(text, (candidates.get(text) ?? 0) + 1);
      if (!candidates.size || (candidates.size > 1 && linked.length !== missing)) {
        throw new NativeDocumentError(`Vincula «${field.label}» con cada aparición de su texto exacto en el Word original.`);
      }
      for (const [text, count] of candidates) {
        const locations = textMatches(segments, text);
        if (locations.length !== (candidates.size === 1 ? missing : count)) {
          throw new NativeDocumentError(`No se pudo identificar sin ambigüedad el texto original de «${field.label}». Revisa su vínculo en el editor.`);
        }
        matches.push(...locations);
      }
    }
    if (matches.length !== expected) {
      throw new NativeDocumentError(`El marcador de «${field.label}» aparece más veces en Word que en la plantilla. Revisa el vínculo.`);
    }
    const value = formatWordTemplateValue(field, Object.hasOwn(values, field.key) ? values[field.key] : "", uppercase);
    const runs = pagareDateRuns(field.key, value, boldPagareDate);
    for (const match of matches) {
      const existing = bySegment.get(match.segment) ?? [];
      existing.push({ ...match, value, bold: isBoldAddressField(field.key), ...(runs && { runs }) });
      bySegment.set(match.segment, existing);
    }
  }
  for (const edits of bySegment.values()) {
    edits.sort((a, b) => b.start - a.start);
    for (let index = 1; index < edits.length; index++) {
      if (edits[index].end > edits[index - 1].start) {
        throw new NativeDocumentError("Dos campos apuntan al mismo texto en Word. Corrige sus vínculos.");
      }
    }
  }
  return bySegment;
}

export function normalizeWordTemplateLine(value: string) {
  return value.replace(/[\r\n\t]/g, " ");
}

export function formatWordTemplateValue(field: TemplateField, input: string, uppercase = false) {
  const formatted = formatTemplateValue(
    field.key === "fecha_cuota_final_capital" && field.kind === "date" && field.dateStyle !== "notarial" && field.dateStyle !== "notarialAct"
      ? { ...field, dateStyle: "numeric" }
      : field,
    input,
  );
  const value = multilinePaymentFields.has(field.key)
    ? formatted.replace(/\r\n?/g, "\n").replace(/\t/g, " ")
    : normalizeWordTemplateLine(formatted);
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/u.test(value)) {
    throw new NativeDocumentError(`El valor de «${field.label}» contiene caracteres incompatibles con Word.`);
  }
  return documentClauseCase(field.key, value, uppercase && field.kind !== "email");
}

function resolveNativeTargets(
  segments: Segment[],
  variables: NativeVariable[],
  fields: TemplateField[],
  values: Record<string, string>,
  allowIncomplete: boolean,
  uppercase = false,
  boldPagareDate = false,
) {
  if (!variables.length || variables.length > variableLimit) throw new NativeDocumentError(invalidVariables);
  const byKey = new Map(fields.map(field => [field.key, field]));
  const expected = new Map<string, { remaining: number; value: string }>();
  let total = 0;
  for (const { key, occurrences } of variables) {
    const field = byKey.get(key);
    if (!field || !variableKey.test(key) || expected.has(key) || !Number.isInteger(occurrences) || occurrences < 1) {
      throw new NativeDocumentError(invalidVariables);
    }
    total += occurrences;
    if (total > occurrenceLimit) throw new NativeDocumentError(invalidVariables);
    const value = formatWordTemplateValue(field, Object.hasOwn(values, key) ? values[key] : "", uppercase);
    if (!value && field.required && !allowIncomplete) throw new NativeDocumentError(`Completa el campo «${field.label}».`);
    expected.set(key, { remaining: occurrences, value });
  }

  const bySegment = new Map<Segment, Replacement[]>();
  for (const segment of segments) {
    const edits: Replacement[] = [];
    for (const match of segment.text.matchAll(variableToken)) {
      const field = expected.get(match[1]);
      if (!field || field.remaining === 0) throw new NativeDocumentError(invalidVariables);
      field.remaining--;
      const prefix = segment.text.slice(0, match.index);
      const value = prefix.endsWith("RD$") && field.value.startsWith("RD$") ? field.value.slice(3) : field.value;
      const runs = pagareDateRuns(match[1], value, boldPagareDate);
      const range = value
        ? { start: match.index, end: match.index + match[0].length }
        : emptyLabelRange(match[1], segment.text, match.index, match.index + match[0].length);
      edits.push({
        segment,
        ...range,
        value,
        bold: isBoldAddressField(match[1]),
        ...(runs && { runs }),
      });
    }
    if (edits.length) bySegment.set(segment, edits.reverse());
  }
  if ([...expected.values()].some(field => field.remaining !== 0)) throw new NativeDocumentError(invalidVariables);
  return bySegment;
}

const rPrAfterBold = new Set([
  "bCs", "i", "iCs", "caps", "smallCaps", "strike", "dstrike", "outline", "shadow", "emboss", "imprint",
  "noProof", "snapToGrid", "vanish", "webHidden", "color", "spacing", "w", "kern", "position",
  "sz", "szCs", "highlight", "u", "effect", "bdr", "shd", "fitText", "vertAlign", "rtl", "cs", "em", "lang",
]);

function isRunBold(run: Element) {
  const rPr = wordChildren(run, "rPr")[0];
  if (!rPr) return false;
  const b = wordChildren(rPr, "b")[0];
  if (!b) return false;
  const val = b.getAttributeNS(run.namespaceURI, "val") ?? b.getAttribute("w:val") ?? b.getAttribute("val");
  return val !== "0" && val !== "false";
}

function ensureRunBold(run: Element) {
  const ns = run.namespaceURI;
  const prefix = run.prefix;
  const qName = (name: string) => (prefix ? `${prefix}:${name}` : name);
  let rPr = wordChildren(run, "rPr")[0];
  if (!rPr) {
    rPr = run.ownerDocument.createElementNS(ns, qName("rPr"));
    run.insertBefore(rPr, run.firstChild);
  }
  const existing = wordChildren(rPr, "b")[0];
  if (existing) {
    existing.removeAttributeNS(ns, "val");
    existing.removeAttribute("w:val");
    existing.removeAttribute("val");
    return;
  }
  const b = run.ownerDocument.createElementNS(ns, qName("b"));
  const before = Array.from(rPr.children).find(child => child.namespaceURI === ns && rPrAfterBold.has(child.localName)) ?? null;
  rPr.insertBefore(b, before);
}

function cloneRunWithText(sourceRun: Element, sourceTextNode: Element, value: string, bold: boolean) {
  const clone = sourceRun.cloneNode(false) as Element;
  const rPr = wordChildren(sourceRun, "rPr")[0];
  if (rPr) clone.appendChild(rPr.cloneNode(true));
  const textClone = sourceTextNode.cloneNode(false) as Element;
  clone.appendChild(textClone);
  if (bold) ensureRunBold(clone);
  writeWordText(textClone, value);
  return clone;
}

function writeWordText(node: Element, value: string) {
  const [first, ...rest] = value.split("\n");
  const setText = (target: Element, text: string) => {
    target.textContent = text;
    if (/^\s|\s$/.test(text)) {
      target.setAttributeNS("http://www.w3.org/XML/1998/namespace", "xml:space", "preserve");
    } else {
      target.removeAttributeNS("http://www.w3.org/XML/1998/namespace", "space");
    }
  };
  setText(node, first);
  if (!rest.length) return;
  const parent = node.parentNode!;
  const next = node.nextSibling;
  const breakName = node.prefix ? `${node.prefix}:br` : "br";
  for (const line of rest) {
    parent.insertBefore(node.ownerDocument.createElementNS(node.namespaceURI, breakName), next);
    const continuation = node.cloneNode(false) as Element;
    setText(continuation, line);
    parent.insertBefore(continuation, next);
  }
}

function replaceInSegment(segment: Segment, edits: Replacement[]) {
  // Applying ranges right to left preserves the offsets of ranges still to edit.
  for (const { start, end, value, bold, runs } of edits) {
    let wroteValue = false;
    for (const text of segment.nodes) {
      if (text.start >= end || text.end <= start) continue;
      const current = text.node.textContent ?? "";
      const prefix = current.slice(0, Math.max(0, start - text.start));
      const suffix = current.slice(Math.min(text.end, end) - text.start);
      const inserted = wroteValue ? "" : value;
      const run = text.node.parentElement;
      const splitRuns = inserted ? (runs ?? (bold ? [{ text: inserted, bold: true }] : undefined)) : undefined;
      if (splitRuns?.length && run?.localName === "r" && run.parentNode && !isRunBold(run)) {
        const anchor = run.nextSibling;
        if (!prefix && !suffix && splitRuns.length === 1) {
          writeWordText(text.node, splitRuns[0].text);
          if (splitRuns[0].bold) ensureRunBold(run);
        } else if (prefix) {
          writeWordText(text.node, prefix);
          for (const part of splitRuns) {
            run.parentNode.insertBefore(cloneRunWithText(run, text.node, part.text, part.bold), anchor);
          }
          if (suffix) run.parentNode.insertBefore(cloneRunWithText(run, text.node, suffix, false), anchor);
        } else {
          const [first, ...rest] = splitRuns;
          writeWordText(text.node, first.text);
          if (first.bold) ensureRunBold(run);
          for (const part of rest) {
            run.parentNode.insertBefore(cloneRunWithText(run, text.node, part.text, part.bold), anchor);
          }
          if (suffix) run.parentNode.insertBefore(cloneRunWithText(run, text.node, suffix, false), anchor);
        }
      } else {
        writeWordText(text.node, prefix + inserted + suffix);
      }
      wroteValue = true;
    }
  }
}

function wordChildren(parent: Element, name: string) {
  return Array.from(parent.children).filter(child => child.namespaceURI === parent.namespaceURI && child.localName === name);
}

function wordText(element: Element) {
  return Array.from(element.getElementsByTagNameNS(element.namespaceURI, "t"), node => node.textContent).join("");
}

function wordAttribute(element: Element, name: string, value: string) {
  element.setAttributeNS(element.namespaceURI, element.prefix ? `${element.prefix}:${name}` : name, value);
}

function fixSaleTableLayout(table: Element) {
  const body = table.parentElement;
  if (body?.localName !== "body") return;
  const description = wordChildren(body, "tbl").find(candidate => candidate !== table &&
    /^DESCRIPCIÓN DEL MUEBLE/i.test(wordText(candidate).trim()));
  if (!description) return;
  const clause = wordChildren(body, "p").find(paragraph => /^CLÁUSULA PRIMERA/i.test(wordText(paragraph).trim()));
  const paymentProperties = wordChildren(table, "tblPr")[0];
  const descriptionProperties = wordChildren(description, "tblPr")[0];
  const position = paymentProperties && wordChildren(paymentProperties, "tblpPr")[0];
  const alignment = descriptionProperties && wordChildren(descriptionProperties, "jc")[0];
  if (!position || !alignment || !clause) return;

  const widths = [960, 1477, 1771];
  for (const [target, columns] of [[table, widths], [description, [5954]]] as const) {
    const properties = wordChildren(target, "tblPr")[0];
    const tableWidth = wordChildren(properties, "tblW")[0];
    const grid = wordChildren(target, "tblGrid")[0];
    if (!tableWidth || !grid || wordChildren(grid, "gridCol").length !== columns.length) return;
  }

  for (const [target, columns] of [[table, widths], [description, [5954]]] as const) {
    const properties = wordChildren(target, "tblPr")[0];
    const tableWidth = wordChildren(properties, "tblW")[0];
    const total = columns.reduce((sum, width) => sum + width, 0);
    wordAttribute(tableWidth, "type", "dxa");
    wordAttribute(tableWidth, "w", String(total));
    const grid = wordChildren(target, "tblGrid")[0];
    wordChildren(grid, "gridCol").forEach((column, index) => wordAttribute(column, "w", String(columns[index])));
    for (const row of wordChildren(target, "tr")) {
      const cells = wordChildren(row, "tc");
      cells.forEach((cell, index) => {
        const cellProperties = wordChildren(cell, "tcPr")[0];
        const width = cellProperties && wordChildren(cellProperties, "tcW")[0];
        if (width && (cells.length === 1 || cells.length === columns.length)) {
          wordAttribute(width, "w", String(cells.length === 1 ? total : columns[index]));
        }
      });
    }
    const layout = wordChildren(properties, "tblLayout")[0] ??
      target.ownerDocument.createElementNS(target.namespaceURI, target.prefix ? `${target.prefix}:tblLayout` : "tblLayout");
    if (!layout.parentNode) properties.insertBefore(layout, wordChildren(properties, "tblLook")[0] ?? null);
    wordAttribute(layout, "type", "fixed");
  }

  // Writer needs an explicit right alignment and a text-relative anchor to wrap the adjacent content.
  wordAttribute(alignment, "val", "right");
  wordAttribute(position, "vertAnchor", "text");
  wordAttribute(position, "tblpY", "380");
  body.insertBefore(table, clause);
}

function expandSalePaymentRows(replacements: Map<Segment, Replacement[]>, forPdf: boolean) {
  const columns = salePaymentColumns.map(key => [...replacements].filter(([segment, edits]) =>
    (segment.text === `{{${key}}}` || segment.text === fieldToken(key)) && edits.length === 1));
  if (columns.some(matches => matches.length !== 1)) return;
  const entries = columns.map(matches => matches[0]);
  const cells = entries.map(([segment]) => segment.nodes[0].node.closest("tc"));
  const row = cells[0]?.parentElement;
  const table = row?.parentElement;
  if (!row || row.localName !== "tr" || table?.localName !== "tbl") return;
  const rowCells = wordChildren(row, "tc");
  if (rowCells.length !== entries.length || cells.some((cell, index) => {
    if (!cell || cell !== rowCells[index] || wordText(cell) !== entries[index][0].text) return true;
    const paragraphs = wordChildren(cell, "p");
    return paragraphs.length !== 1 || paragraphs[0].querySelector("bookmarkStart, bookmarkEnd, drawing, pict, hyperlink, fldChar, sdt, commentReference");
  })) return;

  const lines = entries.map(([, edits]) => edits[0].value.split("\n"));
  const count = lines[0].length;
  if (lines.some(column => column.length !== count)) return;
  for (let index = 0; index < count; index++) {
    const copy = row.cloneNode(true) as Element;
    const copyCells = wordChildren(copy, "tc");
    entries.forEach(([segment, [edit]], column) => {
      const originalNodes = Array.from(rowCells[column].getElementsByTagNameNS(row.namespaceURI, "t"));
      const copiedNodes = Array.from(copyCells[column].getElementsByTagNameNS(row.namespaceURI, "t"));
      const copiedSegment = { ...segment, nodes: segment.nodes.map(text => ({ ...text, node: copiedNodes[originalNodes.indexOf(text.node)] })) };
      replaceInSegment(copiedSegment, [{ ...edit, value: lines[column][index] }]);
    });
    if (index > 0) {
      for (const paragraph of Array.from(copy.getElementsByTagNameNS(row.namespaceURI, "p"))) {
        const word2010 = "http://schemas.microsoft.com/office/word/2010/wordml";
        paragraph.removeAttributeNS(word2010, "paraId");
        paragraph.removeAttributeNS(word2010, "textId");
      }
    }
    table.insertBefore(copy, row);
  }
  row.remove();
  entries.forEach(([segment]) => replacements.delete(segment));
  if (forPdf) fixSaleTableLayout(table);
  return entries[0][0].part;
}

async function unpackOriginalWord(original: Blob) {
  if (original.size > fileLimit) throw new NativeDocumentError("El archivo supera el tamaño máximo de generación.");
  const { unzipSync } = await import("fflate");
  try {
    const names = new Set<string>();
    let expanded = 0;
    const files = unzipSync(new Uint8Array(await original.arrayBuffer()), {
      filter(entry) {
        expanded += entry.originalSize;
        if (names.has(entry.name) || /(?:^|\/)(?:\.\.|__proto__|constructor|prototype)(?:\/|$)|[\\\u0000]|^\//.test(entry.name) ||
            names.size >= 4096 || expanded > zipLimit || (wordParts.test(entry.name) && entry.originalSize > xmlLimit)) {
          throw new Error("Unsupported Word archive");
        }
        names.add(entry.name);
        return true;
      },
    });
    if (!files["[Content_Types].xml"] || !files["word/document.xml"] ||
        Object.keys(files).some(name => /^_xmlsignatures\//i.test(name))) {
      throw new Error("Unsupported Word package");
    }
    return files;
  } catch {
    throw new NativeDocumentError("El Word original está dañado, firmado o tiene una estructura que no podemos editar.");
  }
}

function parseWordPart(bytes: Uint8Array) {
  let xml: string;
  try { xml = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { throw new NativeDocumentError("El Word original usa una codificación XML incompatible."); }
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new NativeDocumentError("El Word contiene una estructura XML incompatible.");
  const part = new DOMParser().parseFromString(xml, "application/xml");
  if (part.getElementsByTagName("parsererror").length) throw new NativeDocumentError("El XML del Word original está dañado.");
  return part;
}

export async function fillOriginalWord(
  original: Blob, markdown: string, fields: TemplateField[], values: Record<string, string>,
  nativeVariables: NativeVariable[] | null = null,
  allowIncomplete = false,
  conditionalSale?: "docx" | "pdf",
  uppercase = false,
  boldPagareDate = false,
) {
  if (original.size > fileLimit) throw new NativeDocumentError("El archivo supera el tamaño máximo de generación.");
  if (!nativeVariables && !fields.length) return new Blob([original], { type: wordMime });

  const files = await unpackOriginalWord(original);
  const parts = new Map<string, Document>();
  const segments: Segment[] = [];
  for (const [name, bytes] of Object.entries(files)) {
    if (!wordParts.test(name)) continue;
    const part = parseWordPart(bytes);
    parts.set(name, part);
    segments.push(...wordSegments(part, name, nativeVariables !== null));
  }
  const replacements = nativeVariables
    ? resolveNativeTargets(segments, nativeVariables, fields, values, allowIncomplete, uppercase, boldPagareDate)
    : resolveTargets(segments, markdown, fields, values, uppercase, boldPagareDate);
  const changed = new Set<string>();
  const paymentPart = conditionalSale && expandSalePaymentRows(replacements, conditionalSale === "pdf");
  if (paymentPart) changed.add(paymentPart);
  if (conditionalSale === "pdf" && !paymentPart) {
    const firstDueDate = "{{fecha_de_vencimiento_de_la_cuota_1}}";
    const firstPayment = segments.find(segment => segment.text.includes(firstDueDate));
    const table = firstPayment?.nodes[0].node.closest("tbl");
    if (firstPayment && table) {
      fixSaleTableLayout(table);
      changed.add(firstPayment.part);
    }
  }
  for (const [segment, edits] of replacements) {
    replaceInSegment(segment, edits);
    changed.add(segment.part);
  }

  const encoder = new TextEncoder();
  const serializer = new XMLSerializer();
  for (const name of changed) files[name] = encoder.encode(serializer.serializeToString(parts.get(name)!));
  const { zipSync } = await import("fflate");
  const result = zipSync(files, { level: 3, mtime: new Date(1980, 0, 1) });
  if (result.byteLength > fileLimit) throw new NativeDocumentError("El Word generado supera el tamaño máximo del historial.");
  return new Blob([result], { type: wordMime });
}

async function downloadOriginal(contractId: string, accountId: string) {
  const { url } = await getContractDownload(contractId, accountId);
  const response = await fetch(url, { cache: "no-store", credentials: "omit" });
  if (!response.ok || !response.body) throw new NativeDocumentError("No se pudo cargar el archivo original. Vuelve a intentarlo.");
  const reader = response.body.getReader();
  const parts: BlobPart[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > fileLimit) {
        await reader.cancel();
        throw new NativeDocumentError("El archivo original supera el tamaño máximo de generación.");
      }
      parts.push(Uint8Array.from(chunk.value));
    }
  } finally {
    reader.releaseLock();
  }
  return new Blob(parts, { type: response.headers.get("content-type") ?? "" });
}

async function readContractText(contractId: string, accountId: string) {
  const part = "word/document.xml";
  const files = await unpackOriginalWord(await downloadOriginal(contractId, accountId));
  return wordSegments(parseWordPart(files[part]), part, false).map(segment => segment.text);
}

export function extractSalesCommitment(paragraphs: readonly string[], values: Record<string, string>) {
  let clause: string | undefined;
  for (const paragraph of paragraphs) {
    const start = paragraph.search(/\bse\s+compromete\b/iu);
    if (start < 0) continue;
    const end = Array.from(paragraph.matchAll(/\bpactadas\b/giu)).at(-1);
    if (!end || end.index <= start) continue;
    if (clause) throw new NativeDocumentError("El Word de la venta contiene más de una cláusula de compromiso. Confirma el Word de la operación.");
    clause = paragraph.slice(start, end.index + end[0].length);
  }
  if (!clause) throw new NativeDocumentError("No se encontró la cláusula entre «se compromete» y «pactadas» en el Word de la venta.");

  return clause.replace(variableToken, (_token, key: string | undefined) => {
    if (!key) throw new NativeDocumentError(invalidVariables);
    const input = Object.hasOwn(values, key) ? values[key] : "";
    if (!input.trim()) throw new NativeDocumentError(`Completa el marcador «${key}» en el expediente para usar la cláusula de la venta.`);
    const field: TemplateField = key.startsWith("fecha_")
      ? { key, label: key, required: true, kind: "date", dateStyle: "long" }
      : { key, label: key, required: true, kind: "text" };
    return normalizeWordTemplateLine(formatWordTemplateValue(field, input));
  });
}

export async function readSalesCommitmentFromContract(contractId: string, accountId: string, values: Record<string, string>) {
  return extractSalesCommitment(await readContractText(contractId, accountId), values);
}

export async function hasInsuranceIssuerInContract(contractId: string, accountId: string) {
  return (await readContractText(contractId, accountId)).some(hasInsuranceCompanyNameInText);
}

export async function prepareNativeDocument(input: {
  accountId: string; contractId: string; companyId?: string; operationId?: string; sourceFormat: DocumentFormat; output: DocumentFormat;
  markdown: string; fields: TemplateField[]; values: Record<string, string>; nativeVariables: NativeVariable[] | null;
  allowIncomplete?: boolean;
  conditionalSale?: boolean;
  uppercase?: boolean;
  boldPagareDate?: boolean;
}) {
  const { accountId, contractId, sourceFormat, output, markdown, fields, values, nativeVariables } = input;
  if (sourceFormat === "pdf") {
    if (fields.length) throw new NativeDocumentError("Para sustituir campos conservando el diseño, carga el contrato original en Word (.docx).");
    if (output !== "pdf") throw new NativeDocumentError("El archivo original está en PDF. Selecciona PDF para conservar su diseño.");
    const original = await downloadOriginal(contractId, accountId);
    if (await original.slice(0, 5).text() !== "%PDF-") throw new NativeDocumentError("El archivo original no es un PDF válido.");
    return new Blob([original], { type: "application/pdf" });
  }

  const original = await downloadOriginal(contractId, accountId);
  const word = await fillOriginalWord(original, markdown, fields, values, nativeVariables, input.allowIncomplete, input.conditionalSale ? output : undefined, input.uppercase, input.boldPagareDate);
  if (output === "docx") return word;
  const pdf = await renderContractPdf(contractId, accountId, word, input.companyId, input.operationId);
  if (pdf.type !== "application/pdf" || !pdf.size) throw new ApiError(502, "INVALID_RENDERED_PDF", "The renderer did not return a PDF");
  return pdf;
}
