import { appEnv } from '../config/env';
import { supabase } from '../supabase';
import type { YzyApi } from './contract';
import { createApiClient } from './http/client';
import { createHttpCasesApi } from './http/cases';
import { createHttpClientsApi } from './http/clients';
import { createHttpDashboardApi } from './http/dashboard';
import { createHttpMeApi } from './http/me';
import { createSupabaseAuthApi } from './http/supabase-auth';

const http = createApiClient(supabase, appEnv.apiUrl);

export const apiClient = http;

export const api: YzyApi = {
  auth: createSupabaseAuthApi(supabase),
  me: createHttpMeApi(supabase, appEnv.apiUrl),
  dashboard: createHttpDashboardApi(http),
  cases: createHttpCasesApi(http),
  clients: createHttpClientsApi(http),
};

export type { YzyApi } from './contract';
export * from './contract';
export { ApiError, isApiError, reportApiError, setUnauthorizedHandler } from './errors';
export { authCallbackParamsSchema, type AuthCallbackParams } from './http/auth-callback';
