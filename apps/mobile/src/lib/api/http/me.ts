import type { SupabaseClient } from '@supabase/supabase-js';
import type { Me, YzyApi } from '../contract';
import { createApiClient } from './client';
import { meSchema } from './me-schema';

// GET /api/v1/me with the Supabase access token. The gate depends on this response, so it is validated strictly on fields.
export function createHttpMeApi(client: SupabaseClient, apiUrl: string): YzyApi['me'] {
  const http = createApiClient(client, apiUrl);
  return {
    async get(): Promise<Me> {
      return http.json('/me', meSchema);
    },
  };
}
