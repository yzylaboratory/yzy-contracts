// Pure payment-plan calculation and validation logic ported 1:1 from apps/portal (no React).
// Do not diverge from the portal formulas: any change must happen in both places.

export type Payment = { date: string; amount_minor: number };

export type FinancingPlan = {
  interest_installments: Payment[];
  final_principal: Payment;
};

export type Financing = FinancingPlan & {
  extraordinary_payments: Payment[];
  extraordinary_from_signature?: boolean;
  extraordinary_payment_count?: number;
  insurance_installment_count?: number | null;
};

export type OperationPlanInput = {
  signature_date?: string | null;
  financing?: {
    final_principal: Payment;
    extraordinary_payments?: Payment[];
    extraordinary_from_signature?: boolean;
    extraordinary_payment_count?: number;
  } | null;
};

// Origin: apps/portal/app/clientes/monthly-payment-plan.ts:5
export const maxMonthlyInstallments = 1200;

// Origin: apps/portal/app/clientes/monthly-payment-plan.ts:7
export type InstallmentDraft = { date: string; amount: string };

// Origin: apps/portal/app/contratos/expediente-fields.ts:133
export const defaultExtraordinaryPayments = 2;

// Origin: apps/portal/app/contratos/expediente-fields.ts:15-22
const dateFormat = new Intl.DateTimeFormat('es-DO', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});
const amountFormat = new Intl.NumberFormat('es-DO', { maximumFractionDigits: 0 });

// Origin: apps/portal/app/clientes/amount-input.ts:1
const grouping = new Intl.NumberFormat('es-DO', { maximumFractionDigits: 0 });

// Origin: apps/portal/app/contratos/expediente-fields.ts:25-37
const smallNumbers = [
  'cero',
  'uno',
  'dos',
  'tres',
  'cuatro',
  'cinco',
  'seis',
  'siete',
  'ocho',
  'nueve',
  'diez',
  'once',
  'doce',
  'trece',
  'catorce',
  'quince',
  'dieciséis',
  'diecisiete',
  'dieciocho',
  'diecinueve',
  'veinte',
  'veintiuno',
  'veintidós',
  'veintitrés',
  'veinticuatro',
  'veinticinco',
  'veintiséis',
  'veintisiete',
  'veintiocho',
  'veintinueve',
];
const tens = ['', '', '', 'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa'];
const hundreds = [
  '',
  'ciento',
  'doscientos',
  'trescientos',
  'cuatrocientos',
  'quinientos',
  'seiscientos',
  'setecientos',
  'ochocientos',
  'novecientos',
];
const scales = [
  { divisor: 1_000_000_000_000, single: 'un billón', plural: 'billones' },
  { divisor: 1_000_000, single: 'un millón', plural: 'millones' },
  { divisor: 1_000, single: 'mil', plural: 'mil' },
];

// Origin: apps/portal/app/contratos/expediente-fields.ts:71-74
const notarialMonths = [
  'ENERO',
  'FEBRERO',
  'MARZO',
  'ABRIL',
  'MAYO',
  'JUNIO',
  'JULIO',
  'AGOSTO',
  'SEPTIEMBRE',
  'OCTUBRE',
  'NOVIEMBRE',
  'DICIEMBRE',
] as const;

// Origin: apps/portal/app/contratos/expediente-fields.ts:39-57
export function integerWords(value: number, beforeNoun = false): string {
  for (const { divisor, single, plural } of scales) {
    if (value < divisor) continue;
    const quotient = Math.floor(value / divisor);
    const remainder = value % divisor;
    const head = quotient === 1 ? single : `${integerWords(quotient, true)} ${plural}`;
    return remainder ? `${head} ${integerWords(remainder, beforeNoun)}` : head;
  }
  if (value === 100) return 'cien';
  if (value >= 100) {
    const prefix = hundreds[Math.floor(value / 100)] ?? '';
    return value % 100 ? `${prefix} ${integerWords(value % 100, beforeNoun)}` : prefix;
  }
  if (beforeNoun && value === 1) return 'un';
  if (beforeNoun && value === 21) return 'veintiún';
  if (value < smallNumbers.length) return smallNumbers[value] ?? '';
  const prefix = tens[Math.floor(value / 10)] ?? '';
  return value % 10 ? `${prefix} y ${integerWords(value % 10, beforeNoun)}` : prefix;
}

// Origin: apps/portal/app/contratos/expediente-fields.ts:59-61
export function moneyNumber(minor: number): string {
  return `RD$${amountFormat.format(Math.floor(minor / 100))}.${String(minor % 100).padStart(2, '0')}`;
}

