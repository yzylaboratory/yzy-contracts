import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { useRouter } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { randomUUID } from 'expo-crypto';
import { api, ApiError, type AvailableDocument, type Case, type DocumentMetadata, type Me } from '../../../lib/api';
import { GenerateScreen } from '../ui/GenerateScreen';

jest.mock('expo-router', () => ({
  useRouter: jest.fn(),
}));

jest.mock('expo-crypto', () => ({
  randomUUID: jest.fn(),
}));

jest.mock('../../../shared/ui/DateField', () => {
  const React = require('react');
  const { TextField } = require('../../../shared/ui/TextField');
  return {
    DateField: ({
      label,
      value,
      onChange,
      error,
    }: {
      label: string;
      value: string;
      onChange: (value: string) => void;
      error?: string;
    }) => React.createElement(TextField, { label, value, onChangeText: onChange, error }),
  };
});

jest.mock('../../access', () => ({
  useGate: jest.fn(),
}));

jest.mock('../../cases', () => ({
  useCaseDetail: jest.fn(),
}));

jest.mock('../../../lib/api', () => {
  const errors = jest.requireActual('../../../lib/api/errors');
  return {
    ...errors,
    api: {
      cases: {
        availableDocuments: jest.fn(),
        generateDocument: jest.fn(),
      },
    },
  };
});

const { useGate } = jest.requireMock('../../access') as { useGate: jest.Mock };
const { useCaseDetail } = jest.requireMock('../../cases') as { useCaseDetail: jest.Mock };

const replace = jest.fn();
const push = jest.fn();
const COMPANY_ID = '22222222-2222-4222-8222-222222222222';
const CASE_ID = '44444444-4444-4444-8444-444444444444';

function makeMe(overdueIds: string[] = []): Me {
  return {
    id: 'user-1',
    email: 'op@empresa.test',
    role: 'member',
    access: 'active',
    companies: [{ id: COMPANY_ID, name: 'Real SRL' }],
    overdue_company_ids: overdueIds,
    can_manage_billing: true,
    billing_company_ids: [COMPANY_ID],
    manageable_overdue_company_ids: overdueIds,
  };
}

function makeCase(overrides: Partial<Case> = {}): Case {
  return {
    id: CASE_ID,
    client_id: 'client-1',
    client_name: 'María Pérez',
    client_identity: '001-0000000-1',
    company_id: COMPANY_ID,
    company_name: 'Real SRL',
    reference: 'IAC-0007',
    contract_date: null,
    status: 'solicitud',
    vehicle: {
      kind: 'jeep',
      brand: 'Toyota',
      model: 'RAV4',
      year: '2022',
      color: null,
      registration: null,
      plate: null,
      chassis: null,
      engine: null,
    },
    created_at: '2026-11-16T12:00:00Z',
    request_date: '2026-11-16',
    signature_date: '2026-11-18',
    requested_amount_minor: 50_000_000,
    insurance_installment_minor: 150_000,
    insurance_paid: false,
    installment_minor: 1_000_000,
    installments_count: 12,
    updated_at: '2026-11-16T12:00:00Z',
    ...overrides,
  };
}

function makeAvailable(): AvailableDocument[] {
  return [
    {
      document_type: 'autorizacion_data',
      status: 'ready',
      candidates: [{ contract_id: 'tpl-data', name: 'Buró' }],
      latest_generated: { id: 'old-1', created_at: '2026-11-01T12:00:00Z', format: 'pdf' },
      operator_fields: [],
    },
    {
      document_type: 'venta_condicional',
      status: 'ambiguous',
      candidates: [
        { contract_id: 'tpl-vc-1', name: 'Venta A' },
        { contract_id: 'tpl-vc-2', name: 'Venta B' },
      ],
      latest_generated: null,
      operator_fields: [],
    },
    {
      document_type: 'acto_seguro',
      status: 'missing',
      candidates: [],
      latest_generated: null,
      operator_fields: [],
    },
    {
      document_type: 'autorizacion_desembolso',
      status: 'ready',
      candidates: [{ contract_id: 'tpl-desemb', name: 'Desembolso' }],
      latest_generated: null,
      operator_fields: [
        { key: 'distribucion_desembolso', label: 'Distribución del desembolso', kind: 'text', required: true },
      ],
    },
    {
      document_type: 'entrega_voluntaria',
      status: 'missing',
      candidates: [],
      latest_generated: null,
      operator_fields: [],
    },
    {
      document_type: 'carta_saldo',
      status: 'ready',
      candidates: [{ contract_id: 'tpl-carta', name: 'Carta Saldo' }],
      latest_generated: null,
      operator_fields: [
        { key: 'saldo_confirmado', label: 'Saldo confirmado (RD$)', kind: 'money', required: true },
        { key: 'fecha_saldo', label: 'Fecha de saldo', kind: 'date', required: true },
      ],
    },
  ];
}

function docMetadata(id: string, type: string): DocumentMetadata {
  return {
    id,
    document_type: type,
    contract_id: 'tpl',
    contract_name: type,
    format: 'pdf',
    filename: `${type}.pdf`,
    created_at: '2026-11-18T12:00:00Z',
    operation_id: CASE_ID,
    has_artifact: true,
    company: null,
  };
}

