"use client";

import type { Session } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import { supabase } from "./supabase";

/** `undefined` while the stored session is being read, `null` when signed out. */
export function useSession() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    // Supabase emits INITIAL_SESSION after loading storage.
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, []);

  return session;
}

/** The Auth server is shared with other YZY products, so this only ends the session in this portal. */
export function signOut() {
  return supabase.auth.signOut({ scope: "local" });
}