// Origin: apps/portal/app/contratos/expediente-fields.ts:77-84
export function notarialMoneyWords(minor: number): string {
  const pesos = Math.floor(minor / 100);
  const cents = minor % 100;
  const currency = pesos === 1 ? 'PESO' : 'PESOS';
  const connector = pesos > 0 && pesos % 1_000_000 === 0 ? ' DE ' : ' ';
  return `${integerWords(pesos, true)}${connector}${currency} CON ${String(cents).padStart(2, '0')}/100 CENTAVOS DOMINICANOS`
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toUpperCase();
}

// Origin: apps/portal/app/contratos/expediente-fields.ts:87-89
export function notarialMoney(minor: number): string {
  return `${notarialMoneyWords(minor)} (${moneyNumber(minor)})`;
}

// Origin: apps/portal/app/contratos/expediente-fields.ts:92-98
export function notarialDate(date: Date): string {
  const day = date.getUTCDate();
  const year = date.getUTCFullYear();
  const dayWords = integerWords(day)
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toUpperCase();
  const yearWords = integerWords(year)
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toUpperCase();
  return `${dayWords} (${String(day).padStart(2, '0')}) DE ${notarialMonths[date.getUTCMonth()]} DEL AÑO ${yearWords} (${year})`;
}

// Origin: apps/portal/app/contratos/expediente-fields.ts:111-115
export function isoDate(value: string | null | undefined): Date | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) return undefined;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().startsWith(value) ? date : undefined;
}

