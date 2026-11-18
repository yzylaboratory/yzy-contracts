import type { SupabaseClient } from '@supabase/supabase-js';
import { ApiError } from '../../errors';
import { createApiClient } from '../client';
import { createHttpDashboardApi } from '../dashboard';

const API_URL = 'https://api.example.test';
const COMPANY = '22222222-2222-4222-8222-222222222222';
const CASE_ID = '44444444-4444-4444-8444-444444444444';
const CLIENT_ID = '33333333-3333-4333-8333-333333333333';

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

function dashboardBody(overrides: Record<string, unknown> = {}) {
  return {
    clients_total: 4,
    cases_total: 9,
    cases_this_month: 2,
    cases_without_plan: 1,
    unsigned_cases: 3,
    pending_disbursement_cases: 1,
    disbursed_cases: 5,
    disbursed_this_month: 2,
    documents_total: 12,
    documents_this_month: 4,
    time_saved_minutes: 80,
    user_time_saved_minutes: 30,
    user_disbursements_total: 1,
    user_documents_total: 6,
    status_counts: { solicitud: 2, en_proceso: 1, firma: 3, desembolso: 1, cerrado: 2 },
    user_stats: [],
    months: [],
    formats: { pdf: 8, docx: 3, email: 1 },
    recent_cases: [],
    ...overrides,
  };
}

function casePage() {
  return {
    items: [
      {
        id: CASE_ID,
        client_id: CLIENT_ID,
        client_name: 'María Pérez',
        client_identity: '001-0000000-1',
        company_id: COMPANY,
        company_name: 'Real SRL',
        reference: 'IAC-0007',
        contract_date: null,
        status: 'firma',
        vehicle: { make: 'TOYOTA', model: 'COROLLA', year: '2020' },
        created_at: '2026-11-01T15:04:05.123456Z',
      },
    ],
    total: 1,
    page: 1,
    per_page: 5,
  };
}

describe('dashboard client', () => {
  const originalFetch = global.fetch;
  const api = () => createHttpDashboardApi(createApiClient(fakeClient(), API_URL));

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('reads KPIs from /dashboard and recent cases from the first expedientes page', async () => {
    const fetchMock = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/dashboard')) return jsonResponse(200, dashboardBody());
      if (url.includes('/expedientes')) return jsonResponse(200, casePage());
      throw new Error(url);
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const dashboard = await api().get(COMPANY);

    expect(dashboard.time_saved_minutes).toBe(80);
    expect(dashboard.documents_total).toBe(12);
    expect(dashboard.unsigned_cases).toBe(3);
    expect(dashboard.status_counts.firma).toBe(3);
    expect(dashboard.recent_cases).toEqual([
      expect.objectContaining({
        id: CASE_ID,
        client_name: 'María Pérez',
        company_name: 'Real SRL',
        vehicle: expect.objectContaining({ brand: 'TOYOTA', model: 'COROLLA', year: '2020', kind: null }),
      }),
    ]);
    const urls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(urls.some((url) => url.includes(`/dashboard?company_id=${COMPANY}`))).toBe(true);
    expect(urls.some((url) => url.includes('/expedientes?') && url.includes('per_page=5') && url.includes(`company_id=${COMPANY}`))).toBe(true);
  });

  it('maps a 4xx envelope', async () => {
    global.fetch = jest.fn(async () =>
      jsonResponse(403, { error: { code: 'ACCESS_NOT_ALLOWED', message: 'No puedes ver esta empresa.' } }),
    ) as unknown as typeof fetch;
    const error = await api().get(COMPANY).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 403, code: 'ACCESS_NOT_ALLOWED' });
  });

  it('fails closed when a required KPI is missing', async () => {
    const { time_saved_minutes: _omitted, ...incomplete } = dashboardBody();
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/dashboard')) return jsonResponse(200, incomplete);
      return jsonResponse(200, casePage());
    }) as unknown as typeof fetch;
    await expect(api().get(COMPANY)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
});
