import type { SupabaseClient } from '@supabase/supabase-js';
import { File } from 'expo-file-system';
import type { CaseWrite, CompanyAccess } from '../../contract';
import { ApiError } from '../../errors';
import { createApiClient } from '../client';
import { createHttpCasesApi } from '../cases';

jest.mock('expo-file-system', () => {
  class MockFile {
    static writes: ArrayBuffer[] = [];
    uri: string;
    name: string;
    exists = false;
    constructor(_directory: unknown, filename: string) {
      this.name = filename;
      this.uri = `file:///cache/${filename}`;
    }
    delete(): void {
      this.exists = false;
    }
    create(): void {
      this.exists = true;
    }
    async write(bytes: ArrayBuffer): Promise<void> {
      MockFile.writes.push(bytes);
    }
  }
  return { File: MockFile, Paths: { cache: 'cache://yzy' } };
});

const API_URL = 'https://api.example.test';
const COMPANY = '22222222-2222-4222-8222-222222222222';
const CLIENT = '33333333-3333-4333-8333-333333333333';
const CASE_ID = '44444444-4444-4444-8444-444444444444';
const DOC = '55555555-5555-4555-8555-555555555555';
const EVENT = '66666666-6666-4666-8666-666666666666';

const companies: readonly CompanyAccess[] = [{ id: COMPANY, name: 'Real SRL' }];

type FileMock = typeof File & { writes: ArrayBuffer[] };

function written(): ArrayBuffer[] {
  return (File as unknown as FileMock).writes;
}

function fakeClient(): SupabaseClient {
  return {
    auth: {
      getSession: async () => ({
        data: { session: { access_token: 'tok', user: { id: 'account' } } },
        error: null,
      }),
    },
  } as unknown as SupabaseClient;
}

function jsonResponse(status: number, body: unknown) {
  return {
    status,
    headers: { get: () => null },
    json: async () => body,
    arrayBuffer: async () => new ArrayBuffer(0),
  };
}

function clientBody() {
  return {
    id: CLIENT,
    name: 'MARÍA PÉREZ',
    identity: '001-0000000-1',
    address: null,
    phone: '8095550000',
    email: null,
    income_source: null,
    created_at: '2026-10-01T12:00:00Z',
    updated_at: '2026-10-02T12:00:00Z',
  };
}

function operationBody(overrides: Record<string, unknown> = {}) {
  return {
    id: CASE_ID,
    company_id: COMPANY,
    client_id: CLIENT,
    contract_id: null,
    reference: 'IAC-0007',
    status: 'solicitud',
    contract_date: '2026-11-20',
    signature_date: '2026-11-18',
    insurance_installment_minor: 150000,
    insurance_paid: false,
    vehicle: { make: 'TOYOTA', model: 'COROLLA', vehicle_type: 'JEEP', registration_number: 'ABC123' },
    application: { application_date: '2026-10-15', requested_amount_minor: 50000000 },
    financing: {
      interest_installments: [{ date: '2026-12-01', amount_minor: 1000000 }],
      final_principal: { date: '2027-01-01', amount_minor: 50000000 },
      extraordinary_payments: [],
    },
    created_at: '2026-10-01T15:00:00Z',
    updated_at: '2026-10-02T15:00:00Z',
    ...overrides,
  };
}

const caseWrite: CaseWrite = {
  company_id: COMPANY,
  application: { application_date: '2026-10-15', requested_amount_minor: 50000000 },
  signature_date: '2026-11-18',
  insurance_installment_minor: null,
  insurance_paid: true,
  vehicle: {
    kind: 'jeep',
    brand: 'toyota',
    model: 'corolla',
    year: null,
    color: null,
    registration: 'abc123',
    plate: null,
    chassis: null,
    engine: null,
  },
  financing: {
    interest_installments: [{ date: '2026-12-01', amount_minor: 1000000 }],
    final_principal: { date: '2027-01-01', amount_minor: 50000000 },
    extraordinary_payments: [],
    extraordinary_from_signature: true,
    extraordinary_payment_count: 0,
    insurance_installment_count: null,
  },
};

