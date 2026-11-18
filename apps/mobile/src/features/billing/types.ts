import type { z } from 'zod';
import type {
  bankAccountSchema,
  billingAccountSchema,
  billingCompanySchema,
  billingInvoiceSchema,
  billingOverviewSchema,
  billingPricingSchema,
} from './schema';

export type BillingCompany = z.infer<typeof billingCompanySchema>;
export type BillingAccount = z.infer<typeof billingAccountSchema>;
export type BillingPricing = z.infer<typeof billingPricingSchema>;
export type BillingInvoice = z.infer<typeof billingInvoiceSchema>;
export type BankAccount = z.infer<typeof bankAccountSchema>;
export type BillingOverview = z.infer<typeof billingOverviewSchema>;

export type HistoryFilter = 'all' | 'pending' | 'in_review' | 'paid';
export type PaymentStep = 'invoice' | 'transfer' | 'confirmation';
export type TransferDraft = { reference: string; duration: number };
