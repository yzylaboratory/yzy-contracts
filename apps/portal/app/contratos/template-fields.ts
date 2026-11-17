import { isEmailAddress } from "./document-export";
import { documentClauseCase, notarialActDate, notarialDate, wordsDate } from "./expediente-fields";

export type TemplateFieldType = "text" | "date" | "identity" | "amount" | "duration" | "email" | "money" | "integer" | "phone";
export type TemplateField = {
  key: string;
  label: string;
  kind: TemplateFieldType;
  required: boolean;
  dateStyle?: "numeric" | "long" | "notarial" | "notarialAct" | "words";
  placeholder?: string;
  width?: "wide" | "compact";
  sourceTexts?: string[];
};

const dateFormatters = {
  numeric: new Intl.DateTimeFormat("es-DO", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" }),
  long: new Intl.DateTimeFormat("es-DO", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }),
};

const keyPattern = /^[A-Z][A-Z0-9_]*$/;
const trailer = /\r?\n\r?\n<!-- yzy-template-fields:v1 ([^\s]+) -->\s*$/;
const kinds = new Set<unknown>(["text", "date", "identity", "amount", "duration", "email", "money", "integer", "phone"]);
const defaults: Record<TemplateFieldType, Pick<TemplateField, "placeholder" | "width">> = {
  text: {},
  date: { width: "compact" },
  identity: { placeholder: "000-0000000-0…" },
  amount: { placeholder: "0.00…", width: "compact" },
  duration: { placeholder: "12…", width: "compact" },
  email: { placeholder: "nombre@correo.com…" },
  money: { width: "compact" },
  integer: { placeholder: "0", width: "compact" },
  phone: { placeholder: "XXX-XXX-XXXX", width: "compact" },
};

/** Pesos as the documents print them: RD$25,000.00, optionally with words before or after. */
export const moneyPattern = /^(?:RD\$\d{1,3}(?:,\d{3})*\.\d{2}(?: \(.+\))?|.+ \(RD\$\d{1,3}(?:,\d{3})*\.\d{2}\))$/;
const legacy: Record<string, Pick<TemplateField, "label"> & Partial<TemplateField>> = {
  ARRENDADOR: { label: "Nombre del arrendador", placeholder: "Nombre completo…" },
  CEDULA_ARRENDADOR: { label: "Cédula del arrendador", kind: "identity" },
  ARRENDATARIO: { label: "Nombre del arrendatario", placeholder: "Nombre completo…" },
  CEDULA_ARRENDATARIO: { label: "Cédula del arrendatario", kind: "identity" },
  DIRECCION: { label: "Dirección del inmueble", placeholder: "Calle, número, sector, ciudad…", width: "wide" },
  MONTO: { label: "Monto mensual", kind: "amount" },
  FECHA_INICIO: { label: "Fecha de inicio", kind: "date" },
  DURACION: { label: "Duración (meses)", kind: "duration" },
};

function cleanDefinition(value: unknown): TemplateField | undefined {
  if (!value || typeof value !== "object") return;
  const { key, label, kind, required, placeholder, width, sourceTexts } = value as Partial<TemplateField>;
  if (typeof key !== "string" || !keyPattern.test(key) || typeof label !== "string" || !label.trim() ||
      !kind || !kinds.has(kind) || typeof required !== "boolean") return;
  return {
    key,
    label: label.trim(),
    kind,
    required,
    ...(typeof placeholder === "string" ? { placeholder } : {}),
    ...(width === "wide" || width === "compact" ? { width } : {}),
    ...(Array.isArray(sourceTexts) && sourceTexts.every(text => typeof text === "string" && text.length <= 1000 && !/[\r\n]/.test(text))
      ? { sourceTexts }
      : {}),
  };
}

export function parseTemplate(content: string): { markdown: string; definitions: TemplateField[] } {
  const match = trailer.exec(content);
  if (match) {
    try {
      const definitions: unknown = JSON.parse(decodeURIComponent(match[1]));
      if (Array.isArray(definitions)) {
        return { markdown: content.slice(0, match.index), definitions: definitions.flatMap(value => cleanDefinition(value) ?? []) };
      }
    } catch {
      // Preserve the original content if a footer cannot be read.
    }
  }
  return { markdown: content, definitions: [] };
}

export function serializeTemplate(markdown: string, definitions: TemplateField[]) {
  const explicit = new Map(definitions.map(field => [field.key, field]));
  const used = getTemplateFields(markdown, []).flatMap(({ key }) => {
    const field = cleanDefinition(explicit.get(key));
    return field ? [field] : [];
  });
  const payload = encodeURIComponent(JSON.stringify(used)).replaceAll("-", "%2D");
  return used.length ? `${markdown}\n\n<!-- yzy-template-fields:v1 ${payload} -->` : markdown;
}