describe('cases client', () => {
  const originalFetch = global.fetch;
  const api = () => createHttpCasesApi(createApiClient(fakeClient(), API_URL));

  beforeEach(() => {
    written().splice(0, written().length);
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('maps a list row, including the vehicle rename', async () => {
    global.fetch = jest.fn(async () =>
      jsonResponse(200, {
        items: [
          {
            id: CASE_ID,
            client_id: CLIENT,
            client_name: 'María Pérez',
            client_identity: null,
            company_id: COMPANY,
            company_name: 'Real SRL',
            reference: 'IAC-0007',
            contract_date: null,
            status: 'en_proceso',
            vehicle: { make: 'TOYOTA', vehicle_type: 'JEEP' },
            created_at: '2026-11-01T12:00:00Z',
          },
        ],
        total: 1,
        page: 1,
        per_page: 20,
      }),
    ) as unknown as typeof fetch;

    const page = await api().list({ companyId: COMPANY, q: 'maría', status: 'en_proceso', page: 1, perPage: 20 });

    expect(page.items[0]).toEqual(
      expect.objectContaining({
        client_name: 'María Pérez',
        vehicle: expect.objectContaining({ brand: 'TOYOTA', kind: 'JEEP', model: null, registration: null }),
      }),
    );
    const url = new URL(String((global.fetch as jest.Mock).mock.calls[0]?.[0]));
    expect(url.searchParams.get('company_id')).toBe(COMPANY);
    expect(url.searchParams.get('status')).toBe('en_proceso');
    expect(url.searchParams.get('q')).toBe('maría');
  });

  it('builds the detail from the operation, the client and the caller company list', async () => {
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes(`/clients/${CLIENT}`)) return jsonResponse(200, clientBody());
      return jsonResponse(200, operationBody());
    }) as unknown as typeof fetch;

    const item = await api().get(CASE_ID, companies);

    expect(item).toEqual(
      expect.objectContaining({
        id: CASE_ID,
        client_name: 'MARÍA PÉREZ',
        client_identity: '001-0000000-1',
        company_name: 'Real SRL',
        request_date: '2026-10-15',
        requested_amount_minor: 50000000,
        installment_minor: 1000000,
        installments_count: 2,
        signature_date: '2026-11-18',
        insurance_installment_minor: 150000,
        vehicle: expect.objectContaining({ brand: 'TOYOTA', kind: 'JEEP', registration: 'ABC123' }),
      }),
    );
  });

  it('derives the request date from created_at when the application is absent', async () => {
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes(`/clients/${CLIENT}`)) return jsonResponse(200, clientBody());
      return jsonResponse(200, operationBody({ application: null, financing: null, insurance_installment_minor: null }));
    }) as unknown as typeof fetch;

    const item = await api().get(CASE_ID, companies);
    expect(item.request_date).toBe('2026-10-01');
    expect(item.requested_amount_minor).toBeNull();
    expect(item.installment_minor).toBeNull();
    expect(item.installments_count).toBeNull();
    expect(item.insurance_installment_minor).toBeNull();
  });

  it('posts the operation write subset and does not send monthly_plan or a zero insurance amount', async () => {
    const fetchMock = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === 'POST') return jsonResponse(201, operationBody());
      if (url.includes(`/clients/${CLIENT}`)) return jsonResponse(200, clientBody());
      throw new Error(url);
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const created = await api().create(CLIENT, caseWrite, companies);
    expect(created.company_name).toBe('Real SRL');

    const post = fetchMock.mock.calls.find((call) => (call[1] as RequestInit | undefined)?.method === 'POST');
    const body = JSON.parse(String((post?.[1] as RequestInit).body)) as Record<string, unknown>;
    expect(body.insurance_installment_minor).toBeNull();
    expect(body.insurance_paid).toBe(true);
    expect(body.vehicle).toEqual(
      expect.objectContaining({ vehicle_type: 'jeep', make: 'toyota', registration_number: 'abc123' }),
    );
    expect(body).not.toHaveProperty('monthly_plan');
    expect(body).not.toHaveProperty('reference');
    expect((body.financing as Record<string, unknown>).insurance_installment_count).toBeNull();
    expect(body).not.toHaveProperty('contract_date');
  });

  it('patches only the status', async () => {
    const fetchMock = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === 'PATCH') return jsonResponse(200, operationBody({ status: 'firma' }));
      if (url.includes(`/clients/${CLIENT}`)) return jsonResponse(200, clientBody());
      throw new Error(url);
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const updated = await api().updateStatus({
      companyId: COMPANY,
      clientId: CLIENT,
      operationId: CASE_ID,
      status: 'firma',
      companies,
    });
    expect(updated.status).toBe('firma');
    const patch = fetchMock.mock.calls.find((call) => (call[1] as RequestInit | undefined)?.method === 'PATCH');
    expect(String(patch?.[0])).toContain(`/companies/${COMPANY}/clients/${CLIENT}/operations/${CASE_ID}`);
    expect(JSON.parse(String((patch?.[1] as RequestInit).body))).toEqual({ status: 'firma' });
  });

  it('rejects a detail whose company is not in the caller list', async () => {
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes(`/clients/${CLIENT}`)) return jsonResponse(200, clientBody());
      return jsonResponse(200, operationBody());
    }) as unknown as typeof fetch;
    await expect(api().get(CASE_ID, [])).rejects.toMatchObject({ status: 404, code: 'COMPANY_NOT_FOUND' });
  });

  it('turns timeline events into Spanish title and detail', async () => {
    global.fetch = jest.fn(async () =>
      jsonResponse(200, {
        items: [
          {
            id: EVENT,
            kind: 'operation_updated',
            occurred_at: '2026-11-03T18:00:00Z',
            operation_label: 'IAC-0007',
            document_name: null,
            actor_name: 'Ana',
            changes: [{ field: 'status', before: 'solicitud', after: 'firma' }],
          },
        ],
        total: 1,
        page: 1,
        per_page: 20,
      }),
    ) as unknown as typeof fetch;

    const page = await api().timeline({ clientId: CLIENT, operationId: CASE_ID, page: 1, perPage: 20 });
    expect(page.items[0]).toEqual(
      expect.objectContaining({
        id: `operation_updated:${EVENT}`,
        title: 'Expediente actualizado',
      }),
    );
    expect(page.items[0]?.detail).toContain('Por Ana');
    expect(page.items[0]?.detail).toContain('IAC-0007');
    expect(page.items[0]?.detail).toContain('Estado: Solicitud → Firma');
  });

  it('drops email documents and keeps has_artifact', async () => {
    global.fetch = jest.fn(async () =>
      jsonResponse(200, {
        items: [
          {
            id: DOC,
            contract_id: '77777777-7777-4777-8777-777777777777',
            contract_name: 'Pagaré',
            format: 'pdf',
            filename: 'pagare.pdf',
            created_at: '2026-11-04T12:00:00Z',
            has_artifact: false,
            document_type: null,
            operation_id: CASE_ID,
          },
          {
            id: '88888888-8888-4888-8888-888888888888',
            contract_id: '77777777-7777-4777-8777-777777777777',
            contract_name: 'Correo',
            format: 'email',
            filename: 'correo.eml',
            created_at: '2026-11-04T12:00:00Z',
            has_artifact: false,
            document_type: 'email',
            operation_id: null,
          },
        ],
        total: 2,
        page: 1,
        per_page: 20,
      }),
    ) as unknown as typeof fetch;

    const page = await api().documents({ operationId: CASE_ID, page: 1, perPage: 20 });
    expect(page.total).toBe(2);
    expect(page.items).toEqual([
      expect.objectContaining({
        id: DOC,
        format: 'pdf',
        document_type: null,
        operation_id: CASE_ID,
        has_artifact: false,
        company: null,
      }),
    ]);
  });

  it('writes the artifact into the cache and returns its uri', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]).buffer;
    global.fetch = jest.fn(async () => ({
      status: 200,
      headers: {
        get(name: string) {
          if (name.toLowerCase() === 'content-type') return 'application/pdf';
          if (name.toLowerCase() === 'content-disposition') {
            return 'attachment; filename="contrato.pdf"; filename*=UTF-8\'\'Contrato%20final.pdf';
          }
          return null;
        },
      },
      json: async () => null,
      arrayBuffer: async () => bytes,
    })) as unknown as typeof fetch;

    const artifact = await api().artifact(DOC);
    expect(artifact).toEqual({
      filename: 'Contrato final.pdf',
      mime_type: 'application/pdf',
      uri: 'file:///cache/Contrato final.pdf',
    });
    expect(written()).toEqual([bytes]);
  });

  it('maps an artifact 4xx envelope and does not write a file', async () => {
    global.fetch = jest.fn(async () =>
      jsonResponse(404, { error: { code: 'GENERATED_DOCUMENT_NOT_FOUND', message: 'No hay archivo.' } }),
    ) as unknown as typeof fetch;
    const error = await api().artifact(DOC).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 404, code: 'GENERATED_DOCUMENT_NOT_FOUND' });
    expect(written()).toEqual([]);
  });

  it('fails closed when an operation field has the wrong type', async () => {
    global.fetch = jest.fn(async () => jsonResponse(200, operationBody({ status: 'open' }))) as unknown as typeof fetch;
    await expect(api().get(CASE_ID, companies)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('fetches available documents with candidates, latest_generated, and operator_fields', async () => {
    const fetchMock = jest.fn(async (_input: RequestInfo | URL) =>
      jsonResponse(200, [
        {
          document_type: 'venta_condicional',
          status: 'ready',
          candidates: [{ contract_id: '77777777-7777-4777-8777-777777777777', name: 'Venta Condicional' }],
          latest_generated: { id: DOC, created_at: '2026-11-04T12:00:00Z', format: 'pdf' },
          operator_fields: [],
        },
        {
          document_type: 'carta_saldo',
          status: 'ambiguous',
          candidates: [
            { contract_id: '77777777-7777-4777-8777-777777777777', name: 'Carta Saldo A' },
            { contract_id: '88888888-8888-4888-8888-888888888888', name: 'Carta Saldo B' },
          ],
          latest_generated: null,
          operator_fields: [
            { key: 'saldo_confirmado', label: 'Saldo confirmado (RD$)', kind: 'money', required: true },
            { key: 'fecha_saldo', label: 'Fecha de saldo', kind: 'date', required: true },
          ],
        },
        {
          document_type: 'gps',
          status: 'missing',
          candidates: [],
          latest_generated: null,
          operator_fields: [],
        },
      ]),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const list = await api().availableDocuments({ caseId: CASE_ID, companyId: COMPANY });
    expect(list).toHaveLength(3);
    expect(list[0]).toEqual({
      document_type: 'venta_condicional',
      status: 'ready',
      candidates: [{ contract_id: '77777777-7777-4777-8777-777777777777', name: 'Venta Condicional' }],
      latest_generated: { id: DOC, created_at: '2026-11-04T12:00:00Z', format: 'pdf' },
      operator_fields: [],
    });
    expect(list[1]?.operator_fields).toHaveLength(2);

    const url = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(url.pathname).toBe(`/api/v1/expedientes/${CASE_ID}/available-documents`);
    expect(url.searchParams.get('company_id')).toBe(COMPANY);
  });

  it('fails closed when availableDocuments returns an unknown document type', async () => {
    global.fetch = jest.fn(async () =>
      jsonResponse(200, [
        {
          document_type: 'unknown_doc',
          status: 'ready',
          candidates: [],
          latest_generated: null,
          operator_fields: [],
        },
      ]),
    ) as unknown as typeof fetch;

    await expect(api().availableDocuments({ caseId: CASE_ID, companyId: COMPANY })).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });

  it('puts a case document with contract_id and operator_values and handles 201 and 200 replay', async () => {
    const responseBody = {
      id: DOC,
      contract_id: '77777777-7777-4777-8777-777777777777',
      contract_name: 'Carta de Saldo',
      format: 'pdf',
      filename: 'carta-saldo.pdf',
      created_at: '2026-11-04T12:00:00Z',
      has_artifact: true,
      document_type: 'carta_saldo',
      operation_id: CASE_ID,
      company: { id: COMPANY, name: 'Real SRL', values: {} },
    };
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(201, responseBody))
      .mockResolvedValueOnce(jsonResponse(200, responseBody));
    global.fetch = fetchMock as unknown as typeof fetch;

    const body = {
      company_id: COMPANY,
      document_type: 'carta_saldo' as const,
      format: 'pdf' as const,
      contract_id: '77777777-7777-4777-8777-777777777777',
      operator_values: { saldo_confirmado: 'RD$12,500.00', fecha_saldo: '2026-11-18' },
    };

    const created = await api().generateDocument({ caseId: CASE_ID, documentId: DOC, body });
    const replayed = await api().generateDocument({ caseId: CASE_ID, documentId: DOC, body });

    expect(created.id).toBe(DOC);
    expect(created.has_artifact).toBe(true);
    expect(replayed.id).toBe(DOC);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${API_URL}/api/v1/expedientes/${CASE_ID}/documents/${DOC}`);
    expect(init.method).toBe('PUT');
    expect(JSON.parse(String(init.body))).toEqual(body);
  });

  it('maps 402, 409 conflict, and 422 ambiguity errors from generateDocument', async () => {
    const candidates = [
      { contract_id: '77777777-7777-4777-8777-777777777777', name: 'Plantilla 1' },
      { contract_id: '88888888-8888-4888-8888-888888888888', name: 'Plantilla 2' },
    ];
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(402, { error: { code: 'PAYMENT_REQUIRED', message: 'Empresa suspendida.' } }))
      .mockResolvedValueOnce(
        jsonResponse(409, { error: { code: 'GENERATED_DOCUMENT_CONFLICT', message: 'ID already used.' } }),
      )
      .mockResolvedValueOnce(
        jsonResponse(422, {
          error: { code: 'DOCUMENT_TEMPLATE_AMBIGUOUS', message: 'Elige plantilla.', candidates },
        }),
      ) as unknown as typeof fetch;

    const req = {
      caseId: CASE_ID,
      documentId: DOC,
      body: { company_id: COMPANY, document_type: 'venta_condicional' as const, format: 'docx' as const },
    };

    await expect(api().generateDocument(req)).rejects.toMatchObject({ status: 402, code: 'PAYMENT_REQUIRED' });
    await expect(api().generateDocument(req)).rejects.toMatchObject({ status: 409, code: 'GENERATED_DOCUMENT_CONFLICT' });
    await expect(api().generateDocument(req)).rejects.toMatchObject({
      status: 422,
      code: 'DOCUMENT_TEMPLATE_AMBIGUOUS',
      details: { candidates },
    });
  });
});
