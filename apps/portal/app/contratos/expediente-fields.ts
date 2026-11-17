import type { ClientWrite, OperationWrite, Payment, Vehicle } from "../clientes/clients-api";
import { conditionalSaleHandwrittenFields, getDocumentType, insuranceSaleCaseFields, insuranceSaleDueDateKey, insuranceSaleInstallmentCount, insuranceScheduleFields, isInsuranceCompanyName, isInsuranceSaleCalculatedField, type DocumentType } from "./document-catalog";

type Context = {
  confirmedBalanceMinor?: number;
  balanceDate?: string;
  salesCommitmentParagraph?: string;
  insuranceCompanyName?: string;
  insuranceCompanyValues?: Record<string, string>;
  insuranceInstallmentCount?: number;
  insuranceInstallments?: readonly Partial<Payment>[];
  insuranceSaleInstallmentMinor?: number;
};

const dateFormat = new Intl.DateTimeFormat("es-DO", {
  day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
});
const tableDateFormat = new Intl.DateTimeFormat("es-DO", {
  day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC",
});
const dateListFormat = new Intl.ListFormat("es-DO");
const amountFormat = new Intl.NumberFormat("es-DO", { maximumFractionDigits: 0 });
const transitPhrase = "y de tránsito por la capital de la República Dominicana";

const smallNumbers = [
  "cero", "uno", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve",
  "diez", "once", "doce", "trece", "catorce", "quince", "dieciséis", "diecisiete", "dieciocho", "diecinueve",
  "veinte", "veintiuno", "veintidós", "veintitrés", "veinticuatro", "veinticinco", "veintiséis",
  "veintisiete", "veintiocho", "veintinueve",
];
const tens = ["", "", "", "treinta", "cuarenta", "cincuenta", "sesenta", "setenta", "ochenta", "noventa"];
const hundreds = ["", "ciento", "doscientos", "trescientos", "cuatrocientos", "quinientos", "seiscientos", "setecientos", "ochocientos", "novecientos"];
const scales = [
  { divisor: 1_000_000_000_000, single: "un billón", plural: "billones" },
  { divisor: 1_000_000, single: "un millón", plural: "millones" },
  { divisor: 1_000, single: "mil", plural: "mil" },
];

export function integerWords(value: number, beforeNoun = false): string {
  for (const { divisor, single, plural } of scales) {
    if (value < divisor) continue;
    const quotient = Math.floor(value / divisor);
    const remainder = value % divisor;
    const head = quotient === 1 ? single : `${integerWords(quotient, true)} ${plural}`;
    return remainder ? `${head} ${integerWords(remainder, beforeNoun)}` : head;
  }
  if (value === 100) return "cien";
  if (value >= 100) {
    const prefix = hundreds[Math.floor(value / 100)];
    return value % 100 ? `${prefix} ${integerWords(value % 100, beforeNoun)}` : prefix;
  }
  if (beforeNoun && value === 1) return "un";
  if (beforeNoun && value === 21) return "veintiún";
  if (value < smallNumbers.length) return smallNumbers[value];
  const prefix = tens[Math.floor(value / 10)];
  return value % 10 ? `${prefix} y ${integerWords(value % 10, beforeNoun)}` : prefix;
}

export function moneyNumber(minor: number) {
  return `RD$${amountFormat.format(Math.floor(minor / 100))}.${String(minor % 100).padStart(2, "0")}`;
}

export function moneyWords(minor: number) {
  const pesos = Math.floor(minor / 100);
  const cents = minor % 100;
  const currency = pesos === 1 ? "peso dominicano" : "pesos dominicanos";
  const connector = pesos > 0 && pesos % 1_000_000 === 0 ? " de " : " ";
  return `${integerWords(pesos, true)}${connector}${currency} con ${integerWords(cents, true)} ${cents === 1 ? "centavo" : "centavos"}`;
}

const notarialMonths = [
  "ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO",
  "JULIO", "AGOSTO", "SEPTIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE",
] as const;

