import { readAppEnv } from '../env';

const complete = {
  EXPO_PUBLIC_SUPABASE_URL: 'https://supabase.example.test/',
  EXPO_PUBLIC_SUPABASE_ANON_KEY: 'public-anon-key',
  EXPO_PUBLIC_API_URL: 'https://api.example.test',
};

describe('readAppEnv', () => {
  it('returns the public values without trailing slashes', () => {
    expect(readAppEnv(complete)).toEqual({
      supabaseUrl: 'https://supabase.example.test',
      supabaseAnonKey: 'public-anon-key',
      apiUrl: 'https://api.example.test',
    });
  });

  it('fails naming only the missing variables, never their values', () => {
    let message = '';
    try {
      readAppEnv({ ...complete, EXPO_PUBLIC_API_URL: undefined });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('EXPO_PUBLIC_API_URL');
    expect(message).not.toContain('public-anon-key');
  });

  it('rejects plain HTTP endpoints', () => {
    expect(() => readAppEnv({ ...complete, EXPO_PUBLIC_API_URL: 'http://api.example.test' })).toThrow('EXPO_PUBLIC_API_URL');
  });
});
