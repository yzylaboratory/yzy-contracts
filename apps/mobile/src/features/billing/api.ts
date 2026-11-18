import { apiClient } from '../../lib/api';
import { ApiError } from '../../lib/api/errors';
import { billingInvoiceSchema, billingOverviewSchema } from './schema';
import { expectedTransferTotal, transferMonthsAllowed } from './transfer';
import type { BillingInvoice, BillingOverview } from './types';

export function getBillingOverview(): Promise<BillingOverview> {
  return apiClient.json('/billing', billingOverviewSchema);
}

export function prepareRenewalInvoice(billingAccountId: string): Promise<BillingInvoice> {
  return apiClient.json(
    `/billing/accounts/${encodeURIComponent(billingAccountId)}/renewal-invoice`,
    billingInvoiceSchema,
    { method: 'POST' },
  );
}

export async function reportInvoiceTransfer(input: {
  invoiceId: string;
  reference: string;
  months: number;
  renewalMonthLimit: number;
  invoiceTotalMinor: number;
}): Promise<BillingInvoice> {
  const reference = input.reference.trim();
  if (reference.length === 0) {
    throw new ApiError(422, 'VALIDATION_ERROR', 'Escribe la referencia de la transferencia.');
  }
  if (!transferMonthsAllowed(input.months, input.renewalMonthLimit)) {
    throw new ApiError(422, 'VALIDATION_ERROR', 'La duración elegida no está disponible para esta factura.');
  }
  const { expectedTotalMinor } = expectedTransferTotal(input.invoiceTotalMinor, input.months);
  if (!Number.isSafeInteger(expectedTotalMinor)) {
    throw new ApiError(422, 'VALIDATION_ERROR', 'El total a transferir no es válido.');
  }
  return apiClient.json(
    `/billing/invoices/${encodeURIComponent(input.invoiceId)}/transfer`,
    billingInvoiceSchema,
    {
      method: 'PUT',
      body: {
        reference,
        months: input.months,
        expected_total_minor: expectedTotalMinor,
      },
    },
  );
}
