// Amounts are integer minor units (centavos) on the wire, as the plan requires (*_minor).

export function formatMinor(minor: number): string {
  const negative = minor < 0;
  const abs = Math.abs(minor);
  const whole = Math.floor(abs / 100);
  const cents = String(abs % 100).padStart(2, '0');
  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}RD$${grouped}.${cents}`;
}

// Digits-only mask: typing fills from the right, like a cents-based money field.
export function maskMoneyInput(raw: string): string {
  const digits = raw.replace(/\D/g, '').replace(/^0+(?=\d)/, '');
  if (digits.length === 0) return '';
  return formatMinor(Number(digits));
}

// Parses the masked text back into minor units. Returns null when empty.
export function parseMoneyToMinor(masked: string): number | null {
  const digits = masked.replace(/\D/g, '');
  if (digits.length === 0) return null;
  return Number(digits);
}

export function minorToMaskedInput(minor: number | null): string {
  if (minor === null) return '';
  return formatMinor(minor);
}