/** Pagaré notarial: «UN MILLÓN … PESOS CON 00/100 CENTAVOS DOMINICANOS». */
export function notarialMoneyWords(minor: number) {
  const pesos = Math.floor(minor / 100);
  const cents = minor % 100;
  const currency = pesos === 1 ? "PESO" : "PESOS";
  const connector = pesos > 0 && pesos % 1_000_000 === 0 ? " DE " : " ";
  return `${integerWords(pesos, true)}${connector}${currency} CON ${String(cents).padStart(2, "0")}/100 CENTAVOS DOMINICANOS`
    .normalize("NFD").replace(/\p{M}/gu, "").toUpperCase();
}

/** Pagaré notarial: palabras primero y el monto en números entre paréntesis. */
export function notarialMoney(minor: number) {
  return `${notarialMoneyWords(minor)} (${moneyNumber(minor)})`;
}

/** Pagaré notarial: «SIETE (07) DE NOVIEMBRE DEL AÑO DOS MIL VEINTISEIS (2026)». */
export function notarialDate(date: Date) {
  const day = date.getUTCDate();
  const year = date.getUTCFullYear();
  const dayWords = integerWords(day).normalize("NFD").replace(/\p{M}/gu, "").toUpperCase();
  const yearWords = integerWords(year).normalize("NFD").replace(/\p{M}/gu, "").toUpperCase();
  return `${dayWords} (${String(day).padStart(2, "0")}) DE ${notarialMonths[date.getUTCMonth()]} DEL AÑO ${yearWords} (${year})`;
}

/** Encabezado del acto: «TRECE (13) días del mes de OCTUBRE del año 2026». */
export function notarialActDate(date: Date) {
  const day = date.getUTCDate();
  const dayWords = integerWords(day).normalize("NFD").replace(/\p{M}/gu, "").toUpperCase();
  return `${dayWords} (${String(day).padStart(2, "0")}) días del mes de ${notarialMonths[date.getUTCMonth()]} del año ${date.getUTCFullYear()}`;
}

function isoDate(value: string | null | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000")) return undefined;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().startsWith(value) ? date : undefined;
}

export function extraordinaryPaymentDate(firstDate: string, index: number): string | undefined {
  if (!Number.isSafeInteger(index)) return undefined;
  return paymentDateAfterMonths(firstDate, 4 * index);
}

export function extraordinaryPaymentDates(signature: string | null | undefined, finalDate: string) {
  const dates: string[] = [];
  if (!isoDate(finalDate)) return dates;
  for (let months = 4; months < 1200; months += 4) {
    const date = paymentDateAfterMonths(signature, months);
    if (!date || date >= finalDate) return dates;
    dates.push(date);
  }
  return dates;
}

export const defaultExtraordinaryPayments = 2;

export function expedienteExtraordinaryPayments(operation: OperationWrite, finalDate = operation.financing?.final_principal.date) {
  if (!operation.signature_date || !finalDate) return undefined;
  const dates = extraordinaryPaymentDates(operation.signature_date, finalDate);
  const financing = operation.financing;
  const saved = financing?.extraordinary_payments ?? [];
  const reusable = financing?.extraordinary_from_signature || validLegacyExtraordinaryPayments(saved) ? saved : [];
  const lastFundedPayment = reusable.findLastIndex(payment => payment.amount_minor > 0) + 1;
  const count = Math.max(defaultExtraordinaryPayments, financing?.extraordinary_payment_count ?? lastFundedPayment);
  return dates.slice(0, count).map((date, index) => ({ date, amount_minor: reusable[index]?.amount_minor ?? 0 }));
}

export function extraordinaryPaymentValues(payments: readonly Payment[], includeWords = false) {
  const values: Record<string, string> = { abonos_extraordinarios: payments.length ? scheduleText(payments, includeWords) : "Ninguno" };
  payments.forEach((payment, index) => {
    values[`fecha_abono_extraordinario_${index + 1}`] = payment.date;
    values[`abono_extraordinario_${index + 1}_monto`] = moneyNumber(payment.amount_minor);
  });
  return values;
}

