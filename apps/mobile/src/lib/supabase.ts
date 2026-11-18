import { createClient } from '@supabase/supabase-js';
import { appEnv } from './config/env';
import { sessionStorage } from './secure-session/secure-store-adapter';

// The single Supabase client of the app. Public anon key only; never the service role.
// Session storage is SecureStore split into fragments; AsyncStorage is never used for tokens.
export const SUPABASE_STORAGE_KEY = 'yzy-contracts-auth';

export const supabase = createClient(appEnv.supabaseUrl, appEnv.supabaseAnonKey, {
  auth: {
    flowType: 'pkce',
    storageKey: SUPABASE_STORAGE_KEY,
    storage: sessionStorage,
    persistSession: true,
    // Refresh runs only while the app is in the foreground (see setForeground in the auth adapter).
    autoRefreshToken: true,
    // Deep links are parsed explicitly by the allow-listed callback, never by supabase-js.
    detectSessionInUrl: false,
  },
});