// Origin: apps/portal/app/contratos/expediente-fields.ts:159-171
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
  return `${String(year).padStart(4, '0')}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// Origin: apps/portal/app/contratos/expediente-fields.ts:117-120
export function extraordinaryPaymentDate(firstDate: string, index: number): string | undefined {
  if (!Number.isSafeInteger(index)) return undefined;
  return paymentDateAfterMonths(firstDate, 4 * index);
}

// Origin: apps/portal/app/contratos/expediente-fields.ts:122-131
export function extraordinaryPaymentDates(signature: string | null | undefined, finalDate: string): string[] {
  const dates: string[] = [];
  if (!isoDate(finalDate)) return dates;
  for (let months = 4; months < 1200; months += 4) {
    const date = paymentDateAfterMonths(signature, months);
    if (!date || date >= finalDate) return dates;
    dates.push(date);
  }
  return dates;
}

// Origin: apps/portal/app/contratos/expediente-fields.ts:332-334
function validPayment(payment: Payment): boolean {
  return Number.isSafeInteger(payment.amount_minor) && payment.amount_minor > 0 && Boolean(isoDate(payment.date));
}

// Origin: apps/portal/app/contratos/expediente-fields.ts:336-338
function paymentAmount(minor: number, includeWords: boolean): string {
  return includeWords ? notarialMoney(minor) : moneyNumber(minor);
}

// Origin: apps/portal/app/contratos/expediente-fields.ts:340-344
function paymentText(payment: Payment, includeWords: boolean): string {
  const date = isoDate(payment.date)!;
  const when = includeWords ? notarialDate(date) : dateFormat.format(date);
  return `${when}, ${paymentAmount(payment.amount_minor, includeWords)}`;
}

// Origin: apps/portal/app/contratos/expediente-fields.ts:346-348
function scheduleText(payments: readonly Payment[], includeWords: boolean): string {
  return payments.map((payment, index) => `${index + 1}) ${paymentText(payment, includeWords)}`).join('. ');
}

// Origin: apps/portal/app/contratos/expediente-fields.ts:350-352
export function validLegacyExtraordinaryPayments(payments: readonly Payment[]): boolean {
  const firstDate = payments[0]?.date;
  return payments.every(
    (payment, index) => validPayment(payment) && Boolean(firstDate) && payment.date === extraordinaryPaymentDate(firstDate!, index),
  );
}

// Origin: apps/portal/app/contratos/expediente-fields.ts:135-144
export function expedienteExtraordinaryPayments(
  operation: OperationPlanInput,
  finalDate = operation.financing?.final_principal.date,
): Payment[] | undefined {
  if (!operation.signature_date || !finalDate) return undefined;
  const dates = extraordinaryPaymentDates(operation.signature_date, finalDate);
  const financing = operation.financing;
  const saved = financing?.extraordinary_payments ?? [];
  const reusable = financing?.extraordinary_from_signature || validLegacyExtraordinaryPayments(saved) ? saved : [];
  let lastFundedPayment = 0;
  for (let i = reusable.length - 1; i >= 0; i -= 1) {
    const item = reusable[i];
    if (item && item.amount_minor > 0) {
      lastFundedPayment = i + 1;
      break;
    }
  }
  const count = Math.max(defaultExtraordinaryPayments, financing?.extraordinary_payment_count ?? lastFundedPayment);
  return dates.slice(0, count).map((date, index) => ({ date, amount_minor: reusable[index]?.amount_minor ?? 0 }));
}

// Origin: apps/portal/app/contratos/expediente-fields.ts:146-153
export function extraordinaryPaymentValues(payments: readonly Payment[], includeWords = false): Record<string, string> {
  const values: Record<string, string> = {
    abonos_extraordinarios: payments.length ? scheduleText(payments, includeWords) : 'Ninguno',
  };
  payments.forEach((payment, index) => {
    values[`fecha_abono_extraordinario_${index + 1}`] = payment.date;
    values[`abono_extraordinario_${index + 1}_monto`] = moneyNumber(payment.amount_minor);
  });
  return values;
}

// Origin: apps/portal/app/contratos/expediente-fields.ts:155-157
export function isExtraordinaryPaymentField(key: string): boolean {
  return (
    key === 'abonos_extraordinarios' ||
    /^(?:fecha_abono_extraordinario_[1-9]\d*|abono_extraordinario_[1-9]\d*_monto)$/.test(key)
  );
}

// Origin: apps/portal/app/clientes/amount-input.ts:3-12
export function parseAmountMinor(value: string): number | undefined {
  const trimmed = value.trim();
  const normalized = /^RD\$|\.|,\d{3}(?:,|$)/.test(trimmed)
    ? trimmed.replace(/^RD\$\s*/, '').replace(/,/g, '')
    : trimmed.replace(',', '.');
  if (!/^\d+(?:\.\d{0,2})?$/.test(normalized)) return undefined;
  const [whole, fraction = ''] = normalized.split('.');
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (Number.isSafeInteger(minor)) return minor;
  return undefined;
}

// Origin: apps/portal/app/clientes/amount-input.ts:14-18
export function amountInputValue(minor: number): string {
  const whole = Math.floor(minor / 100);
  const fraction = String(minor % 100).padStart(2, '0');
  return `${whole}.${fraction}`;
}

// Origin: apps/portal/app/clientes/amount-input.ts:20-24
export function formatMoneyInput(minor: number): string {
  const whole = Math.floor(minor / 100);
  const fraction = String(minor % 100).padStart(2, '0');
  return `RD$${grouping.format(whole)}.${fraction}`;
}

// Origin: apps/portal/app/clientes/monthly-payment-plan.ts:9-18
export function calculateMonthlyPayments(
  signature: string | null | undefined,
  amount: number,
  count: number,
  capital: number,
): Payment[] {
  if (
    !Number.isSafeInteger(amount) ||
    amount <= 0 ||
    !Number.isInteger(count) ||
    count < 1 ||
    count > maxMonthlyInstallments ||
    !Number.isSafeInteger(capital + count * amount) ||
    !paymentDateAfterMonths(signature, count)
  ) {
    return [];
  }

  return Array.from({ length: count }, (_, index) => ({
    date: paymentDateAfterMonths(signature, index + 1)!,
    amount_minor: index === count - 1 ? capital + amount : amount,
  }));
}

// Origin: apps/portal/app/clientes/monthly-payment-plan.ts:20-22
export function installmentDraft(payment: Payment): InstallmentDraft {
  return { date: payment.date, amount: formatMoneyInput(payment.amount_minor) };
}

// Origin: apps/portal/app/clientes/monthly-payment-plan.ts:25-43
export function planFromInputs(
  signature: string | null | undefined,
  capital: number,
  amountText: string,
  countText: string,
): { amount: string; count: string; rows: InstallmentDraft[] } {
  const amount = parseAmountMinor(amountText) ?? 0;
  const count = /^\d+$/.test(countText) ? Number(countText) : 0;
  const validCount = Number.isInteger(count) && count >= 1 && count <= maxMonthlyInstallments;
  const canCalculate = Boolean(signature) && capital > 0 && amount > 0 && validCount;
  const outOfRange =
    canCalculate && (!Number.isSafeInteger(capital + count * amount) || !paymentDateAfterMonths(signature, count));
  return {
    amount: amountText,
    count: countText,
    rows:
      canCalculate && !outOfRange ? calculateMonthlyPayments(signature, amount, count, capital).map(installmentDraft) : [],
  };
}

// Origin: apps/portal/app/clientes/monthly-payment-plan.ts:45-56
export function planCalculationOutOfRange(
  signature: string | null | undefined,
  capital: number,
  amountText: string,
  countText: string,
): boolean {
  const amount = parseAmountMinor(amountText) ?? 0;
  const count = /^\d+$/.test(countText) ? Number(countText) : 0;
  const validCount = Number.isInteger(count) && count >= 1 && count <= maxMonthlyInstallments;
  const canCalculate = Boolean(signature) && capital > 0 && amount > 0 && validCount;
  return canCalculate && (!Number.isSafeInteger(capital + count * amount) || !paymentDateAfterMonths(signature, count));
}

// Origin: apps/portal/app/clientes/monthly-payment-plan.ts:58-81
export function validateMonthlyPayments(
  rows: InstallmentDraft[],
  latestDate?: string,
): {
  errors: { date: string | undefined; amount: string | undefined }[];
  plan: FinancingPlan | undefined;
  total: number;
  totalError: boolean;
} {
  const payments: Payment[] = [];
  let total = 0;
  const errors = rows.map(({ date, amount }, index) => {
    const validDate = paymentDateAfterMonths(date, 0);
    const amountMinor = parseAmountMinor(amount);
    if (amountMinor !== undefined) total += amountMinor;
    payments.push({ date, amount_minor: amountMinor ?? 0 });
    const previousRow = index > 0 ? rows[index - 1] : undefined;

    return {
      date: !validDate
        ? 'Indica una fecha válida.'
        : previousRow && date <= previousRow.date
          ? 'Debe ser posterior a la cuota anterior.'
          : latestDate && date > latestDate
            ? 'La fecha supera el plazo máximo.'
            : undefined,
      amount: amountMinor === undefined || amountMinor <= 0 ? 'Indica un monto mayor que cero.' : undefined,
    };
  });
  const totalError = !Number.isSafeInteger(total);
  const final = payments[payments.length - 1];
  const plan: FinancingPlan | undefined =
    final && !totalError && !errors.some((error) => error.date || error.amount)
      ? { interest_installments: payments.slice(0, -1), final_principal: final }
      : undefined;
  return { errors, plan, total, totalError };
}

export type ExtraordinaryDraftRow = {
  date: string;
  value: string;
  amount: number | undefined;
};

// Origin: apps/portal/app/clientes/intake-payment-plan-step.tsx:58-76
export function computeIntakeExtraordinaryState(params: {
  signatureDate: string | null | undefined;
  rows: InstallmentDraft[];
  rowErrors: { date: string | undefined; amount: string | undefined }[];
  extraordinary: Record<string, string>;
  extraordinaryCount?: number;
}): {
  dates: string[];
  initialCount: number;
  shownCount: number;
  extras: ExtraordinaryDraftRow[];
  validExtras: boolean;
  canAddMore: boolean;
  canRemoveLast: boolean;
} {
  const { signatureDate, rows, rowErrors, extraordinary, extraordinaryCount } = params;
  const lastError = rowErrors[rowErrors.length - 1];
  const lastRow = rows[rows.length - 1];
  const finalDate = lastError?.date ? undefined : lastRow?.date;
  const dates = finalDate ? extraordinaryPaymentDates(signatureDate, finalDate) : [];
  const initialCount = Math.min(defaultExtraordinaryPayments, dates.length);
  const shownCount = Math.min(dates.length, Math.max(initialCount, extraordinaryCount ?? initialCount));
  const extras = dates.slice(0, shownCount).map((date) => {
    const value = extraordinary[date] ?? '';
    const parsed = parseAmountMinor(value);
    return { date, value, amount: parsed };
  });
  const validExtras = extras.every((payment) => payment.amount !== undefined && payment.amount > 0);
  return {
    dates,
    initialCount,
    shownCount,
    extras,
    validExtras,
    canAddMore: extras.length < dates.length,
    canRemoveLast: extras.length > initialCount,
  };
}

// Origin: apps/portal/app/clientes/intake-payment-plan-step.tsx:87-96
export function buildIntakeFinancing(
  plan: FinancingPlan,
  extras: readonly ExtraordinaryDraftRow[],
  insuranceInstallmentCount?: number | null,
): Financing {
  const extraordinaryPayments = extras.map((payment) => ({
    date: payment.date,
    amount_minor: payment.amount ?? 0,
  }));
  return {
    ...plan,
    extraordinary_from_signature: extraordinaryPayments.length > 0,
    extraordinary_payment_count: extraordinaryPayments.length,
    extraordinary_payments: extraordinaryPayments,
    ...(insuranceInstallmentCount !== undefined ? { insurance_installment_count: insuranceInstallmentCount } : {}),
  };
}

