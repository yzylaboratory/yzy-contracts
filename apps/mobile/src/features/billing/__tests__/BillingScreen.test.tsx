import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { useState, type ReactNode } from 'react';
import { ApiError } from '../../../lib/api/errors';
import { getBillingOverview, prepareRenewalInvoice, reportInvoiceTransfer } from '../api';
import { billingAmount } from '../presentation';
import type { BillingInvoice, BillingOverview } from '../types';
import { BillingScreen } from '../ui/BillingScreen';

jest.mock('../api', () => ({
  getBillingOverview: jest.fn(),
  prepareRenewalInvoice: jest.fn(),
  reportInvoiceTransfer: jest.fn(),
}));

const ACCOUNT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const COMPANY = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const PENDING = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const IN_REVIEW = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const PAID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

function invoice(overrides: Partial<BillingInvoice> & Pick<BillingInvoice, 'id' | 'period' | 'due_on' | 'state'>): BillingInvoice {
  return {
    account_id: ACCOUNT,
    account_name: 'Cuenta Norte',
    is_overdue: false,
    total_minor: 1_800_000,
    months: 1,
    discount_minor: 0,
    renewal_month_limit: 12,
    transfer_memo: 'MEMB-NORTE',
    lines: [{ company_id: COMPANY, company_name: 'Norte Legal', unit_price_minor: 1_800_000 }],
    transfer_reference: null,
    transfer_report_id: null,
    transfer_reported_at: null,
    paid_at: null,
    ...overrides,
  };
}

const overview: BillingOverview = {
  accounts: [
    {
      id: ACCOUNT,
      company_id: COMPANY,
      name: 'Cuenta Norte',
      manager_user_id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      starts_on: '2026-01-01',
      monthly_total_minor: 1_800_000,
      companies: [
        { id: COMPANY, name: 'Norte Legal', price_usd_minor: 15_000, unit_price_minor: 1_800_000 },
      ],
    },
  ],
  invoices: [
    invoice({ id: PENDING, period: '2026-08-01', due_on: '2026-08-10', state: 'pending', is_overdue: true }),
    invoice({ id: IN_REVIEW, period: '2026-09-01', due_on: '2026-09-10', state: 'in_review' }),
    invoice({
      id: PAID,
      period: '2026-07-01',
      due_on: '2026-07-10',
      state: 'paid',
      paid_at: '2026-07-08T15:00:00Z',
    }),
  ],
  bank_account: {
    bank_name: 'Banco BHD León',
    account_holder: 'YZY Labs, SRL',
    account_type: 'Cuenta corriente',
    account_number: '1234567890',
  },
  pricing: {
    price_usd_minor: 15_000,
    exchange_rate_milli: 60_000,
    unit_price_minor: 900_000,
    revision: null,
    updated_at: null,
  },
};

function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: false, gcTime: Infinity },
          mutations: { retry: false, gcTime: Infinity },
        },
      }),
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  jest.mocked(getBillingOverview).mockReset();
  jest.mocked(prepareRenewalInvoice).mockReset();
  jest.mocked(reportInvoiceTransfer).mockReset();
  jest.mocked(getBillingOverview).mockResolvedValue(overview);
  jest.mocked(reportInvoiceTransfer).mockResolvedValue({
    ...overview.invoices[0]!,
    state: 'in_review',
    transfer_reference: 'REF-99887766',
  });
});

