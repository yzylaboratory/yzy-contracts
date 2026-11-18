import type { Vehicle } from "../clientes/clients-api";
import { expedienteVehicleDescription, integerWords } from "./expediente-fields";
import { parseCalendarDate } from "./template-fields";

// Match the reviewed document body, independent of ZIP metadata and compression.
// Other company templates continue to use their own formatting rules.
const referenceBodies = {
  "5d6918b1588ef94fb1ad633bcb00d245122caf2dd5993e0e0f6b3e4da7d35280": "acto_seguro",
  "cf8216494ad552aa8d03d0a484a4e829c335a5fef046cf83a3b87a462c4f1e05": "acuerdo_seguro",
  "d37e4ec88b8ff81719bab4031b5d09244471dd650cdd95c910d79c3ace89a9ab": "autorizacion_asegurar_vehiculo",
  "cb246c5ce9409d04c5a55d7bfa9a4b23d13138c0c5c03f7785fd902a6e4f3996": "autorizacion_data",
  "4d138e87c94b8567939a0d3d623de1b085abf7351caa18e3bc60a77418e27caf": "autorizacion_desembolso",
  "3794dc19e193d55ddc3c0cb6610f2e1d2fc463971c0b7b78c9ec3e4fd3abfd3f": "declaracion_jurada",
  "8e807b9c3c346dc42add2cb71bd42a81fb3d0b17d4e531e8f2ed999d0b00044e": "designacion_cuenta",
  "4ccb16fabb3aea6334cb6270a4ea643c8900a7070f136fff558c3ee3ceda36bf": "entrega_vehiculo",
  "7e0b47967dc2253efa9bdf13d05db622dd11a58e5468d0f66c6f28815c98d43e": "entrega_vehiculo_fines_saldo",
  "b29dd5ce416751e4d8363b4d4dd7d06b4644453deb93ea7f74098acb5e433203": "entrega_voluntaria",
  "f11a1c8ebfa3c240b73be9f3b67c82babebcfae208b47255643410f1c1e79a73": "gps",
  "2901ced0150abf697fcbf27b7e503bcda6ec057023b4af368b06f4434b2b9bc2": "levantamiento_oposicion",
  "7e2d07e1226bf73bd56f89123e85bfe6d0428f35874627dce39ab12e6c3632cc": "pagare_autentico",
  "6b9348dd921fa0ed61110281dcb23fae4627989aa13ce60b229700b0547690e8": "pagare_seguro",
  "32b7490417d0436b5f9bf9ad88d02f7e4b74b049bb02a51875d38c571e4b0609": "venta_condicional",
} as const;

type Reference = typeof referenceBodies[keyof typeof referenceBodies];

const insuranceSaleBody = "328a97c6e921ddcae84915672fb964aae645af1c4621a7ba736009963bd091d0";

export async function identifyReviewedWordBody(body: Uint8Array<ArrayBufferLike>): Promise<Reference | "venta_condicional_seguro" | undefined> {

  if (!globalThis.crypto?.subtle) return undefined;
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(body));
  const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
  if (hash === insuranceSaleBody) return "venta_condicional_seguro";
  return Object.hasOwn(referenceBodies, hash) ? referenceBodies[hash as keyof typeof referenceBodies] : undefined;
}

export async function identifyReferenceWord(body: Uint8Array<ArrayBufferLike>): Promise<Reference | undefined> {
  const key = await identifyReviewedWordBody(body);
  return key === "venta_condicional_seguro" ? undefined : key;
}

const month = new Intl.DateTimeFormat("es-DO", { month: "long", timeZone: "UTC" });
const numericDate = new Intl.DateTimeFormat("es-DO", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });

function referenceDate(model: Reference, key: string, date: Date, occurrence: number) {
  const day = date.getUTCDate();
  const year = date.getUTCFullYear();
  const monthName = month.format(date);
  const dayWords = integerWords(day).toLocaleUpperCase("es");
  const monthUpper = monthName.toLocaleUpperCase("es");
  const dayNumber = String(day).padStart(2, "0");
  if (key === "fecha_firma") {
    if (model === "autorizacion_desembolso" || model === "autorizacion_asegurar_vehiculo") return numericDate.format(date);
    if (model === "entrega_vehiculo_fines_saldo" && occurrence === 0) {
      return `los ${dayWords} (${dayNumber}) DÍAS DEL MES DE ${monthUpper} DEL AÑO ${integerWords(year).toLocaleUpperCase("es")} (${year})`;
    }
    if (model === "venta_condicional") return `los ${dayWords} (${dayNumber}) DÍAS DEL MES DE ${monthUpper} DEL AÑO ${year}`;
    if (model === "entrega_vehiculo") return `los ${dayWords} (${dayNumber}) DÍAS del mes de ${monthUpper} DEL AÑO ${year}`;
    const article = model === "designacion_cuenta" || (model === "acuerdo_seguro" && occurrence === 1) ? "" : "los ";
    return `${article}${dayWords} (${dayNumber}) días del mes de ${monthUpper} del año ${year}`;
  }
  if (key === "fecha_contrato" || key === "fecha_cuota_final_capital") return numericDate.format(date);
  if (/^fecha_(?:abono_extraordinario_[12]|ancla_cuota_extraordinaria)$/.test(key)) {
    const dateText = `${day} de ${monthName} del año ${year}`;
    return model === "venta_condicional" ? dateText.toLocaleUpperCase("es") : dateText;
  }
  return `${dayWords} (${dayNumber}) DE ${monthUpper} DEL AÑO ${integerWords(year).toLocaleUpperCase("es")} (${year})`;
}

