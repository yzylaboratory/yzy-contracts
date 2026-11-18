import { z } from 'zod';

// Public values only: everything EXPO_PUBLIC_* ends up in the JS bundle (plan section 10).
// Expo inlines only literal `process.env.EXPO_PUBLIC_*` reads, so each name is written out.
const envSchema = z.object({
  EXPO_PUBLIC_SUPABASE_URL: z.url({ protocol: /^https$/ }),
  EXPO_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  EXPO_PUBLIC_API_URL: z.url({ protocol: /^https$/ }),
});

export interface AppEnv {
  supabaseUrl: string;
  supabaseAnonKey: string;
  apiUrl: string;
}

// Fails at startup with the missing variable names only. Never prints values.
export function readAppEnv(raw: Record<string, string | undefined>): AppEnv {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const missing = parsed.error.issues.map((issue) => String(issue.path[0])).join(', ');
    throw new Error(`Configuración incompleta o inválida: revisa ${missing} en apps/mobile/.env.local.`);
  }
  const data = parsed.data;
  return {
    supabaseUrl: data.EXPO_PUBLIC_SUPABASE_URL.replace(/\/+$/, ''),
    supabaseAnonKey: data.EXPO_PUBLIC_SUPABASE_ANON_KEY,
    apiUrl: data.EXPO_PUBLIC_API_URL.replace(/\/+$/, ''),
  };
}

export const appEnv: AppEnv = readAppEnv({
  EXPO_PUBLIC_SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL,
  EXPO_PUBLIC_SUPABASE_ANON_KEY: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
  EXPO_PUBLIC_API_URL: process.env.EXPO_PUBLIC_API_URL,
});
