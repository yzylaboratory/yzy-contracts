import { z } from 'zod';
import { ApiError } from '../errors';

// Must match app.config.ts `scheme` and the redirect allow-list of the shared Supabase Auth (plan section 6).
export const AUTH_CALLBACK_URL = 'yzycontracts://auth/callback';

// Strict on purpose: any other parameter fails closed.
export const authCallbackParamsSchema = z.strictObject({
  code: z.string().min(1).max(256).optional(),
  error: z.string().min(1).max(128).optional(),
  error_code: z.string().min(1).max(128).optional(),
  error_description: z.string().max(512).optional(),
});

export type AuthCallbackParams = z.infer<typeof authCallbackParamsSchema>;

// Only this scheme, host and path are accepted. The query is the only source of parameters.
const ALLOWED_CALLBACK = /^yzycontracts:\/\/auth\/callback(?:\?([^#]*))?(?:#.*)?$/;

function invalidCallback(): ApiError {
  return new ApiError(400, 'INVALID_CALLBACK', 'Este enlace no es válido.');
}

function decodeComponent(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '));
  } catch {
    throw invalidCallback();
  }
}

export function parseAuthCallbackUrl(url: string): AuthCallbackParams {
  const match = ALLOWED_CALLBACK.exec(url);
  if (!match) throw invalidCallback();
  const query = match[1] ?? '';
  const raw: Record<string, string> = {};
  for (const pair of query.split('&')) {
    if (pair === '') continue;
    const separator = pair.indexOf('=');
    const key = decodeComponent(separator < 0 ? pair : pair.slice(0, separator));
    const value = decodeComponent(separator < 0 ? '' : pair.slice(separator + 1));
    if (Object.prototype.hasOwnProperty.call(raw, key)) throw invalidCallback();
    raw[key] = value;
  }
  const parsed = authCallbackParamsSchema.safeParse(raw);
  if (!parsed.success) throw invalidCallback();
  return parsed.data;
}