function referenceTreatment(model: Reference, input: string) {
  const match = /^(?:(?:el|la)\s+)?(sr|sra|señor|señora)\.?$/iu.exec(input.trim());
  if (!match) return input;
  const female = match[1].toLocaleLowerCase("es").endsWith("a");
  const article = female ? "la" : "el";
  const abbreviation = female ? "Sra." : "Sr.";
  if (model === "pagare_autentico") return `${article} ${female ? "señora" : "señor"}`;
  if (model === "pagare_seguro") return `${article} ${abbreviation.toUpperCase()}`;
  if (model === "entrega_voluntaria") return `${article} ${abbreviation}`;
  if (model === "autorizacion_desembolso" || model === "entrega_vehiculo_fines_saldo") return `${article} ${abbreviation}`.toUpperCase();
  return `${article.toUpperCase()} ${abbreviation}`;
}

export function reviewedVehicleDescription(vehicle: Vehicle, input: string) {
  // A free-text description supplied by the operator takes precedence.
  if (input.trim().toUpperCase() !== expedienteVehicleDescription(vehicle).toUpperCase()) return input;
  const type = vehicle.vehicle_type?.trim() ?? "";
  const article = /^(?:camioneta|furgoneta|motocicleta|miniván|jeepeta|yipeta|pasola|guagua)\b/iu.test(type) ? "una" : "un";
  const plate = vehicle.plate?.trim();
  const registration = vehicle.registration_number?.trim();
  const parts = type ? [/^(?:un|una)\s/iu.test(type) ? type : `${article} ${type}`] : [];
  const details = [
    ["Marca", vehicle.make], ["Modelo", vehicle.model], ["Año", vehicle.year], ["Color", vehicle.color],
    ["Matrícula", registration?.toUpperCase() === plate?.toUpperCase() ? undefined : registration],
    ["Placa", plate], ["Chasis", vehicle.chassis_number], ["Motor", vehicle.engine_number],
  ];
  for (const [label, value] of details) {
    if (value?.trim()) parts.push(`${label} ${value.trim()}`);
  }
  return parts.join(", ");
}

// Occurrences are counted separately for each marker in Word reading order.
export function referenceWordValue(model: Reference, key: string, occurrence: number, input: string, formatted: string) {
  if (!formatted) return "";
  const date = key.startsWith("fecha_") ? parseCalendarDate(input.trim()) : undefined;
  if (date) return referenceDate(model, key, date, occurrence);
  if (key === "fecha_primera_cuota_intereses_letras" || key === "fecha_cuota_final_capital_letras") {
    const parts = /^.+? \((\d{1,2})\) DE ([A-ZÁÉÍÓÚÑ]+) DEL AÑO .+? \((\d{4})\)$/u.exec(formatted);
    if (parts) return `${integerWords(Number(parts[1])).toLocaleUpperCase("es")} (${parts[1]}) DE ${parts[2]} DEL AÑO ${integerWords(Number(parts[3])).toLocaleUpperCase("es")} (${parts[3]})`;
  }
  if (/^abono_extraordinario_[12]_monto$/.test(key)) return formatted.replace(/^RD\$\s*/, "RD$ ");
  if (model === "venta_condicional" && key === "vehiculo_tipo") return formatted.replace(/\s+privad[oa]$/iu, "").toUpperCase();
  if (key === "cliente_tratamiento") return referenceTreatment(model, formatted);
  if (key === "cliente_correo") return input.trim();
  if (key === "cliente_ocupacion" && model === "declaracion_jurada") return formatted;
  if (/(?:nacionalidad|estado_civil|ocupacion|origen_ingresos)$/.test(key)) return formatted.toLocaleLowerCase("es");
  if (key === "cliente_nombre" && occurrence === 1 && ["venta_condicional", "acto_seguro", "designacion_cuenta"].includes(model)) return input.trim();
  if (key === "cliente_direccion") return input.trim();
  if (key === "cliente_nombre" || key === "cliente_nombre_firma" || key === "cliente_direccion_transito" ||
      key === "nombre_del_notario" || key === "representante_seguro_nombre" || key === "monto_desembolso" ||
      key === "testigo_usuario" || key === "testigo_richard" || key.endsWith("_letras") || key.startsWith("vehiculo_")) {
    return formatted.toLocaleUpperCase("es");
  }
  return formatted;
}