describe('BillingScreen', () => {
  it('renders the overview returned by the API', async () => {
    await render(<BillingScreen />, { wrapper: Providers });

    expect(await screen.findByText('Membresías')).toBeOnTheScreen();
    expect(screen.getAllByText('Cuenta Norte').length).toBeGreaterThan(0);
    expect(screen.getByText('1 Registrada')).toBeOnTheScreen();
    expect(screen.getAllByText(billingAmount(1_800_000)).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('1 membresía')).toBeOnTheScreen();
    expect(
      screen.getByText(
        'Hay facturas vencidas. Las funciones de trabajo de las empresas bloqueadas se reactivarán al confirmar el pago pendiente.',
      ),
    ).toBeOnTheScreen();
    expect(screen.getAllByText('Vencida').length).toBeGreaterThanOrEqual(1);
  });

  it('shows an empty state when the API returns no accounts', async () => {
    jest.mocked(getBillingOverview).mockResolvedValue({
      ...overview,
      accounts: [],
      invoices: [],
      bank_account: null,
    });
    await render(<BillingScreen />, { wrapper: Providers });

    expect(await screen.findByText('Sin cuentas de facturación')).toBeOnTheScreen();
    expect(screen.getByText('Todavía no tienes cuentas de facturación.')).toBeOnTheScreen();
    expect(screen.queryByText('Total mensual')).toBeNull();
    expect(screen.queryByText(billingAmount(1_800_000))).toBeNull();
  });

  it('shows the API error and retries the overview', async () => {
    jest.mocked(getBillingOverview).mockReset();
    jest
      .mocked(getBillingOverview)
      .mockRejectedValueOnce(new ApiError(503, 'SERVICE_UNAVAILABLE', 'La facturación no responde.'));
    jest.mocked(getBillingOverview).mockResolvedValue(overview);

    await render(<BillingScreen />, { wrapper: Providers });

    expect(await screen.findByText('La facturación no responde.')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Reintentar' }));
    expect((await screen.findAllByText('Cuenta Norte')).length).toBeGreaterThan(0);
    expect(getBillingOverview).toHaveBeenCalledTimes(2);
  });

  it('keeps the loading state until the overview arrives', async () => {
    jest.mocked(getBillingOverview).mockReturnValue(new Promise(() => undefined));
    await render(<BillingScreen />, { wrapper: Providers });
    expect(await screen.findByText('Cargando membresía…')).toBeOnTheScreen();
    expect(screen.queryByText('Total mensual')).toBeNull();
  });

  it('changes the history list when switching filters', async () => {
    await render(<BillingScreen />, { wrapper: Providers });
    expect(await screen.findByText('Membresías')).toBeOnTheScreen();

    expect(screen.getAllByText('Pagar factura').length).toBeGreaterThanOrEqual(1);

    await fireEvent.press(screen.getByRole('tab', { name: 'Pagadas' }));
    expect(await screen.findByText('Pagada')).toBeOnTheScreen();
    expect(screen.getByText('Ver factura')).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('tab', { name: 'En revisión' }));
    expect(screen.getAllByText('En revisión').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('septiembre de 2026')).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('tab', { name: 'Pendientes' }));
    expect(await screen.findAllByText('Pagar factura')).toBeTruthy();
  });

  it('requires a reference and then confirms the reported transfer', async () => {
    await render(<BillingScreen />, { wrapper: Providers });
    expect(await screen.findByText('Membresías')).toBeOnTheScreen();

    const payButtons = await screen.findAllByText('Pagar factura');
    await fireEvent.press(payButtons[0]!);

    expect(await screen.findByText('Pago de membresía')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Pagar por transferencia' }));
    expect(await screen.findByText('Datos de la transferencia')).toBeOnTheScreen();
    expect(screen.getByText('Banco BHD León')).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('button', { name: 'Reportar transferencia' }));
    expect(
      await screen.findByText('Ingresa la referencia que aparece en tu comprobante bancario.'),
    ).toBeOnTheScreen();
    expect(reportInvoiceTransfer).not.toHaveBeenCalled();

    await fireEvent.changeText(screen.getByLabelText('Número de referencia'), '  REF-99887766  ');
    await fireEvent.press(screen.getByRole('button', { name: 'Reportar transferencia' }));

    expect(await screen.findByText('Transferencia reportada')).toBeOnTheScreen();
    expect(reportInvoiceTransfer).toHaveBeenCalledWith({
      invoiceId: PENDING,
      reference: 'REF-99887766',
      months: 1,
      renewalMonthLimit: 12,
      invoiceTotalMinor: 1_800_000,
    });

    await fireEvent.press(screen.getByRole('button', { name: 'Listo' }));
    expect(
      await screen.findByText('Transferencia reportada. Puedes consultar aquí el resultado de la revisión.'),
    ).toBeOnTheScreen();
  });

  it('shows the API message and reloads the overview on BILLING_CONFLICT', async () => {
    jest.mocked(reportInvoiceTransfer).mockRejectedValue(
      new ApiError(409, 'BILLING_CONFLICT', 'La factura ya tiene una transferencia reportada o pagada.'),
    );
    await render(<BillingScreen />, { wrapper: Providers });
    expect(await screen.findByText('Membresías')).toBeOnTheScreen();
    const callsBefore = jest.mocked(getBillingOverview).mock.calls.length;

    await fireEvent.press((await screen.findAllByText('Pagar factura'))[0]!);
    await fireEvent.press(screen.getByRole('button', { name: 'Pagar por transferencia' }));
    await fireEvent.changeText(screen.getByLabelText('Número de referencia'), 'REF-1');
    await fireEvent.press(screen.getByRole('button', { name: 'Reportar transferencia' }));

    expect(
      await screen.findByText('La factura ya tiene una transferencia reportada o pagada.'),
    ).toBeOnTheScreen();
    expect(screen.queryByText('Transferencia reportada')).toBeNull();
    await waitFor(() => {
      expect(jest.mocked(getBillingOverview).mock.calls.length).toBeGreaterThan(callsBefore);
    });
  });

  it('shows a 422 message from the API', async () => {
    jest.mocked(reportInvoiceTransfer).mockRejectedValue(
      new ApiError(422, 'VALIDATION_ERROR', 'Escribe la referencia de la transferencia.'),
    );
    await render(<BillingScreen />, { wrapper: Providers });
    expect(await screen.findByText('Membresías')).toBeOnTheScreen();
    const callsBefore = jest.mocked(getBillingOverview).mock.calls.length;

    await fireEvent.press((await screen.findAllByText('Pagar factura'))[0]!);
    await fireEvent.press(screen.getByRole('button', { name: 'Pagar por transferencia' }));
    await fireEvent.changeText(screen.getByLabelText('Número de referencia'), 'REF-422');
    await fireEvent.press(screen.getByRole('button', { name: 'Reportar transferencia' }));

    expect(await screen.findByText('Escribe la referencia de la transferencia.')).toBeOnTheScreen();
    expect(jest.mocked(getBillingOverview).mock.calls.length).toBe(callsBefore);
  });

  it('shows BILLING_NOT_FOUND and BILLING_BANK_REQUIRED from the API', async () => {
    const paidOnly: BillingOverview = {
      ...overview,
      invoices: [
        invoice({
          id: PAID,
          period: '2026-07-01',
          due_on: '2026-07-10',
          state: 'paid',
          paid_at: '2026-07-08T15:00:00Z',
        }),
      ],
    };
    jest.mocked(getBillingOverview).mockResolvedValue(paidOnly);
    jest.mocked(prepareRenewalInvoice).mockRejectedValueOnce(
      new ApiError(404, 'BILLING_NOT_FOUND', 'No se encontró el recurso de facturación.'),
    );
    await render(<BillingScreen />, { wrapper: Providers });
    expect(await screen.findByText('Membresías')).toBeOnTheScreen();
    const callsBefore = jest.mocked(getBillingOverview).mock.calls.length;

    await fireEvent.press(screen.getByRole('button', { name: 'Ver detalles' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Renovar membresía' }));
    expect(await screen.findByText('No se encontró el recurso de facturación.')).toBeOnTheScreen();
    await waitFor(() => {
      expect(jest.mocked(getBillingOverview).mock.calls.length).toBeGreaterThan(callsBefore);
    });

    jest.mocked(prepareRenewalInvoice).mockRejectedValueOnce(
      new ApiError(
        409,
        'BILLING_BANK_REQUIRED',
        'Configura la cuenta bancaria de transferencias antes de activar la facturación.',
      ),
    );
    const callsAfterNotFound = jest.mocked(getBillingOverview).mock.calls.length;
    await fireEvent.press(screen.getByRole('button', { name: 'Renovar membresía' }));
    expect(
      await screen.findByText('Configura la cuenta bancaria de transferencias antes de activar la facturación.'),
    ).toBeOnTheScreen();
    expect(jest.mocked(getBillingOverview).mock.calls.length).toBe(callsAfterNotFound);
  });
});