export function isExtraordinaryPaymentField(key: string) {
  return key === "abonos_extraordinarios" || /^(?:fecha_abono_extraordinario_[1-9]\d*|abono_extraordinario_[1-9]\d*_monto)$/.test(key);
}

export function paymentDateAfterMonths(firstDate: string | null | undefined, months: number): string | undefined {
  const base = isoDate(firstDate);
  if (!base || !Number.isSafeInteger(months) || months < 0) return undefined;
  const targetMonth = base.getUTCMonth() + months;
  if (!Number.isSafeInteger(targetMonth)) return undefined;
  const year = base.getUTCFullYear() + Math.floor(targetMonth / 12);
  if (year > 9999) return undefined;
  const month = targetMonth % 12;
  const monthEnd = new Date(0);
  monthEnd.setUTCFullYear(year, month + 1, 0);
  const day = Math.min(base.getUTCDate(), monthEnd.getUTCDate());
  return `${String(year).padStart(4, "0")}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

const vehicleFields = [
  ["vehiculo_tipo", "Tipo", "vehicle_type"],
  ["vehiculo_marca", "Marca", "make"],
  ["vehiculo_modelo", "Modelo", "model"],
  ["vehiculo_anio", "Año", "year"],
  ["vehiculo_color", "Color", "color"],
  ["vehiculo_matricula", "Matrícula", "registration_number"],
  ["vehiculo_chasis", "Chasis", "chassis_number"],
  ["vehiculo_placa", "Placa", "plate"],
  ["vehiculo_motor", "Motor", "engine_number"],
] as const satisfies readonly (readonly [string, string, keyof Vehicle])[];

const interestColumns = ["cuotas_intereses_numeros", "cuotas_intereses_fechas", "cuotas_intereses_montos"];
export const percentageDateKey = "fecha_ancla_cuota_extraordinaria";
export const signatureDateRequired = "Guarda la fecha de firma en el detalle del expediente.";
const insuranceScheduleMarkers = new Set<string>(insuranceScheduleFields);
const insuranceNoteFields = new Set([
  "monto_cuota_seguro",
  "monto_cuota_seguro_letras",
  "monto_total_seguro",
  "monto_total_seguro_letras",
  "fecha_primera_cuota_seguro",
  "fecha_ultima_cuota_seguro",
]);
export const multilinePaymentFields = new Set([...interestColumns, "cuotas_seguro_numeros", "cuotas_seguro_fechas", "cuotas_seguro_montos"]);

const baseFields = new Set([
  "cliente_nombre", "cliente_nombre_firma", "cliente_cedula", "cliente_cedula_numeros", "cliente_cedula_letras",
  "cliente_tratamiento", "cliente_nacionalidad", "cliente_estado_civil", "cliente_ocupacion",
  "cliente_direccion", "cliente_direccion_transito", "cliente_telefono", "cliente_correo", "cliente_origen_ingresos",
  "vehiculo_garantia", "vehiculo_descripcion", "vehiculo_ano",
  "operacion_referencia", "fecha_contrato", "fecha_firma", "fecha_saldo", "saldo_confirmado", "saldo_confirmado_letras",
  percentageDateKey,
  "parrafo_compromiso_pago",
  "cuotas_intereses", "cuota_final_capital", "abonos_extraordinarios",
  "numero_cuota_final_capital", "fecha_cuota_final_capital", "cuota_final_capital_monto", "cuota_final_capital_letras",
  "cuota_intereses_monto", "cuota_intereses_monto_letras",
  "total_financiamiento", "total_financiamiento_letras",
  "cantidad_cuotas", "cantidad_cuotas_letras", "cantidad_cuotas_intereses", "cantidad_cuotas_intereses_letras",
  "cantidad_cuotas_seguro", "cantidad_cuotas_seguro_letras",
  ...interestColumns,
  ...vehicleFields.map(([key]) => key),
]);

export function isExpedienteField(key: string, type?: DocumentType) {
  return baseFields.has(key) ||
    (type === "acto_seguro" && insuranceScheduleMarkers.has(key)) ||
    (type === "pagare_seguro" && insuranceNoteFields.has(key)) ||
    Object.hasOwn(insuranceSaleCaseFields, key) ||
    (type === "venta_condicional_seguro" && isInsuranceSaleCalculatedField(key)) ||
    isExtraordinaryPaymentField(key);
}

/** El expediente solo registra la fecha de firma; es también la fecha del contrato en todos los documentos. */
export function usesSignatureAsContractDate(type?: DocumentType) {
  return type !== undefined;
}

/** Fechas del acto y montos en letras al estilo notarial (00/100, mayúsculas). */
export function usesNotarialDocumentStyle(type?: DocumentType) {
  return type === "pagare_autentico" || type === "pagare_seguro" || type === "acto_seguro"
    || type === "entrega_voluntaria" || type === "declaracion_jurada" || type === "venta_condicional_seguro";
}

/** Texto combinado de cuotas con montos y fechas en letras; solo pagarés. */
export function usesNotarialPaymentProse(type?: DocumentType) {
  return type === "pagare_autentico" || type === "pagare_seguro";
}

function notarialCountWords(value: number) {
  return integerWords(value).normalize("NFD").replace(/\p{M}/gu, "").toUpperCase();
}

function text(value?: string | null) {
  return value?.trim() ?? "";
}

/** Spells a digit run without reading more than three digits as one number (no «millón»). */
function cedulaSegmentWords(segment: string) {
  if (!segment || /[^0-9]/.test(segment)) return "";
  if (segment.startsWith("0")) return Array.from(segment, digit => smallNumbers[Number(digit)]).join(" ");
  if (segment.length <= 3) return integerWords(Number(segment));
  const parts: string[] = [];
  for (let index = 0; index < segment.length; index += 3) {
    const chunk = segment.slice(index, index + 3);
    parts.push(chunk.startsWith("0")
      ? Array.from(chunk, digit => smallNumbers[Number(digit)]).join(" ")
      : integerWords(Number(chunk)));
  }
  return parts.join(" ");
}

/** Cédula in words: «cero cero uno guion ciento cuarenta y seis quinientos sesenta y nueve cinco guion dos». */
export function cedulaWords(identity?: string | null) {
  const input = text(identity);
  if (!/^(?:\d{11}|\d{3}-\d{7}-\d)$/.test(input)) return "";
  const number = input.replace(/^(\d{3})(\d{7})(\d)$/, "$1-$2-$3");
  return number.split("-").map(cedulaSegmentWords).join(" guion ");
}

function identityValues(identity?: string | null) {
  const input = text(identity);
  if (!/^(?:\d{11}|\d{3}-\d{7}-\d)$/.test(input)) return { number: "", words: "" };
  const number = input.replace(/^(\d{3})(\d{7})(\d)$/, "$1-$2-$3");
  return { number, words: cedulaWords(number) };
}

function validPayment(payment: Payment) {
  return Number.isSafeInteger(payment.amount_minor) && payment.amount_minor > 0 && Boolean(isoDate(payment.date));
}

function paymentAmount(minor: number, includeWords: boolean) {
  return includeWords ? notarialMoney(minor) : moneyNumber(minor);
}

function paymentText(payment: Payment, includeWords: boolean) {
  const date = isoDate(payment.date)!;
  const when = includeWords ? notarialDate(date) : dateFormat.format(date);
  return `${when}, ${paymentAmount(payment.amount_minor, includeWords)}`;
}

function scheduleText(payments: readonly Payment[], includeWords: boolean) {
  return payments.map((payment, index) => `${index + 1}) ${paymentText(payment, includeWords)}`).join(". ");
}

function validLegacyExtraordinaryPayments(payments: readonly Payment[]) {
  return payments.every((payment, index) => validPayment(payment) && payment.date === extraordinaryPaymentDate(payments[0].date, index));
}

function addFinancing(values: Record<string, string>, financing: NonNullable<OperationWrite["financing"]>, includeWords: boolean) {
  const { interest_installments: interest, final_principal: capital, extraordinary_payments: extras } = financing;
  if (validPayment(capital)) {
    values.cuota_final_capital = paymentText(capital, includeWords);
    values.fecha_cuota_final_capital = capital.date;
    values.cuota_final_capital_monto = moneyNumber(capital.amount_minor);
    values.cuota_final_capital_letras = notarialMoneyWords(capital.amount_minor);
  }
  const interestValid = interest.every((payment, index) =>
    validPayment(payment) && payment.date < capital.date && (!index || payment.date > interest[index - 1].date));
  if (interestValid) {
    const firstInterest = interest[0]?.amount_minor;
    const uniformInterest = firstInterest !== undefined && interest.every(payment => payment.amount_minor === firstInterest);
    if (includeWords && uniformInterest && interest.length > 1) {
      const dates = dateListFormat.format(interest.map(payment => notarialDate(isoDate(payment.date)!)));
      values.cuotas_intereses = `${notarialCountWords(interest.length)} (${interest.length}) CUOTAS DE ${paymentAmount(firstInterest, true)} CADA UNA. VENCIMIENTOS EL ${dates}`;
    } else {
      values.cuotas_intereses = interest.length ? scheduleText(interest, includeWords) : "Ninguna";
    }
    values.cuotas_intereses_numeros = interest.map((_, index) => String(index + 1)).join("\n") || "No aplica";
    values.cuotas_intereses_fechas = interest.map(payment => {
      const date = isoDate(payment.date)!;
      return includeWords ? notarialDate(date) : tableDateFormat.format(date);
    }).join("\n") || "No aplica";
    values.cuotas_intereses_montos = interest.map(payment => paymentAmount(payment.amount_minor, includeWords)).join("\n") || "No aplica";
    const interestCount = interest.length;
    values.cantidad_cuotas_intereses = String(interestCount);
    values.cantidad_cuotas_intereses_letras = notarialCountWords(interestCount);
    if (uniformInterest) {
      values.cuota_intereses_monto = moneyNumber(firstInterest);
      values.cuota_intereses_monto_letras = notarialMoneyWords(firstInterest);
    }
    if (values.cuota_final_capital) {
      const count = interestCount + 1;
      values.cantidad_cuotas = String(count);
      values.cantidad_cuotas_letras = notarialCountWords(count);
      values.numero_cuota_final_capital = String(count);
      const total = interest.reduce((sum, payment) => sum + payment.amount_minor, capital.amount_minor);
      if (Number.isSafeInteger(total)) {
        values.total_financiamiento = moneyNumber(total);
        values.total_financiamiento_letras = notarialMoneyWords(total);
      }
    }
  }
  if (validLegacyExtraordinaryPayments(extras)) {
    Object.assign(values, extraordinaryPaymentValues(extras, includeWords));
  }
}

export function insuranceInstallmentField(index: number, field: "fecha" | "monto") {
  return `cuota_seguro_${index + 1}_${field}`;
}

function addInsuranceSchedule(values: Record<string, string>, count: number, installments: readonly Partial<Payment>[]) {
  const numbers: string[] = [];
  const dates: string[] = [];
  const amounts: string[] = [];
  let total = 0;
  for (let index = 0; index < count; index += 1) {
    const installment = installments[index];
    const date = isoDate(installment?.date);
    const minor = installment?.amount_minor;
    const amount = minor !== undefined && Number.isSafeInteger(minor) && minor > 0 ? minor : undefined;
    if (!date || amount === undefined) return [
      ...(!date ? [{ key: insuranceInstallmentField(index, "fecha"), message: "Selecciona la fecha de esta cuota." }] : []),
      ...(amount === undefined ? [{ key: insuranceInstallmentField(index, "monto"), message: "Escribe un monto mayor que cero con hasta dos decimales." }] : []),
    ];
    numbers.push(String(index + 1));
    dates.push(tableDateFormat.format(date));
    amounts.push(moneyNumber(amount));
    total += amount;
  }
  if (!Number.isSafeInteger(total)) return [{
    key: "monto_total_seguro", message: "La suma de las cuotas supera el monto que puede calcularse con precisión. Revisa los importes.",
  }];
  values.cuotas_seguro_numeros = numbers.join("\n");
  values.cuotas_seguro_fechas = dates.join("\n");
  values.cuotas_seguro_montos = amounts.join("\n");
  values.monto_total_seguro = moneyNumber(total);
  values.monto_total_seguro_letras = notarialMoneyWords(total);
  return [];
}

function addInsuranceSale(values: Record<string, string>, operation: OperationWrite, amount?: number) {
  for (const [marker, key] of Object.entries(insuranceSaleCaseFields)) values[marker] = values[key];
  values.placa_del_vehiculo = values.vehiculo_placa || values.vehiculo_matricula;
  for (let installment = 1; installment <= insuranceSaleInstallmentCount; installment++) {
    values[insuranceSaleDueDateKey(installment)] = paymentDateAfterMonths(operation.signature_date, installment) ?? "";
  }
  const total = (amount ?? 0) * insuranceSaleInstallmentCount;
  if (amount !== undefined && Number.isSafeInteger(total) && total > 0) {
    values.monto_de_cada_cuota = moneyNumber(amount);
    values.monto_total_financiado = moneyNumber(total);
    values.monto_total_financiado_en_letras = notarialMoneyWords(total);
  }
}

const fieldMessages: Record<string, string> = {
  cliente_nombre: "Completa el nombre en el expediente.",
  cliente_cedula: "Registra una cédula de 11 dígitos en el expediente.",
  cliente_cedula_letras: "Registra una cédula de 11 dígitos en el expediente.",
  cliente_direccion: "Completa la dirección en el expediente.",
  cliente_direccion_transito: "Completa la dirección en el expediente.",
  cliente_telefono: "Completa el teléfono en el expediente.",
  cliente_correo: "Completa el correo en el expediente.",
  cliente_origen_ingresos: "Completa el origen de los ingresos en el expediente.",
  cliente_ocupacion: "Completa la ocupación del cliente en el expediente.",
  vehiculo_matricula: "Completa la placa en la operación.",
  vehiculo_garantia: "Completa los datos de la garantía vehicular en la operación.",
  operacion_referencia: "Completa la referencia en la operación.",
  fecha_contrato: "Registra la fecha del contrato en la operación.",
  fecha_de_firma: signatureDateRequired,
  fecha_firma: signatureDateRequired,
  fecha_saldo: "Selecciona la fecha del saldo confirmado.",
  saldo_confirmado: "Indica el saldo confirmado en pesos con hasta dos decimales.",
  cuotas_intereses: "Revisa los importes y el orden de las cuotas de intereses en la operación.",
  cuota_final_capital: "Completa el importe y la fecha de la cuota final de capital en la operación.",
  abonos_extraordinarios: "Revisa los abonos extraordinarios en el plan de pagos del expediente.",
  total_financiamiento: "Revisa los importes de las cuotas de intereses y el capital para calcular el total.",
  total_financiamiento_letras: "Revisa los importes de las cuotas de intereses y el capital para calcular el total.",
  cantidad_cuotas: "Completa el calendario de cuotas en la operación.",
  cantidad_cuotas_letras: "Completa el calendario de cuotas en la operación.",
  parrafo_compromiso_pago: "Vincula el Word de la venta que contiene la cláusula de compromiso de pago.",
  cantidad_cuotas_seguro: "Indica una cantidad entera de cuotas del seguro mayor que cero.",
  empresa_seguro_nombre: "Selecciona el perfil autorizado del emisor del seguro.",
  monto_de_cada_cuota: "Guarda el monto de cada cuota del seguro en el detalle del expediente.",
};

export function resolveExpedienteFields(type: DocumentType, client: ClientWrite, operation: OperationWrite, context: Context) {
  const name = text(client.name);
  const address = text(client.address);
  const signatureDate = isoDate(operation.signature_date) ? operation.signature_date! : "";
  const identity = identityValues(client.identity);
  const balance = context.confirmedBalanceMinor;
  const hasBalance = balance !== undefined && Number.isSafeInteger(balance) && balance >= 0;
  const values: Record<string, string> = {
    cliente_nombre: name,
    cliente_nombre_firma: name,
    cliente_tratamiento: text(client.profile?.treatment),
    cliente_nacionalidad: text(client.profile?.nationality),
    cliente_ocupacion: text(client.profile?.position),
    cliente_estado_civil: text(client.profile?.marital_status),
    cliente_cedula: identity.number,
    cliente_cedula_numeros: identity.number,
    cliente_cedula_letras: identity.words,
    cliente_direccion: address,
    cliente_direccion_transito: address && (address.endsWith(transitPhrase) ? address : `${address} ${transitPhrase}`),
    cliente_telefono: text(client.phone),
    cliente_correo: text(client.email),
    cliente_origen_ingresos: text(client.income_source),
    operacion_referencia: text(operation.reference),
    fecha_contrato: usesSignatureAsContractDate(type) ? signatureDate : isoDate(operation.contract_date) ? operation.contract_date! : "",
    fecha_firma: signatureDate,
    [percentageDateKey]: paymentDateAfterMonths(operation.signature_date, 1) ?? "",
    fecha_saldo: isoDate(context.balanceDate) ? context.balanceDate! : "",
    saldo_confirmado: hasBalance ? moneyNumber(balance) : "",
    saldo_confirmado_letras: hasBalance ? notarialMoneyWords(balance) : "",
    parrafo_compromiso_pago: text(context.salesCommitmentParagraph),
  };

  const guarantee: string[] = [];
  for (const [marker, label, field] of vehicleFields) {
    const value = text(operation.vehicle[field]);
    values[marker] = value;
    if (value) guarantee.push(`${label} ${value}`);
  }
  values.vehiculo_matricula = values.vehiculo_matricula || values.vehiculo_placa;
  values.vehiculo_garantia = guarantee.join(", ");
  values.vehiculo_descripcion = values.vehiculo_garantia;
  values.vehiculo_ano = values.vehiculo_anio;
  // La declaración jurada describe la ocupación con el origen de ingresos registrado en el expediente.
  if (type === "declaracion_jurada") values.cliente_ocupacion = values.cliente_origen_ingresos;
  // Marcadores con nombre largo (p. ej. nombre_completo_del_cliente) usan los mismos datos del expediente.
  for (const [marker, key] of Object.entries(insuranceSaleCaseFields)) values[marker] = values[key];
  values.placa_del_vehiculo = values.vehiculo_placa || values.vehiculo_matricula;
  if (usesNotarialDocumentStyle(type) && values.cliente_cedula_letras) {
    values.cliente_cedula_letras = values.cliente_cedula_letras.toUpperCase();
  }
  if (operation.financing) addFinancing(values, operation.financing, usesNotarialPaymentProse(type));
  if (type === "venta_condicional" || type === "pagare_autentico") {
    const payments = expedienteExtraordinaryPayments(operation);
    for (const key of Object.keys(values)) if (isExtraordinaryPaymentField(key)) delete values[key];
    if (payments) Object.assign(values, extraordinaryPaymentValues(payments, type === "pagare_autentico"));
  }
  if (type === "venta_condicional" || type === "venta_condicional_seguro") {
    for (const key of conditionalSaleHandwrittenFields) values[key] = "";
  }
  if (type === "venta_condicional_seguro") {
    addInsuranceSale(values, operation, context.insuranceSaleInstallmentMinor ?? operation.insurance_installment_minor ?? undefined);
  }

  const definition = getDocumentType(type)!;
  const required = definition.requiredFields.filter(key =>
    key !== "testigo_richard" && key !== "testigo_usuario" &&
    !(usesSignatureAsContractDate(type) && key === "fecha_contrato") &&
    !(type === "venta_condicional_seguro" && !baseFields.has(key) && key !== "monto_de_cada_cuota") &&
    !(type === "acto_seguro" && insuranceScheduleMarkers.has(key)));
  let insuranceIssues: { key: string; message: string }[] = [];
  if (definition.requiresInsuranceCompany) {
    const count = context.insuranceInstallmentCount ?? operation.financing?.insurance_installment_count ?? 10;
    if (Number.isSafeInteger(count) && count > 0) {
      values.cantidad_cuotas_seguro = String(count);
      values.cantidad_cuotas_seguro_letras = notarialCountWords(count);
      if (type === "pagare_seguro") {
        const insuranceAmount = context.insuranceSaleInstallmentMinor ?? operation.insurance_installment_minor ?? undefined;
        const total = (insuranceAmount ?? 0) * count;
        if (insuranceAmount !== undefined && Number.isSafeInteger(insuranceAmount) && insuranceAmount > 0 && Number.isSafeInteger(total) && total > 0) {
          values.monto_cuota_seguro = moneyNumber(insuranceAmount);
          values.monto_cuota_seguro_letras = notarialMoneyWords(insuranceAmount);
          values.monto_total_seguro = moneyNumber(total);
          values.monto_total_seguro_letras = notarialMoneyWords(total);
          if (signatureDate) {
            values.fecha_primera_cuota_seguro = paymentDateAfterMonths(signatureDate, 1) ?? "";
            values.fecha_ultima_cuota_seguro = paymentDateAfterMonths(signatureDate, count) ?? "";
          }
        }
      }
      if (type === "acto_seguro") {
        if (context.insuranceInstallments !== undefined) {
          insuranceIssues = addInsuranceSchedule(values, count, context.insuranceInstallments);
        } else {
          const insuranceAmount = context.insuranceSaleInstallmentMinor ?? operation.insurance_installment_minor ?? undefined;
          if (insuranceAmount === undefined || !Number.isSafeInteger(insuranceAmount) || insuranceAmount <= 0) {
            insuranceIssues = [{ key: "monto_de_cada_cuota", message: fieldMessages.monto_de_cada_cuota }];
          } else if (signatureDate) {
            const installments = Array.from({ length: count }, (_, index) => ({
              date: paymentDateAfterMonths(signatureDate, index + 1),
              amount_minor: insuranceAmount,
            }));
            if (installments.some(item => !item.date)) {
              insuranceIssues = [{ key: "fecha_firma", message: "El calendario de cuotas supera el año 9999." }];
            } else {
              insuranceIssues = addInsuranceSchedule(values, count, installments);
            }
          }
        }
      }
    }
    const issuer = text(context.insuranceCompanyName);
    if (isInsuranceCompanyName(issuer)) {
      for (const [key, value] of Object.entries(context.insuranceCompanyValues ?? {})) {
        if (!/^empresa_[a-z0-9_]+$/.test(key)) continue;
        values[`empresa_seguro_${key.slice(8)}`] = text(value);
        values[`emisor_seguro_${key.slice(8)}`] = text(value);
        if (type === "venta_condicional_seguro") values[key] = text(value);
      }
      values.representante_seguro_nombre = text(context.insuranceCompanyValues?.empresa_representante_nombre);
      for (const key of ["empresa_seguro_nombre", "emisor_seguro_nombre", "empresa_seguro_razon_social", "emisor_seguro_razon_social"]) {
        values[key] = issuer;
      }
    }
    required.push("empresa_seguro_nombre");
  }
  return {
    values,
    issues: [...required.filter(key => !values[key]).map(key => ({ key, message: fieldMessages[key] })), ...insuranceIssues],
  };
}
