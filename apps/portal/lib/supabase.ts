import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error("NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are required");
}

export const supabase = createClient(url, anonKey, {
  auth: {
    flowType: "pkce",
    // DEV used a different issuer previously. Keep those sessions out of shared Auth.
    storageKey: typeof window !== "undefined" && window.location.hostname === "yzycontracts.yzylabs.dev"
      ? "yzy-contracts-shared-auth"
      : "yzy-contracts-auth",
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
