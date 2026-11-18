import { AuthPKCECodeVerifierMissingError, AuthRetryableFetchError } from '@supabase/supabase-js';
import { ApiError } from '../../errors';
import { mapAuthError } from '../supabase-auth';

describe('mapAuthError', () => {
  it('maps a missing PKCE verifier to the same-device message', () => {
    const mapped = mapAuthError(new AuthPKCECodeVerifierMissingError());
    expect(mapped).toMatchObject({ code: 'AUTH_PKCE_MISSING', status: 400 });
    expect(mapped.message).toContain('mismo teléfono');
  });

  it('maps a transport failure to a network error', () => {
    expect(mapAuthError(new AuthRetryableFetchError('offline', 0))).toMatchObject({ status: 0, code: 'NETWORK_ERROR' });
  });

  it('maps an expired link code to a clear message', () => {
    const mapped = mapAuthError(Object.assign(new Error('expired'), { code: 'otp_expired' }));
    expect(mapped).toMatchObject({ code: 'AUTH_LINK_EXPIRED', status: 400 });
  });

  it('never lets an SDK failure look like an expired API session (no 401)', () => {
    const mapped = mapAuthError(new Error('unexpected'));
    expect(mapped).toBeInstanceOf(ApiError);
    expect(mapped.status).toBe(500);
  });
});