function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } }),
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  let uuidCounter = 0;
  jest.mocked(randomUUID).mockImplementation(() => `00000000-0000-4000-8000-00000000000${++uuidCounter}`);
  replace.mockReset();
  push.mockReset();
  jest.mocked(api.cases.availableDocuments).mockReset();
  jest.mocked(api.cases.generateDocument).mockReset();
  jest.mocked(useRouter).mockReturnValue({ replace, push } as unknown as ReturnType<typeof useRouter>);
  useGate.mockReturnValue({ me: makeMe() });
  useCaseDetail.mockReturnValue({
    caseQuery: { isPending: false, isError: false, data: makeCase() },
  });
});

describe('GenerateScreen', () => {
  it('renders the 6 Spanish groups, latest_generated hint, and missing explanations', async () => {
    useCaseDetail.mockReturnValue({
      caseQuery: { isPending: false, isError: false, data: makeCase({ insurance_paid: true }) },
    });
    jest.mocked(api.cases.availableDocuments).mockResolvedValue(makeAvailable());

    await render(<GenerateScreen caseId={CASE_ID} companyId={COMPANY_ID} />, { wrapper: Providers });

    expect(await screen.findByText('Solicitud y evaluación')).toBeOnTheScreen();
    expect(screen.getByText('Formalización del préstamo')).toBeOnTheScreen();
    expect(screen.getByText('Seguro del vehículo')).toBeOnTheScreen();
    expect(screen.getByText('Desembolso y entrega')).toBeOnTheScreen();
    expect(screen.getByText('Recuperación o incumplimiento')).toBeOnTheScreen();
    expect(screen.getByText('Cancelación y cierre del préstamo')).toBeOnTheScreen();

    expect(screen.getByText('Ya generado · se crea una versión nueva')).toBeOnTheScreen();
    expect(screen.getByText('El expediente indica que el seguro ya está pagado.')).toBeOnTheScreen();
    expect(screen.getByText('La empresa necesita una plantilla de Word compatible con este documento.')).toBeOnTheScreen();
    expect(screen.queryByText('Datos adicionales')).not.toBeOnTheScreen();
  });

  it('validates and sends scoped operator_values for carta_saldo and autorizacion_desembolso', async () => {
    jest.mocked(api.cases.availableDocuments).mockResolvedValue(makeAvailable());
    jest.mocked(api.cases.generateDocument).mockImplementation(async ({ documentId, body }) =>
      docMetadata(`gen-${documentId}`, body.document_type),
    );

    await render(<GenerateScreen caseId={CASE_ID} companyId={COMPANY_ID} />, { wrapper: Providers });

    await fireEvent.press(await screen.findByRole('checkbox', { name: /Autorización de desembolso/ }));
    await fireEvent.press(screen.getByRole('checkbox', { name: /Carta de saldo/ }));
    await fireEvent.press(screen.getByRole('checkbox', { name: /Autorización de revisión del buró de crédito/ }));

    expect(screen.getByText('Datos adicionales')).toBeOnTheScreen();

    // Try submitting empty operator fields -> shows inline validation errors and does not call API.
    await fireEvent.press(screen.getByRole('button', { name: 'Generar 3 documentos' }));
    expect(screen.getByText('Completa este campo.')).toBeOnTheScreen();
    expect(screen.getByText('Indica un monto mayor que cero.')).toBeOnTheScreen();
    expect(screen.getByText('Indica una fecha válida.')).toBeOnTheScreen();
    expect(api.cases.generateDocument).not.toHaveBeenCalled();

    // Fill all three operator fields (text, RD$ money, date) and switch format to Word.
    await fireEvent.changeText(screen.getByLabelText('Distribución del desembolso'), '100% al suplidor');
    await fireEvent.changeText(screen.getByLabelText('Saldo confirmado (RD$)'), '1250000');
    await fireEvent.changeText(screen.getByLabelText('Fecha de saldo'), '2026-11-18');
    await fireEvent.press(screen.getByText('Word'));

    await fireEvent.press(screen.getByRole('button', { name: 'Generar 3 documentos' }));

    await waitFor(() => {
      expect(api.cases.generateDocument).toHaveBeenCalledTimes(3);
    });

    const calls = jest.mocked(api.cases.generateDocument).mock.calls.map(([arg]) => arg.body);
    expect(calls).toEqual([
      {
        company_id: COMPANY_ID,
        document_type: 'autorizacion_data',
        format: 'docx',
      },
      {
        company_id: COMPANY_ID,
        document_type: 'autorizacion_desembolso',
        format: 'docx',
        operator_values: { distribucion_desembolso: '100% al suplidor' },
      },
      {
        company_id: COMPANY_ID,
        document_type: 'carta_saldo',
        format: 'docx',
        operator_values: { saldo_confirmado: 'RD$12,500.00', fecha_saldo: '2026-11-18' },
      },
    ]);
    expect(replace).toHaveBeenCalledWith({
      pathname: '/expedientes/[id]/listos',
      params: { id: CASE_ID, ids: expect.stringContaining('gen-') },
    });
  });

  it('handles 422 ambiguity by picking a template and retrying with the same documentId, and rotates on 409', async () => {
    jest.mocked(api.cases.availableDocuments).mockResolvedValue([
      {
        document_type: 'autorizacion_data',
        status: 'ready',
        candidates: [{ contract_id: 'tpl-data', name: 'Buró' }],
        latest_generated: null,
        operator_fields: [],
      },
    ]);
    jest.mocked(api.cases.generateDocument)
      .mockRejectedValueOnce(
        new ApiError(422, 'DOCUMENT_TEMPLATE_AMBIGUOUS', 'Hay varias plantillas.', {
          candidates: [
            { contract_id: 'tpl-1', name: 'Plantilla 1' },
            { contract_id: 'tpl-2', name: 'Plantilla 2' },
          ],
        }),
      )
      .mockRejectedValueOnce(new ApiError(409, 'GENERATED_DOCUMENT_CONFLICT', 'ID used.'))
      .mockResolvedValueOnce(docMetadata('final-id', 'autorizacion_data'));

    await render(<GenerateScreen caseId={CASE_ID} companyId={COMPANY_ID} />, { wrapper: Providers });

    await fireEvent.press(await screen.findByRole('checkbox', { name: /Autorización de revisión del buró de crédito/ }));
    await fireEvent.press(screen.getByRole('button', { name: 'Generar 1 documento' }));

    // 422 ambiguity shows candidate chips and disables retry until picked.
    expect(await screen.findByText('Plantilla 1')).toBeOnTheScreen();
    expect(screen.getByText('Elige la plantilla de Autorización de revisión del buró de crédito para continuar.')).toBeOnTheScreen();
    await fireEvent.press(screen.getByText('Plantilla 2'));
    await fireEvent.press(screen.getByRole('button', { name: 'Reintentar pendientes' }));

    // Second attempt used same documentId + contract_id tpl-2 and hit 409.
    await waitFor(() => {
      expect(api.cases.generateDocument).toHaveBeenCalledTimes(2);
    });
    const firstId = jest.mocked(api.cases.generateDocument).mock.calls[0]?.[0].documentId;
    const secondCall = jest.mocked(api.cases.generateDocument).mock.calls[1]?.[0];
    expect(secondCall?.documentId).toBe(firstId);
    expect(secondCall?.body.contract_id).toBe('tpl-2');
    expect(await screen.findByText('Este documento ya se generó con otros datos. Vuelve a intentarlo.')).toBeOnTheScreen();

    // Retry after 409 rotates to a fresh documentId and succeeds.
    await fireEvent.press(screen.getByRole('button', { name: 'Reintentar pendientes' }));
    await waitFor(() => {
      expect(api.cases.generateDocument).toHaveBeenCalledTimes(3);
    });
    const thirdId = jest.mocked(api.cases.generateDocument).mock.calls[2]?.[0].documentId;
    expect(thirdId).not.toBe(firstId);
  });

  it('stops the queue on 402 PAYMENT_REQUIRED and shows the billing notice', async () => {
    jest.mocked(api.cases.availableDocuments).mockResolvedValue([
      {
        document_type: 'autorizacion_data',
        status: 'ready',
        candidates: [{ contract_id: 'tpl-data', name: 'Buró' }],
        latest_generated: null,
        operator_fields: [],
      },
      {
        document_type: 'gps',
        status: 'ready',
        candidates: [{ contract_id: 'tpl-gps', name: 'GPS' }],
        latest_generated: null,
        operator_fields: [],
      },
    ]);
    jest
      .mocked(api.cases.generateDocument)
      .mockRejectedValueOnce(new ApiError(402, 'PAYMENT_REQUIRED', 'Facturación suspendida.'));

    await render(<GenerateScreen caseId={CASE_ID} companyId={COMPANY_ID} />, { wrapper: Providers });

    await fireEvent.press(await screen.findByRole('button', { name: 'Seleccionar todos' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Generar 2 documentos' }));

    expect(await screen.findByText('Facturación suspendida. Los pendientes quedaron sin generar.')).toBeOnTheScreen();
    expect(api.cases.generateDocument).toHaveBeenCalledTimes(1);
    expect(replace).not.toHaveBeenCalled();
  });

  it('blocks generation when the company is overdue', async () => {
    useGate.mockReturnValue({ me: makeMe([COMPANY_ID]) });
    jest.mocked(api.cases.availableDocuments).mockResolvedValue(makeAvailable());

    await render(<GenerateScreen caseId={CASE_ID} companyId={COMPANY_ID} />, { wrapper: Providers });

    expect(await screen.findByText('Bloqueada por falta de pago')).toBeOnTheScreen();
    expect(screen.getByText('Consultar mis facturas')).toBeOnTheScreen();
    expect(screen.getByRole('checkbox', { name: /Autorización de revisión del buró de crédito/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Generar 0 documentos' })).toBeDisabled();
  });
});
