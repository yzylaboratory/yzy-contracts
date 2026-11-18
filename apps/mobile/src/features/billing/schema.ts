import { z } from 'zod';
import { isoDate, isoDateTime } from '../../lib/api/http/wire-schema';

// Missing fields and wrong types fail closed. Unknown fields are ignored, same as /me (plan decision D3).
const safeInt = z.number().int().min(Number.MIN_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER);

export const billingCompanySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  price_usd_minor: safeInt.nullable(),
  unit_price_minor: safeInt,
});

export const billingAccountSchema = z.object({
  id: z.uuid(),
  company_id: z.uuid().nullable(),
  name: z.string(),
  manager_user_id: z.uuid(),
  starts_on: isoDate,
  companies: z.array(billingCompanySchema),
  monthly_total_minor: safeInt,
});

export const invoiceLineSchema = z.object({
  company_id: z.uuid(),
  company_name: z.string(),
  unit_price_minor: safeInt,
});

export const invoiceStateSchema = z.enum(['pending', 'in_review', 'paid']);

export const billingInvoiceSchema = z.object({
  id: z.uuid(),
  account_id: z.uuid(),
  account_name: z.string(),
  period: isoDate,
  due_on: isoDate,
  state: invoiceStateSchema,
  is_overdue: z.boolean(),
  total_minor: safeInt,
  months: safeInt,
  discount_minor: safeInt,
  renewal_month_limit: safeInt,
  transfer_memo: z.string(),
  lines: z.array(invoiceLineSchema),
  transfer_reference: z.string().nullable(),
  transfer_report_id: z.uuid().nullable(),
  transfer_reported_at: isoDateTime.nullable(),
  paid_at: isoDateTime.nullable(),
});

export const bankAccountSchema = z.object({
  bank_name: z.string(),
  account_holder: z.string(),
  account_type: z.string(),
  account_number: z.string(),
});

export const billingPricingSchema = z.object({
  price_usd_minor: safeInt,
  exchange_rate_milli: safeInt,
  unit_price_minor: safeInt,
  revision: z.uuid().nullable(),
  updated_at: isoDateTime.nullable(),
});

export const billingOverviewSchema = z.object({
  accounts: z.array(billingAccountSchema),
  invoices: z.array(billingInvoiceSchema),
  bank_account: bankAccountSchema.nullable(),
  pricing: billingPricingSchema,
});
