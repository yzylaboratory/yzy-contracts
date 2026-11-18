import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { ApiError } from '../../errors';
import { createApiClient } from '../client';

const API_URL = 'https://api.example.test';

function fakeClient(accessToken: string | null): SupabaseClient {
  return {
    auth: {
      getSession: async () => ({
        data: { session: accessToken ? { access_token: accessToken, user: { id: 'account' } } : null },
        error: null,
      }),
    },
  } as unknown as SupabaseClient;
}

function respond(status: number, body: unknown) {
  return jest.fn(async () => ({
    status,
    ok: status >= 200 && status < 300,
    headers: { get: () => null },
    json: async () => body,
    arrayBuffer: async () => new ArrayBuffer(0),
  }));
}

const ping = z.object({ ok: z.boolean() });

describe('authenticated API client', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('sends the bearer token and a JSON body', async () => {
    const fetchMock = respond(200, { ok: true, extra: 'ignored' });
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await createApiClient(fakeClient('tok-123'), API_URL).json('/widgets', ping, {
      method: 'POST',
      body: { name: 'Ana' },
    });

    expect(result).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${API_URL}/api/v1/widgets`);
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer tok-123');
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers.Accept).toBe('application/json');
    expect(JSON.parse(String(init.body))).toEqual({ name: 'Ana' });
  });

  it('fails with INVALID_RESPONSE when the success body does not match the schema', async () => {
    global.fetch = respond(200, { ok: 'yes' }) as unknown as typeof fetch;
    await expect(createApiClient(fakeClient('tok'), API_URL).json('/widgets', ping)).rejects.toMatchObject({
      status: 200,
      code: 'INVALID_RESPONSE',
    });
  });

  it('maps a 4xx envelope and keeps the server message', async () => {
    global.fetch = respond(422, {
      error: { code: 'VALIDATION_ERROR', message: 'Indica un monto mayor que cero.' },
    }) as unknown as typeof fetch;
    const error = await createApiClient(fakeClient('tok'), API_URL).json('/widgets', ping).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 422,
      code: 'VALIDATION_ERROR',
      message: 'Indica un monto mayor que cero.',
    });
  });

  it('preserves candidates in ApiError.details for DOCUMENT_TEMPLATE_AMBIGUOUS', async () => {
    const candidates = [
      { contract_id: '11111111-1111-4111-8111-111111111111', name: 'Plantilla A' },
      { contract_id: '22222222-2222-4222-8222-222222222222', name: 'Plantilla B' },
    ];
    global.fetch = respond(422, {
      error: {
        code: 'DOCUMENT_TEMPLATE_AMBIGUOUS',
        message: 'Hay varias plantillas compatibles.',
        candidates,
      },
    }) as unknown as typeof fetch;
    const error = await createApiClient(fakeClient('tok'), API_URL).json('/widgets', ping).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 422,
      code: 'DOCUMENT_TEMPLATE_AMBIGUOUS',
      message: 'Hay varias plantillas compatibles.',
      details: { candidates },
    });
  });

  it('keeps a 401 status when the error body cannot be read', async () => {
    global.fetch = respond(401, 'not json') as unknown as typeof fetch;
    await expect(createApiClient(fakeClient('tok'), API_URL).json('/widgets', ping)).rejects.toMatchObject({
      status: 401,
      code: 'INVALID_RESPONSE',
    });
  });

  it('reports a transport failure as a network error', async () => {
    global.fetch = jest.fn(async () => {
      throw new TypeError('Network request failed');
    }) as unknown as typeof fetch;
    await expect(createApiClient(fakeClient('tok'), API_URL).json('/widgets', ping)).rejects.toMatchObject({
      status: 0,
      code: 'NETWORK_ERROR',
    });
  });

  it('does not call the API when there is no access token', async () => {
    const fetchMock = respond(200, { ok: true });
    global.fetch = fetchMock as unknown as typeof fetch;
    await expect(createApiClient(fakeClient(null), API_URL).json('/widgets', ping)).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns the binary body with the response headers', async () => {
    const bytes = new Uint8Array([9, 8, 7]).buffer;
    global.fetch = jest.fn(async () => ({
      status: 200,
      headers: {
        get(name: string) {
          if (name.toLowerCase() === 'content-type') return 'application/pdf';
          if (name.toLowerCase() === 'content-disposition') return 'attachment; filename="a.pdf"';
          return null;
        },
      },
      json: async () => null,
      arrayBuffer: async () => bytes,
    })) as unknown as typeof fetch;

    const downloaded = await createApiClient(fakeClient('tok'), API_URL).binary('/files/1');
    expect(downloaded.bytes).toBe(bytes);
    expect(downloaded.contentType).toBe('application/pdf');
    expect(downloaded.contentDisposition).toContain('a.pdf');
  });
});
