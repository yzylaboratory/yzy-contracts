"use client";

import type { User } from "@supabase/supabase-js";
import { useSyncExternalStore } from "react";

const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function readName(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function useAccountProfile(user: User | undefined) {
  const key = user ? `yzy-contracts:profile-name:${user.id}` : null;
  const savedName = useSyncExternalStore(subscribe, () => {
    try {
      return key ? window.sessionStorage.getItem(key) : null;
    } catch {
      return null;
    }
  }, () => null);

  const metadata = user?.user_metadata;
  const google = user?.identities?.find(identity => identity.provider === "google")?.identity_data;
  const accountName = readName(metadata?.full_name) || readName(metadata?.name) ||
    readName(google?.full_name) || readName(google?.name);
  const name = readName(savedName) || accountName;
  const email = user?.email ?? "";

  function saveName(value: string) {
    if (!key) return false;
    try {
      if (value) window.sessionStorage.setItem(key, value);
      else window.sessionStorage.removeItem(key);
    } catch {
      return false;
    }
    for (const listener of listeners) listener();
    return true;
  }

  return { name, accountName, hasCustomName: Boolean(savedName), email, saveName };
}
