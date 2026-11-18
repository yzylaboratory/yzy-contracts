import type { SupabaseClient } from '@supabase/supabase-js';
import { ApiError } from '../../errors';
import { createHttpMeApi } from '../me';
import { meSchema } from '../me-schema';

const API_URL = 'https://api.example.test';
const ACCOUNT = '11111111-1111-4111-8111-111111111111';
const COMPANY = '22222222-2222-4222-8222-222222222222';

function fakeClient(accessToken: string | null): SupabaseClient {
  return {
    auth: {
      getSession: async () => ({
        data: { session: accessToken ? { access_token: accessToken, user: { id: ACCOUNT } } : null },
        error: null,
      }),
    },
  } as unknown as SupabaseClient;
}

function respond(status: number, body: unknown) {
  return jest.fn(async () => ({
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  }));
}

const validBody = {
  id: ACCOUNT,
  email: 'persona@example.test',
  role: 'member',
  access: 'active',
  companies: [{ id: COMPANY, name: 'Empresa Demo SRL' }],
  overdue_company_ids: [],
  can_manage_billing: false,
  billing_company_ids: [],
  manageable_overdue_company_ids: [],
};

describe('GET /api/v1/me client', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('sends the Supabase access token as a bearer token and returns the validated body', async () => {
    const fetchMock = respond(200, validBody);
    global.fetch = fetchMock as unknown as typeof fetch;

    const me = await createHttpMeApi(fakeClient('tok-123'), API_URL).get();

    expect(me.companies).toEqual([{ id: COMPANY, name: 'Empresa Demo SRL' }]);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${API_URL}/api/v1/me`);
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok-123');
  });

  it('ignores fields the app does not know about', async () => {
    global.fetch = respond(200, { ...validBody, notice: null, billing_alert: null, upload_max_bytes: 1 }) as unknown as typeof fetch;
    const me = await createHttpMeApi(fakeClient('tok'), API_URL).get();
    expect(Object.keys(me).sort()).toEqual([
      'access',
      'billing_company_ids',
      'can_manage_billing',
      'companies',
      'email',
      'id',
      'manageable_overdue_company_ids',
      'overdue_company_ids',
      'role',
    ]);
  });

  it('fails with INVALID_RESPONSE when a required field is missing', async () => {
    const { overdue_company_ids: _omitted, ...incomplete } = validBody;
    global.fetch = respond(200, incomplete) as unknown as typeof fetch;
    await expect(createHttpMeApi(fakeClient('tok'), API_URL).get()).rejects.toMatchObject({
      status: 200,
      code: 'INVALID_RESPONSE',
    });
  });

  it('fails with INVALID_RESPONSE when a field has the wrong type', async () => {
    global.fetch = respond(200, { ...validBody, access: 'enabled' }) as unknown as typeof fetch;
    await expect(createHttpMeApi(fakeClient('tok'), API_URL).get()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('maps the server error envelope, keeping the HTTP status', async () => {
    global.fetch = respond(403, { error: { code: 'ADMIN_REQUIRED', message: 'Administrator access is required' } }) as unknown as typeof fetch;
    const error = await createHttpMeApi(fakeClient('tok'), API_URL).get().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 403, code: 'ADMIN_REQUIRED' });
  });

  it('keeps a 401 status when the error body cannot be read', async () => {
    global.fetch = respond(401, 'not json') as unknown as typeof fetch;
    await expect(createHttpMeApi(fakeClient('tok'), API_URL).get()).rejects.toMatchObject({ status: 401, code: 'INVALID_RESPONSE' });
  });

  it('reports a transport failure as a network error without calling the API', async () => {
    global.fetch = jest.fn(async () => {
      throw new TypeError('Network request failed');
    }) as unknown as typeof fetch;
    await expect(createHttpMeApi(fakeClient('tok'), API_URL).get()).rejects.toMatchObject({ status: 0, code: 'NETWORK_ERROR' });
  });

  it('ends the session locally when there is no access token', async () => {
    const fetchMock = respond(200, validBody);
    global.fetch = fetchMock as unknown as typeof fetch;
    await expect(createHttpMeApi(fakeClient(null), API_URL).get()).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('meSchema', () => {
  it('accepts a pending account with no companies', () => {
    expect(meSchema.safeParse({ ...validBody, access: 'pending', companies: [] }).success).toBe(true);
  });

  it('rejects a non-UUID company id', () => {
    expect(meSchema.safeParse({ ...validBody, companies: [{ id: 'abc', name: 'x' }] }).success).toBe(false);
  });
});
