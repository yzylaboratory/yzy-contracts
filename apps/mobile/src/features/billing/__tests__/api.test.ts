import { ApiError } from '../../../lib/api/errors';
import { apiClient } from '../../../lib/api';
import { getBillingOverview, prepareRenewalInvoice, reportInvoiceTransfer } from '../api';
import { billingOverviewIsStale } from '../errors';
import { billingInvoiceSchema, billingOverviewSchema } from '../schema';
import { expectedTransferTotal } from '../transfer';
import type { BillingInvoice, BillingOverview } from '../types';

jest.mock('../../../lib/api', () => ({
  apiClient: { json: jest.fn() },
}));

const ACCOUNT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const COMPANY = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const INVOICE = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const MANAGER = 'ffffffff-ffff-4fff-8fff-ffffffffffff';

const invoice: BillingInvoice = {
  id: INVOICE,
  account_id: ACCOUNT,
  account_name: 'Cuenta Norte',
  period: '2026-08-01',
  due_on: '2026-08-10',
  state: 'pending',
  is_overdue: false,
  total_minor: 1_800_000,
  months: 1,
  discount_minor: 0,
  renewal_month_limit: 12,
  transfer_memo: 'MEMB-NORTE',
  lines: [{ company_id: COMPANY, company_name: 'Norte Legal', unit_price_minor: 900_000 }],
  transfer_reference: null,
  transfer_report_id: null,
  transfer_reported_at: null,
  paid_at: null,
};

const overview: BillingOverview = {
  accounts: [
    {
      id: ACCOUNT,
      company_id: null,
      name: 'Cuenta Norte',
      manager_user_id: MANAGER,
      starts_on: '2026-01-01',
      monthly_total_minor: 1_800_000,
      companies: [{ id: COMPANY, name: 'Norte Legal', price_usd_minor: null, unit_price_minor: 900_000 }],
    },
  ],
  invoices: [invoice],
  bank_account: null,
  pricing: {
    price_usd_minor: 15_000,
    exchange_rate_milli: 60_000,
    unit_price_minor: 900_000,
    revision: null,
    updated_at: null,
  },
};

describe('billing schemas', () => {
  it('accepts a BillingOverview and drops fields the app does not read', () => {
    const parsed = billingOverviewSchema.safeParse({ ...overview, notice: 'ignored' });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data).toEqual(overview);
    expect('notice' in parsed.data).toBe(false);
  });

  it('fails closed when a required field is missing or the wrong type', () => {
    const { invoices: _invoices, ...incomplete } = overview;
    expect(billingOverviewSchema.safeParse(incomplete).success).toBe(false);
    expect(billingOverviewSchema.safeParse({ ...overview, pricing: { ...overview.pricing, price_usd_minor: '15000' } }).success).toBe(false);
    expect(billingInvoiceSchema.safeParse({ ...invoice, state: 'void' }).success).toBe(false);
    expect(billingInvoiceSchema.safeParse({ ...invoice, transfer_reported_at: 'yesterday' }).success).toBe(false);
  });
});

describe('billing requests', () => {
  const json = jest.mocked(apiClient.json);

  beforeEach(() => {
    json.mockReset();
  });

  it('loads the overview with the billing schema', async () => {
    json.mockResolvedValue(overview);
    await expect(getBillingOverview()).resolves.toBe(overview);
    expect(json).toHaveBeenCalledWith('/billing', billingOverviewSchema);
  });

  it('prepares a renewal with POST and no body', async () => {
    json.mockResolvedValue(invoice);
    await prepareRenewalInvoice(ACCOUNT);
    expect(json).toHaveBeenCalledWith(
      `/billing/accounts/${ACCOUNT}/renewal-invoice`,
      billingInvoiceSchema,
      { method: 'POST' },
    );
  });

  it('reports a transfer with the portal total', async () => {
    json.mockResolvedValue({ ...invoice, state: 'in_review', months: 2, discount_minor: 360_000, total_minor: 3_240_000 });
    await reportInvoiceTransfer({
      invoiceId: INVOICE,
      reference: '  DEMO-RENOVACION  ',
      months: 2,
      renewalMonthLimit: 12,
      invoiceTotalMinor: 1_800_000,
    });
    expect(expectedTransferTotal(1_800_000, 2)).toEqual({ discountMinor: 360_000, expectedTotalMinor: 3_240_000 });
    expect(expectedTransferTotal(1_800_000, 1)).toEqual({ discountMinor: 0, expectedTotalMinor: 1_800_000 });
    expect(json).toHaveBeenCalledWith(`/billing/invoices/${INVOICE}/transfer`, billingInvoiceSchema, {
      method: 'PUT',
      body: { reference: 'DEMO-RENOVACION', months: 2, expected_total_minor: 3_240_000 },
    });
  });

  it('does not send a transfer with an empty reference or a duration outside 1..12 and the invoice limit', async () => {
    await expect(
      reportInvoiceTransfer({
        invoiceId: INVOICE,
        reference: '   ',
        months: 1,
        renewalMonthLimit: 12,
        invoiceTotalMinor: 1_800_000,
      }),
    ).rejects.toMatchObject({ status: 422, code: 'VALIDATION_ERROR' });
    await expect(
      reportInvoiceTransfer({
        invoiceId: INVOICE,
        reference: 'REF',
        months: 13,
        renewalMonthLimit: 12,
        invoiceTotalMinor: 1_800_000,
      }),
    ).rejects.toBeInstanceOf(ApiError);
    await expect(
      reportInvoiceTransfer({
        invoiceId: INVOICE,
        reference: 'REF',
        months: 3,
        renewalMonthLimit: 2,
        invoiceTotalMinor: 1_800_000,
      }),
    ).rejects.toBeInstanceOf(ApiError);
    expect(json).not.toHaveBeenCalled();
  });
});

describe('billing error refresh', () => {
  it('reloads after BILLING_CONFLICT and 404, and not after bank or validation errors', () => {
    expect(billingOverviewIsStale(new ApiError(409, 'BILLING_CONFLICT', 'El monto cambió.'))).toBe(true);
    expect(billingOverviewIsStale(new ApiError(404, 'BILLING_NOT_FOUND', 'No se encontró el recurso de facturación.'))).toBe(true);
    expect(
      billingOverviewIsStale(
        new ApiError(409, 'BILLING_BANK_REQUIRED', 'Configura la cuenta bancaria de transferencias antes de activar la facturación.'),
      ),
    ).toBe(false);
    expect(billingOverviewIsStale(new ApiError(422, 'VALIDATION_ERROR', 'Escribe la referencia de la transferencia.'))).toBe(false);
  });
});
