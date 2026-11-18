import { z } from 'zod';
import { isValidIsoDate } from '../../shared/format/date';
import { parseMoneyToMinor } from '../../shared/format/money';
import { maxMonthlyInstallments } from './domain/payment-plan';

// Client-side format checks only. Business rules (plan decisions on calendar, limits and
// billing) stay in the backend, so they are not duplicated here.
const isoDate = z.string().refine(isValidIsoDate, { error: 'Usa el formato AAAA-MM-DD.' });
const optionalIsoDate = z.union([z.literal(''), isoDate]);
const money = z.string();

export const clientFormSchema = z.strictObject({
  name: z.string().trim().min(2, { error: 'Escribe el nombre del cliente.' }).max(120),
  identity: z
    .string()
    .trim()
    .refine((value) => value === '' || /^\d{3}-?\d{7}-?\d$/.test(value), { error: 'Usa la cédula con formato 001-0000000-1.' }),
  phone: z.string().trim().max(20),
});

export function parseInsuranceInstallmentCount(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^\d{1,3}$/.test(trimmed)) return null;
  const count = Number(trimmed);
  return Number.isInteger(count) && count >= 1 && count <= maxMonthlyInstallments ? count : null;
}

export const requestStepSchema = z
  .strictObject({
    requestDate: isoDate,
    signDate: optionalIsoDate,
    requestedAmount: money.refine((value) => (parseMoneyToMinor(value) ?? 0) > 0, {
      error: 'Escribe el monto solicitado.',
    }),
    insurancePaid: z.boolean().optional(),
    insuranceInstallment: money,
    insuranceInstallmentCount: z.string().optional(),
    installmentsCount: z
      .string()
      .refine((value) => /^\d+$/.test(value) && Number(value) >= 1, { error: 'Escribe la cantidad de cuotas.' }),
  })
  .superRefine((data, ctx) => {
    const shouldValidate =
      data.insurancePaid === false ||
      (data.insurancePaid === undefined && data.insuranceInstallmentCount !== undefined);
    if (!shouldValidate) return;
    if (parseInsuranceInstallmentCount(data.insuranceInstallmentCount ?? '') === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['insuranceInstallmentCount'],
        message: `Indica un número entero entre 1 y ${maxMonthlyInstallments}.`,
      });
    }
  });

export const planStepSchema = z.strictObject({
  installment: money.refine((value) => (parseMoneyToMinor(value) ?? 0) > 0, {
    error: 'Escribe el monto de cada cuota.',
  }),
});

export function normalizeIdentity(value: string): string {
  const digits = value.replace(/\D/g, '');
  return digits.length === 11 ? `${digits.slice(0, 3)}-${digits.slice(3, 10)}-${digits.slice(10)}` : value;
}
