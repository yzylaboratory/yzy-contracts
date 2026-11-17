import { paymentDateAfterMonths } from "../contratos/expediente-fields";
import { formatMoneyInput, parseAmountMinor } from "./amount-input";
import type { Financing, Payment } from "./clients-api";

export const maxMonthlyInstallments = 1200;

export type InstallmentDraft = { date: string; amount: string };

export function calculateMonthlyPayments(signature: string | null | undefined, amount: number, count: number, capital: number): Payment[] {
  if (!Number.isSafeInteger(amount) || amount <= 0 || !Number.isInteger(count) || count < 1 ||
      count > maxMonthlyInstallments || !Number.isSafeInteger(capital + count * amount) ||
      !paymentDateAfterMonths(signature, count)) return [];

  return Array.from({ length: count }, (_, index) => ({
    date: paymentDateAfterMonths(signature, index + 1)!,
    amount_minor: index === count - 1 ? capital + amount : amount,
  }));
}

export function installmentDraft(payment: Payment): InstallmentDraft {
  return { date: payment.date, amount: formatMoneyInput(payment.amount_minor) };
}

/** Builds or clears the installment table as monto and cantidad become valid. */
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
  const outOfRange = canCalculate && (!Number.isSafeInteger(capital + count * amount) || !paymentDateAfterMonths(signature, count));
  return {
    amount: amountText,
    count: countText,
    rows: canCalculate && !outOfRange
      ? calculateMonthlyPayments(signature, amount, count, capital).map(installmentDraft)
      : [],
  };
}

export function planCalculationOutOfRange(
  signature: string | null | undefined,
  capital: number,
  amountText: string,
  countText: string,
) {
  const amount = parseAmountMinor(amountText) ?? 0;
  const count = /^\d+$/.test(countText) ? Number(countText) : 0;
  const validCount = Number.isInteger(count) && count >= 1 && count <= maxMonthlyInstallments;
  const canCalculate = Boolean(signature) && capital > 0 && amount > 0 && validCount;
  return canCalculate && (!Number.isSafeInteger(capital + count * amount) || !paymentDateAfterMonths(signature, count));
}

export function validateMonthlyPayments(rows: InstallmentDraft[], latestDate?: string) {
  const payments: Payment[] = [];
  let total = 0;
  const errors = rows.map(({ date, amount }, index) => {
    const validDate = paymentDateAfterMonths(date, 0);
    const amountMinor = parseAmountMinor(amount);
    if (amountMinor !== undefined) total += amountMinor;
    payments.push({ date, amount_minor: amountMinor ?? 0 });

    return {
      date: !validDate ? "Indica una fecha válida."
        : index > 0 && date <= rows[index - 1].date ? "Debe ser posterior a la cuota anterior."
        : latestDate && date > latestDate ? "La fecha supera el plazo máximo." : undefined,
      amount: amountMinor === undefined || amountMinor <= 0 ? "Indica un monto mayor que cero." : undefined,
    };
  });
  const totalError = !Number.isSafeInteger(total);
  const final = payments.at(-1);
  const plan: Pick<Financing, "interest_installments" | "final_principal"> | undefined =
    final && !totalError && !errors.some(error => error.date || error.amount)
      ? { interest_installments: payments.slice(0, -1), final_principal: final }
      : undefined;
  return { errors, plan, total, totalError };
}
