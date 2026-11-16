const grouping = new Intl.NumberFormat("es-DO", { maximumFractionDigits: 0 });

export function parseAmountMinor(value: string) {
  const trimmed = value.trim();
  const normalized = /^RD\$|\.|,\d{3}(?:,|$)/.test(trimmed)
    ? trimmed.replace(/^RD\$\s*/, "").replace(/,/g, "")
    : trimmed.replace(",", ".");
  if (!/^\d+(?:\.\d{0,2})?$/.test(normalized)) return;
  const [whole, fraction = ""] = normalized.split(".");
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (Number.isSafeInteger(minor)) return minor;
}

export function amountInputValue(minor: number) {
  const whole = Math.floor(minor / 100);
  const fraction = String(minor % 100).padStart(2, "0");
  return `${whole}.${fraction}`;
}

export function formatMoneyInput(minor: number) {
  const whole = Math.floor(minor / 100);
  const fraction = String(minor % 100).padStart(2, "0");
  return `RD$${grouping.format(whole)}.${fraction}`;
}
