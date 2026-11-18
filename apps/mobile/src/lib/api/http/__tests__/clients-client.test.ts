import type { SupabaseClient } from '@supabase/supabase-js';
import type { ClientWrite } from '../../contract';
import { ApiError } from '../../errors';
import { createApiClient } from '../client';
import { createHttpClientsApi } from '../clients';

const API_URL = 'https://api.example.test';
const CLIENT = '33333333-3333-4333-8333-333333333333';

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

function clientBody(overrides: Record<string, unknown> = {}) {
  return {
    id: CLIENT,
    name: 'MARÍA PÉREZ',
    identity: '001-0000000-1',
    address: 'Calle 1',
    phone: '8095550000',
    email: 'maria@example.test',
    income_source: 'SALARIO',
    created_at: '2026-11-01T12:00:00Z',
    updated_at: '2026-11-02T12:00:00Z',
    ...overrides,
  };
}

const write: ClientWrite = {
  name: 'Ana',
  identity: null,
  phone: null,
  address: null,
  email: null,
  income_source: null,
  profile: null,
};

describe('clients client', () => {
  const originalFetch = global.fetch;
  const api = () => createHttpClientsApi(createApiClient(fakeClient(), API_URL));

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('lists a page and projects the directory subset', async () => {
    const fetchMock = jest.fn(async (input: RequestInfo | URL) =>
      jsonResponse(200, { items: [clientBody({ notice: 'extra' })], total: 8, page: 2, per_page: 20, echoed: String(input) }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const page = await api().list({ q: 'maría', page: 2, perPage: 20 });

    expect(page.items).toEqual([
      {
        id: CLIENT,
        name: 'MARÍA PÉREZ',
        identity: '001-0000000-1',
        phone: '8095550000',
        address: 'Calle 1',
        created_at: '2026-11-01T12:00:00Z',
      },
    ]);
    expect(page.total).toBe(8);
    const url = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(url.pathname).toBe('/api/v1/clients');
    expect(url.searchParams.get('q')).toBe('maría');
    expect(url.searchParams.get('page')).toBe('2');
    expect(url.searchParams.get('per_page')).toBe('20');
  });

  it('posts the write body and returns the created client', async () => {
    const fetchMock = jest.fn(async () => jsonResponse(201, clientBody({ name: 'ANA' })));
    global.fetch = fetchMock as unknown as typeof fetch;

    const created = await api().create(write);

    expect(created.name).toBe('ANA');
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual(write);
  });

  it('maps a 409 identity conflict', async () => {
    global.fetch = jest.fn(async () =>
      jsonResponse(409, { error: { code: 'CLIENT_IDENTITY_CONFLICT', message: 'Ya existe un cliente con esa cédula.' } }),
    ) as unknown as typeof fetch;
    const error = await api().create(write).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 409, code: 'CLIENT_IDENTITY_CONFLICT' });
  });

  it('fails closed when the body is missing a required field', async () => {
    const { name: _omitted, ...incomplete } = clientBody();
    global.fetch = jest.fn(async () => jsonResponse(200, incomplete)) as unknown as typeof fetch;
    await expect(api().get(CLIENT)).rejects.toMatchObject({ status: 200, code: 'INVALID_RESPONSE' });
  });
});
