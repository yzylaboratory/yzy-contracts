// Test-only synthetic endpoints. The app itself never defaults these values (see src/lib/config/env.ts).
process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://supabase.test.invalid';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
process.env.EXPO_PUBLIC_API_URL = 'https://api.test.invalid';
