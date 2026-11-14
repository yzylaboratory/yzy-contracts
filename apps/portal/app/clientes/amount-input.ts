export function parseAmountMinor(value: string) {
  const amount = value.trim().replace(",", ".");
  if (!/^\d+(?:\.\d{1,2})?$/.test(amount)) return;
  const [whole, fraction = ""] = amount.split(".");
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (Number.isSafeInteger(minor)) return minor;
}

export function amountInputValue(minor: number) {
  const whole = Math.floor(minor / 100);
  const fraction = String(minor % 100).padStart(2, "0");
  return `${whole}.${fraction}`;
}
