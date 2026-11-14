"use client";

import { useSyncExternalStore } from "react";

const drafts = new Map<string, Map<string, unknown>>();
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function notify() {
  for (const listener of listeners) listener();
}

export function clearNavigationDrafts(accountId: string) {
  if (drafts.delete(accountId)) notify();
}

// Drafts survive in-portal navigation and are discarded when the account changes or the tab reloads.
export function useNavigationDraft<T>(accountId: string, scope: string, empty: T) {
  const value = useSyncExternalStore(subscribe, () => (drafts.get(accountId)?.get(scope) as T | undefined) ?? empty, () => empty);

  function setValue(next: T) {
    const accountDrafts = drafts.get(accountId) ?? new Map<string, unknown>();
    if (Object.is(next, empty)) accountDrafts.delete(scope);
    else accountDrafts.set(scope, next);
    if (accountDrafts.size) drafts.set(accountId, accountDrafts);
    else drafts.delete(accountId);
    notify();
  }

  return [value, setValue] as const;
}