export function fieldToken(key: string) {
  return `[${key}]`;
}

export function countTemplateFields(markdown: string) {
  const counts = new Map<string, number>();
  for (const { key } of scanTemplate(markdown).markers) counts.set(key, (counts.get(key) ?? 0) + 1);
  return counts;
}

export function createFieldKey(label: string, existingKeys: Iterable<string>, markdown = "") {
  const taken = new Set(existingKeys);
  const { references } = scanTemplate(markdown);
  const normalized = label.normalize("NFKD").replace(/\p{M}/gu, "").toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  const base = /^[A-Z]/.test(normalized) ? normalized.slice(0, 64).replace(/_$/, "") : `CAMPO${normalized ? `_${normalized.slice(0, 57).replace(/_$/, "")}` : ""}`;
  let key = base;
  for (let suffix = 2; taken.has(key) || references.has(referenceKey(key)); suffix++) key = `${base}_${suffix}`;
  return key;
}

type Marker = { key: string; start: number; end: number };

function referenceKey(text: string) {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

/** Locate placeholders in prose while leaving links, references and code alone. */
function scanTemplate(markdown: string) {
  const references = new Set<string>();
  const chunks: { text: string; start: number }[] = [];
  let fence: string | undefined;
  let chunkStart = 0;
  let offset = 0;
  let indentedCode = false;
  let previousBlank = true;
  for (const line of markdown.split("\n")) {
    const prose = line.replace(/^(?: {0,3}>[ \t]?)+/, "");
    const possibleFence = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(prose);
    const delimiter = possibleFence && (fence || possibleFence[1][0] === "~" || !possibleFence[2].includes("`")) ? possibleFence : null;
    const reference = !fence && /^ {0,3}\[([^\]]+)\]:\s*\S/.exec(prose);
    const blank = !prose.trim();
    indentedCode = (previousBlank || indentedCode) && (blank || /^(?: {4}|\t)/.test(prose));
    if (fence || delimiter || reference || blank || indentedCode) {
      if (offset > chunkStart) chunks.push({ text: markdown.slice(chunkStart, offset), start: chunkStart });
      chunkStart = offset + line.length + 1;
      if (delimiter) {
        if (!fence) fence = delimiter[1];
        else if (delimiter[1].startsWith(fence) && !delimiter[2].trim()) fence = undefined;
      }
      if (reference) references.add(referenceKey(reference[1]));
    }
    previousBlank = blank;
    offset += line.length + 1;
  }
  if (chunkStart < markdown.length) chunks.push({ text: markdown.slice(chunkStart), start: chunkStart });
  return { markers: chunks.flatMap(({ text, start }) => scanProse(text, start, references)), references };
}

