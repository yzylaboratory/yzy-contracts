import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { ApiError, networkError } from '../errors';
import { mapAuthError } from './supabase-auth';

const REQUEST_TIMEOUT_MS = 15_000;

const errorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    candidates: z
      .array(
        z.object({
          contract_id: z.uuid(),
          name: z.string(),
        }),
      )
      .optional(),
  }),
});

export type JsonMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export interface JsonRequest {
  method?: JsonMethod;
  body?: unknown;
}

export interface BinaryBody {
  bytes: ArrayBuffer;
  contentType: string | null;
  contentDisposition: string | null;
}

export interface ApiClient {
  json<S extends z.ZodType>(path: string, schema: S, init?: JsonRequest): Promise<z.output<S>>;
  binary(path: string): Promise<BinaryBody>;
}

// Non-2xx bodies follow the error envelope. An unreadable body keeps the HTTP status, so a 401 still ends the session.
function apiErrorFrom(status: number, body: unknown): ApiError {
  const parsed = errorEnvelopeSchema.safeParse(body);
  if (!parsed.success) {
    return new ApiError(status, 'INVALID_RESPONSE', 'Respuesta inesperada del servidor.');
  }
  const { code, message, candidates } = parsed.data.error;
  const details = candidates !== undefined ? { candidates } : undefined;
  return new ApiError(status, code, message, details);
}

export function toQuery(entries: readonly (readonly [string, string | number | undefined])[]): string {
  const params = new URLSearchParams();
  for (const [key, value] of entries) {
    if (value === undefined) continue;
    params.set(key, String(value));
  }
  const text = params.toString();
  return text.length === 0 ? '' : `?${text}`;
}

// Authenticated fetch for /api/v1. Bearer token, 15s timeout, JSON or binary body, envelope errors.
export function createApiClient(supabase: SupabaseClient, apiUrl: string): ApiClient {
  const root = `${apiUrl.replace(/\/+$/, '')}/api/v1`;

  async function accessToken(): Promise<string> {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw mapAuthError(error);
    const token = data.session?.access_token;
    if (!token) throw new ApiError(401, 'UNAUTHENTICATED', 'Tu sesión venció. Vuelve a iniciar sesión.');
    return token;
  }

  async function send(path: string, init: { method: JsonMethod; accept: string; body?: unknown; binary: boolean }): Promise<{
    status: number;
    json: unknown;
    bytes: ArrayBuffer | null;
    contentType: string | null;
    contentDisposition: string | null;
  }> {
    const token = await accessToken();
    const headers: Record<string, string> = {
      Accept: init.accept,
      Authorization: `Bearer ${token}`,
    };
    let body: string | undefined;
    if (init.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(init.body);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(`${root}${path}`, {
        method: init.method,
        headers,
        body,
        signal: controller.signal,
      });
      if (response.status < 200 || response.status > 299) {
        const errorBody: unknown = await response.json().catch(() => null);
        throw apiErrorFrom(response.status, errorBody);
      }
      if (init.binary) {
        const bytes = await response.arrayBuffer();
        return {
          status: response.status,
          json: null,
          bytes,
          contentType: response.headers.get('content-type'),
          contentDisposition: response.headers.get('content-disposition'),
        };
      }
      const json: unknown = await response.json().catch(() => null);
      return { status: response.status, json, bytes: null, contentType: null, contentDisposition: null };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw networkError();
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async json<S extends z.ZodType>(path: string, schema: S, init?: JsonRequest): Promise<z.output<S>> {
      const result = await send(path, {
        method: init?.method ?? 'GET',
        accept: 'application/json',
        body: init?.body,
        binary: false,
      });
      const parsed = schema.safeParse(result.json);
      if (!parsed.success) {
        throw new ApiError(result.status, 'INVALID_RESPONSE', 'Respuesta inesperada del servidor.');
      }
      return parsed.data;
    },
    async binary(path: string): Promise<BinaryBody> {
      const result = await send(path, { method: 'GET', accept: '*/*', binary: true });
      if (!result.bytes) throw new ApiError(result.status, 'INVALID_RESPONSE', 'Respuesta inesperada del servidor.');
      return {
        bytes: result.bytes,
        contentType: result.contentType,
        contentDisposition: result.contentDisposition,
      };
    },
  };
}
