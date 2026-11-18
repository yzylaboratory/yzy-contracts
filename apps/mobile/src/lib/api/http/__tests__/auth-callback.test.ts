import { ApiError } from '../../errors';
import { AUTH_CALLBACK_URL, parseAuthCallbackUrl } from '../auth-callback';

function expectInvalid(url: string) {
  expect(() => parseAuthCallbackUrl(url)).toThrow(ApiError);
  try {
    parseAuthCallbackUrl(url);
  } catch (error) {
    expect((error as ApiError).code).toBe('INVALID_CALLBACK');
  }
}

describe('parseAuthCallbackUrl', () => {
  it('uses the scheme registered in the app and the allow-listed path', () => {
    expect(AUTH_CALLBACK_URL).toBe('yzycontracts://auth/callback');
  });

  it('reads the PKCE code from the allow-listed callback', () => {
    expect(parseAuthCallbackUrl('yzycontracts://auth/callback?code=abc-123_DEF')).toEqual({ code: 'abc-123_DEF' });
  });

  it('decodes percent-encoded values and form-encoded spaces in error descriptions', () => {
    const parsed = parseAuthCallbackUrl(
      'yzycontracts://auth/callback?error=server_error&error_code=otp_expired&error_description=Email+link%20is%20invalid',
    );
    expect(parsed).toEqual({
      error: 'server_error',
      error_code: 'otp_expired',
      error_description: 'Email link is invalid',
    });
  });

  it('accepts a callback without parameters', () => {
    expect(parseAuthCallbackUrl('yzycontracts://auth/callback')).toEqual({});
  });

  it('rejects other hosts, paths and schemes', () => {
    expectInvalid('yzycontracts://auth/other?code=x');
    expectInvalid('yzycontracts://other/callback?code=x');
    expectInvalid('yzycontracts://auth/callback/extra?code=x');
    expectInvalid('https://auth/callback?code=x');
    expectInvalid('exp://192.168.0.2:8081/--/auth/callback?code=x');
  });

  it('rejects unknown parameters (fail closed)', () => {
    expectInvalid('yzycontracts://auth/callback?code=x&state=y');
  });

  it('rejects duplicated parameters', () => {
    expectInvalid('yzycontracts://auth/callback?code=a&code=b');
  });

  it('rejects malformed percent-encoding', () => {
    expectInvalid('yzycontracts://auth/callback?code=%E0%A4%A');
  });

  it('rejects an empty code and oversized values', () => {
    expectInvalid('yzycontracts://auth/callback?code=');
    expectInvalid(`yzycontracts://auth/callback?code=${'a'.repeat(257)}`);
  });
});