function scanProse(text: string, offset: number, references: ReadonlySet<string>): Marker[] {
  const codeEnds = new Map<number, number>();
  const nextCode = new Map<number, number>();
  for (const run of Array.from(text.matchAll(/`+/g)).reverse()) {
    const next = nextCode.get(run[0].length);
    if (next !== undefined) codeEnds.set(run.index, next + run[0].length);
    nextCode.set(run[0].length, run.index);
  }
  for (const span of text.matchAll(/<!--[\s\S]*?(?:-->|$)|<a(?:\s[^<>]*)?>[\s\S]*?<\/a\s*>|<[a-z][a-z0-9+.-]{1,31}:[^<>\s]+>|<\/?[a-z][a-z0-9-]*(?:[ \t]+[^<>]*)?\s*\/?>/gi)) {
    codeEnds.set(span.index, span.index + span[0].length);
  }

  const pairs = new Map<number, number>();
  const brackets: number[] = [];
  const parens: number[] = [];
  for (let index = 0; index < text.length; index++) {
    const codeEnd = codeEnds.get(index);
    if (text[index] === "\\") index++;
    else if (codeEnd !== undefined) index = codeEnd - 1;
    else if (text[index] === "[") brackets.push(index);
    else if (text[index] === "(") parens.push(index);
    else if (text[index] === "]" || text[index] === ")") {
      const start = (text[index] === "]" ? brackets : parens).pop();
      if (start !== undefined) pairs.set(start, index);
    }
  }

  const markers: Marker[] = [];
  for (let index = 0; index < text.length; index++) {
    const codeEnd = codeEnds.get(index);
    if (text[index] === "\\") { index++; continue; }
    if (codeEnd !== undefined) { index = codeEnd - 1; continue; }
    const end = pairs.get(index);
    if (text[index] !== "[" || end === undefined) continue;
    const label = text.slice(index + 1, end);
    const following = end + 1;
    const destination = pairs.get(following);
    if (text[following] === "(" && destination !== undefined) { index = destination; continue; }
    if (text[following] === "[" && destination !== undefined) {
      const target = text.slice(following + 1, destination);
      if (references.has(referenceKey(target || label))) { index = destination; continue; }
    }
    if (references.has(referenceKey(label))) { index = end; continue; }
    if (keyPattern.test(label)) {
      markers.push({ key: label, start: offset + index, end: offset + end + 1 });
      index = end;
    }
  }
  return markers;
}

export function getTemplateFields(markdown: string, definitions: TemplateField[]): TemplateField[] {
  const fields = new Map(definitions.map(field => [field.key, field]));
  return Array.from(new Set(scanTemplate(markdown).markers.map(marker => marker.key)), key => {
    const field = fields.get(key) ?? legacy[key];
    const kind = field?.kind ?? "text";
    const words = key.toLowerCase().replaceAll("_", " ");
    return { ...defaults[kind], ...field, key, kind, label: field?.label ?? words.charAt(0).toUpperCase() + words.slice(1), required: field?.required ?? true };
  });
}

function parseCalendarDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000")) return;
  const date = new Date(value);
  if (Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value) return date;
}

export function validateTemplateField(field: TemplateField, input: string): string | undefined {
  const value = input.trim();
  if (!value) return field.required ? "Completa este campo." : undefined;
  switch (field.kind) {
    case "identity":
      if (!/^(?:\d{11}|\d{3}-\d{7}-\d)$/.test(value)) return "Escribe 11 dígitos en el formato 000-0000000-0.";
      break;
    case "amount": {
      const amount = Number(value.replace(",", "."));
      if (!/^\d+(?:[.,]\d{1,2})?$/.test(value) || !Number.isFinite(amount) || amount <= 0) return "Escribe un monto mayor que cero con hasta dos decimales.";
      break;
    }
    case "duration":
      if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) <= 0) return "Escribe un número entero mayor que cero.";
      break;
    case "date":
      if (!parseCalendarDate(value)) return "Selecciona una fecha válida.";
      break;
    case "email":
      if (!isEmailAddress(value)) return "Escribe una dirección de correo válida.";
      break;
    case "money":
      if (!moneyPattern.test(value)) return "Escribe el monto en pesos, por ejemplo RD$25,000.00.";
      break;
    case "integer":
      if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) return "Escribe un número entero.";
      break;
    case "phone":
      if (value.replace(/\D/g, "").length < 7 || !/^[\d\s()+-]+$/.test(value)) return "Escribe un teléfono en el formato XXX-XXX-XXXX.";
      break;
  }
}

function escapeValue(value: string) {
  return value.replace(/[\r\n]+/g, " ").replaceAll("\0", "").replace(/[\\`*_~\[\]<>!#()+.|-]/g, "\\$&");
}

export function formatTemplateValue(field: TemplateField, input: string) {
  const value = input.trim();
  if (field.kind === "date" && field.dateStyle) {
    const date = parseCalendarDate(value);
    if (date) {
      if (field.dateStyle === "notarial") return notarialDate(date);
      if (field.dateStyle === "notarialAct") return notarialActDate(date);
      if (field.dateStyle === "words") return wordsDate(date);
      return dateFormatters[field.dateStyle].format(date);
    }
  }
  const formatted = field.kind === "identity" ? value.replace(/^(\d{3})(\d{7})(\d)$/, "$1-$2-$3") : value;
  return field.kind === "text" ? documentClauseCase(field.key, formatted) : formatted;
}

export function fillTemplate(markdown: string, fields: TemplateField[], values: Record<string, string>, preview = false) {
  const byKey = new Map(fields.map(field => [field.key, field]));
  let cursor = 0;
  const result: string[] = [];
  for (const marker of scanTemplate(markdown).markers) {
    const field = byKey.get(marker.key);
    if (!field) continue;
    result.push(markdown.slice(cursor, marker.start));
    const value = formatTemplateValue(field, values[field.key] ?? "");
    if (value) result.push(escapeValue(value));
    else if (field.required) result.push(preview ? `⟪${escapeValue(field.label)} pendiente⟫` : fieldToken(field.key));
    cursor = marker.end;
  }
  result.push(markdown.slice(cursor));
  return result.join("");
}
