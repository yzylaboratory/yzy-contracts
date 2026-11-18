// Portal facturación: subtotal = invoice.total_minor * months; 10% off, floored, from the second month.
export function expectedTransferTotal(invoiceTotalMinor: number, months: number): {
  discountMinor: number;
  expectedTotalMinor: number;
} {
  const subtotal = invoiceTotalMinor * months;
  const discountMinor = months > 1 ? Math.floor(subtotal / 10) : 0;
  return { discountMinor, expectedTotalMinor: subtotal - discountMinor };
}

export function transferMonthsAllowed(months: number, renewalMonthLimit: number): boolean {
  return Number.isInteger(months) && months >= 1 && months <= 12 && months <= renewalMonthLimit;
}
