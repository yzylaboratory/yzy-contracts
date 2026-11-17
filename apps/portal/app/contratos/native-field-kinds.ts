import { cedulaWords, integerWords, notarialMoneyWords } from "./expediente-fields";
import { type TemplateField, type TemplateFieldType } from "./template-fields";

/** Infers the data type of a Word variable from its name, so each one gets its own mask. */
export function nativeFieldKind(key: string): TemplateFieldType {
  // Las fechas en letras («fecha_..._letras») ya vienen escritas desde el plan de pagos.
  if (key.endsWith("_letras")) return "text";
  if (/^fecha(?:_|$)/.test(key)) return "date";
  if (key === "numero_de_chasis_del_vehiculo" || key === "numero_de_serie_del_motor") return "text";
  if (/cedula/.test(key)) return "identity";
  if (/telefono/.test(key)) return "phone";
  if (/correo|email/.test(key)) return "email";
  if (/(?:^|_)(?:monto|total|saldo)(?:_|$)/.test(key)) return "money";
  if (/^(?:numero|cantidad)_/.test(key) || /^vehiculo_an(?:i)?o$/.test(key)) return "integer";
  return "text";
}

/** Minor units from a stored money value such as "RD$25,000.00" or notarial "… (RD$25,000.00)". */
export function moneyMinor(value: string | undefined) {
  const match = value?.trim().match(/RD\$\d{1,3}(?:,\d{3})*\.\d{2}/);
  if (!match) return null;
  return Math.round(Number(match[0].replace(/[^\d.]/g, "")) * 100);
}

/** Variables ending in _letras are written out from their numeric pair instead of being typed. */
export function wordsSource(key: string, fields: readonly TemplateField[]) {
  if (!key.endsWith("_letras")) return undefined;
  const base = key.slice(0, -"_letras".length);
  return fields.find(field => field.key === base && field.kind !== "text");
}

export function wordsFor(source: TemplateField, value: string | undefined) {
  const text = value?.trim() ?? "";
  if (source.kind === "money") {
    const minor = moneyMinor(text);
    return minor === null ? "" : notarialMoneyWords(minor);
  }
  if (source.kind === "integer") {
    return /^\d+$/.test(text)
      ? integerWords(Number(text)).normalize("NFD").replace(/\p{M}/gu, "").toUpperCase()
      : "";
  }
  if (source.kind === "identity") {
    const words = cedulaWords(text);
    return words ? words.toUpperCase() : "";
  }
  return "";
}

export type FieldSection = "dates" | "client" | "vehicle" | "financing" | "extraordinary" | "other";

export const fieldSectionTitles: Record<FieldSection, string> = {
  dates: "Fechas del contrato",
  client: "Datos del cliente",
  vehicle: "Vehículo",
  financing: "Financiamiento",
  extraordinary: "Abonos extraordinarios",
  other: "Otros datos",
};

const sectionOrder: FieldSection[] = ["dates", "client", "vehicle", "financing", "extraordinary", "other"];

/** Groups contract variables by what they describe, so the form reads in the order a sale is negotiated. */
export function fieldSection(key: string): FieldSection {
  if (/abono/.test(key)) return "extraordinary";
  if (key === "empresa_mora_diaria_porcentaje" || key === "porcentaje_de_mora_diaria_sobre_la_cuota"
    || /cuota|financiamiento|capital|saldo|interes/.test(key)) return "financing";
  if (key.startsWith("cliente_")) return "client";
  if (key.startsWith("vehiculo_")) return "vehicle";
  if (key.startsWith("fecha_")) return "dates";
  return "other";
}

/** Within a section: totals first, then numbered items by index, then date before number before amount. */
function fieldRank(key: string) {
  const numbered = /_(\d+)(?:_|$)/.exec(key)?.[1];
  const role = /^total_|^cantidad_/.test(key) ? 0
    : /cuotas_intereses/.test(key) ? 1
    : /^numero_/.test(key) ? 2
    : /^fecha_/.test(key) ? 3
    : /monto/.test(key) ? 4
    : 5;
  // Summaries such as "abonos_extraordinarios" follow the numbered items they describe.
  const index = numbered ? Number(numbered) : role === 5 ? Number.MAX_SAFE_INTEGER : 0;
  return [index, role] as const;
}

export function sortFieldsBySection<T extends { key: string }>(fields: readonly T[]) {
  return sectionOrder.map(section => ({
    section,
    title: fieldSectionTitles[section],
    fields: fields.filter(field => fieldSection(field.key) === section).sort((a, b) => {
      const [ai, ar] = fieldRank(a.key);
      const [bi, br] = fieldRank(b.key);
      return ai - bi || ar - br;
    }),
  })).filter(group => group.fields.length > 0);
}
