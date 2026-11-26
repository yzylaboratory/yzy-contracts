// Formatting helpers shared by the Dashboard blocks. Pure functions, no client-only imports.

const numberFormat = new Intl.NumberFormat("es-DO", { maximumFractionDigits: 0, numberingSystem: "latn" });
const decimalFormat = new Intl.NumberFormat("es-DO", { maximumFractionDigits: 1, numberingSystem: "latn" });
const dayMonth = new Intl.DateTimeFormat("es-DO", { day: "numeric", month: "short", timeZone: "UTC" });
const monthOnly = new Intl.DateTimeFormat("es-DO", { month: "short", timeZone: "UTC" });
const monthLong = new Intl.DateTimeFormat("es-DO", { month: "long", year: "numeric", timeZone: "UTC" });
const dayMs = 86_400_000;

export const count = (value: number) => numberFormat.format(value);
export const decimal = (value: number) => decimalFormat.format(value);
export const plural = (value: number, one: string, other: string) => `${count(value)} ${value === 1 ? one : other}`;

export function formatMinutes(minutes: number) {
  if (minutes <= 0) return "0 min";
  if (minutes < 60) return `${count(minutes)} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest > 0 ? `${count(hours)} h ${rest} min` : `${count(hours)} h`;
}

const toDate = (iso: string) => new Date(`${iso}T00:00:00Z`);

/** "1–26 oct." or "28 sep. – 26 oct." for [start, endExclusive). */
export function rangeLabel(start: string, endExclusive: string) {
  const from = toDate(start);
  const to = new Date(toDate(endExclusive).getTime() - dayMs);
  if (to.getTime() <= from.getTime()) return dayMonth.format(from);
  if (from.getUTCFullYear() === to.getUTCFullYear() && from.getUTCMonth() === to.getUTCMonth()) {
    return `${from.getUTCDate()}–${to.getUTCDate()} ${monthOnly.format(to)}`;
  }
  return `${dayMonth.format(from)} – ${dayMonth.format(to)}`;
}

export const monthLabel = (month: string) => monthLong.format(toDate(`${month}-01`));
export const monthShortLabel = (month: string) => monthOnly.format(toDate(`${month}-01`));

export type VariationTone = "positive" | "negative" | "neutral";
export type Variation = { direction: "up" | "down" | "flat"; text: string; tone: VariationTone; reference: string };

type VariationOptions = { upIsGood: boolean; reference: string };

/** Percent change. Hidden when the previous value is 0, because the percentage would be meaningless. */
export function percentVariation(current: number, previous: number, { upIsGood, reference }: VariationOptions): Variation | null {
  if (previous === 0) return null;
  const percent = Math.round((Math.abs(current - previous) / previous) * 100);
  if (current === previous || percent === 0) return { direction: "flat", text: "Sin cambio", tone: "neutral", reference };
  const up = current > previous;
  return { direction: up ? "up" : "down", text: `${count(percent)} %`, tone: up === upIsGood ? "positive" : "negative", reference };
}

/** Change in days for a measure where going down is the good direction. Hidden when either average is missing. */
export function daysVariation(current: number | null, previous: number | null, { upIsGood, reference }: VariationOptions): Variation | null {
  if (current === null || previous === null) return null;
  const diff = Math.round((current - previous) * 10) / 10;
  if (diff === 0) return { direction: "flat", text: "Sin cambio", tone: "neutral", reference };
  const up = diff > 0;
  const amount = Math.abs(diff);
  return { direction: up ? "up" : "down", text: `${decimal(amount)} ${amount === 1 ? "día" : "días"}`, tone: up === upIsGood ? "positive" : "negative", reference };
}
