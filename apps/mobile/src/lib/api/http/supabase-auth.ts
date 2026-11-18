import {
  AuthPKCECodeVerifierMissingError,
  AuthRetryableFetchError,
  type SupabaseClient,
} from '@supabase/supabase-js';
import * as WebBrowser from 'expo-web-browser';
import { z } from 'zod';
import { ApiError, networkError } from '../errors';
import type { YzyApi } from '../contract';
import { AUTH_CALLBACK_URL, parseAuthCallbackUrl, type AuthCallbackParams } from './auth-callback';

type AuthApi = YzyApi['auth'];

const emailSchema = z.email();

// Maps supabase-js failures to ApiError codes with user-facing Spanish messages (shown through messageFor).
// Status 500 for SDK failures: an auth-side 401 must not be mistaken for an expired API session.
export function mapAuthError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (error instanceof AuthRetryableFetchError) return networkError();
  if (error instanceof AuthPKCECodeVerifierMissingError) {
    return new ApiError(400, 'AUTH_PKCE_MISSING', 'Abre el enlace en el mismo teléfono donde pediste el acceso.');
  }
  const code = typeof (error as { code?: unknown })?.code === 'string' ? (error as { code: string }).code : undefined;
  if (code === 'otp_expired') {
    return new ApiError(400, 'AUTH_LINK_EXPIRED', 'El enlace ya venció o ya se usó. Pide uno nuevo.');
  }
  return new ApiError(500, 'AUTH_REQUEST_FAILED', 'No se pudo completar el acceso. Vuelve a intentarlo.');
}

function callbackError(params: AuthCallbackParams): ApiError {
  if (params.error_code === 'otp_expired') {
    return new ApiError(400, 'AUTH_LINK_EXPIRED', 'El enlace ya venció o ya se usó. Pide uno nuevo.');
  }
  if (params.error === 'access_denied') {
    return new ApiError(400, 'AUTH_CANCELLED', 'Se canceló el acceso. Vuelve a intentarlo.');
  }
  return new ApiError(500, 'AUTH_REQUEST_FAILED', 'No se pudo completar el acceso. Vuelve a intentarlo.');
}

const GOOGLE_FAILED = 'No se pudo abrir el acceso con Google. Vuelve a intentarlo.';

export function createSupabaseAuthApi(client: SupabaseClient): AuthApi {
  async function exchange(code: string): Promise<void> {
    const { error } = await client.auth.exchangeCodeForSession(code);
    if (error) throw mapAuthError(error);
  }

  async function completeCallback(params: AuthCallbackParams): Promise<void> {
    if (params.error) throw callbackError(params);
    if (!params.code) throw new ApiError(400, 'INVALID_CALLBACK', 'Este enlace no es válido.');
    await exchange(params.code);
  }

  return {
    async currentSession() {
      const { data, error } = await client.auth.getSession();
      if (error) throw mapAuthError(error);
      return data.session ? { accountId: data.session.user.id } : null;
    },

    async sendMagicLink(email) {
      const parsed = emailSchema.safeParse(email);
      if (!parsed.success) throw new ApiError(422, 'VALIDATION_ERROR', 'Escribe un correo válido.');
      const { error } = await client.auth.signInWithOtp({
        email: parsed.data,
        options: {
          // Accounts are created only by the superadministrator flow, never by a magic link.
          shouldCreateUser: false,
          emailRedirectTo: AUTH_CALLBACK_URL,
        },
      });
      if (!error) return;
      if (error.status === 429) {
        throw new ApiError(429, 'RATE_LIMITED', 'Espera un momento antes de volver a solicitar el enlace.');
      }
      // Same confirmation whether or not the address has an account (portal behaviour, plan section 6).
      if (error.code === 'otp_disabled' || error.code === 'user_not_found') return;
      throw new ApiError(500, 'AUTH_REQUEST_FAILED', 'No se pudo solicitar el enlace. Vuelve a intentarlo.');
    },

    completeCallback,

    async signInWithGoogle() {
      const { data, error } = await client.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: AUTH_CALLBACK_URL, skipBrowserRedirect: true },
      });
      if (error) throw mapAuthError(error);
      if (!data.url) throw new ApiError(500, 'AUTH_REQUEST_FAILED', GOOGLE_FAILED);

      let result: WebBrowser.WebBrowserAuthSessionResult;
      try {
        result = await WebBrowser.openAuthSessionAsync(data.url, AUTH_CALLBACK_URL);
      } catch {
        throw new ApiError(500, 'AUTH_REQUEST_FAILED', GOOGLE_FAILED);
      }
      // Closing the sheet is a choice, not an error.
      if (result.type !== 'success') return;
      await completeCallback(parseAuthCallbackUrl(result.url));
    },

    async signOut() {
      // Local scope: this device only. Removes the stored session through the SecureStore adapter.
      const { error } = await client.auth.signOut({ scope: 'local' });
      if (error) throw mapAuthError(error);
    },

    onChange(listener) {
      const { data } = client.auth.onAuthStateChange((_event, session) => {
        // The listener only updates the query cache. It must not call supabase-js (documented deadlock risk).
        listener(session ? { accountId: session.user.id } : null);
      });
      return () => data.subscription.unsubscribe();
    },

    async setForeground(active) {
      if (active) await client.auth.startAutoRefresh();
      else await client.auth.stopAutoRefresh();
    },
  };
}
