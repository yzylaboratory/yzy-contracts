"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { supabase } from "@/lib/supabase";
import { clientErrorMessage, type Client, type Operation } from "./clients-api";

type DirectoryLocation = { page: number; search: string };
export type RecordEditor = { kind: "client"; forLoan?: boolean } | { kind: "operation"; operationId?: string } | { kind: "payment-plan" | "extraordinary-payments" } | { kind: "loan-application" };

export const directoryLocations = new Map<string, DirectoryLocation>();
export const recordEditors = new Map<string, RecordEditor>();
const drafts = new Map<string, unknown>();
type SaveState = { kind: "pending" } | { kind: "failure"; message: string }
  | { kind: "saved"; value: Client | Operation; origin: symbol };
const saves = new Map<string, SaveState>();
const directoryRevisions = new Map<string, number>();
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function notify() {
  listeners.forEach(listener => listener());
}

// These values can contain customer data. Keep them in the current tab's memory only.
if (typeof window !== "undefined") {
  let accountId: string | undefined;
  supabase.auth.onAuthStateChange((_event, session) => {
    const nextAccount = session?.user.id;
    if (accountId === nextAccount) return;
    accountId = nextAccount;
    directoryLocations.clear();
    recordEditors.clear();
    drafts.clear();
    saves.clear();
    directoryRevisions.clear();
    notify();
  });
}

export function clientScope(accountId: string, clientId?: string) {
  return JSON.stringify([accountId, clientId]);
}

export function clientDraftKey(accountId: string, clientId?: string) {
  return `${clientScope(accountId, clientId)}:client`;
}

export function hasClientDraft(key: string) {
  return drafts.has(key) || saves.has(key);
}

export function useClientDirectoryRevision(scope: string) {
  return useSyncExternalStore(subscribe, () => directoryRevisions.get(scope) ?? 0, () => 0);
}

export function markClientDirectoryUpdated(scope: string) {
  directoryRevisions.set(scope, (directoryRevisions.get(scope) ?? 0) + 1);
  notify();
}

export function useClientSave<T extends Client | Operation>(key: string, onDirty: (dirty: boolean) => void,
  onSaved: (value: T, fromThisVisit: boolean) => void, directoryScope?: string) {
  const result = useSyncExternalStore(subscribe, () => saves.get(key), () => undefined);
  const visit = useRef<{ origin: symbol; href: string }>(undefined);

  useEffect(() => {
    function leaveHistoryEntry() { visit.current = undefined; }
    window.addEventListener("popstate", leaveHistoryEntry);
    return () => window.removeEventListener("popstate", leaveHistoryEntry);
  }, []);

  useEffect(() => {
    if (result?.kind !== "saved" || saves.get(key) !== result) return;
    saves.delete(key);
    notify();
    onDirty(false);
    const fromThisVisit = visit.current?.origin === result.origin && visit.current.href === window.location.href;
    onSaved(result.value as T, fromThisVisit);
  }, [key, onDirty, onSaved, result]);

  async function save(request: () => Promise<T>, fallback: string) {
    const current = saves.get(key);
    if (current?.kind === "pending" || current?.kind === "saved") return;
    const pending: SaveState = { kind: "pending" };
    const origin = Symbol();
    visit.current = { origin, href: window.location.href };
    saves.set(key, pending);
    onDirty(true);
    notify();
    try {
      const value = await request();
      if (saves.get(key) !== pending) return;
      drafts.delete(key);
      saves.set(key, { kind: "saved", value, origin });
      if (directoryScope) directoryRevisions.set(directoryScope, (directoryRevisions.get(directoryScope) ?? 0) + 1);
    } catch (error) {
      if (saves.get(key) !== pending) return;
      saves.set(key, { kind: "failure", message: clientErrorMessage(error, fallback) });
    }
    notify();
  }

  return { save, saving: result?.kind === "pending" || result?.kind === "saved", failure: result?.kind === "failure" ? result.message : "" };
}

export function useClientDraft<T>(key: string, initial: () => T, onDirty: (dirty: boolean) => void) {
  const [draft, setDraft] = useState(() => (drafts.get(key) as T | undefined) ?? initial());

  useEffect(() => {
    onDirty(drafts.has(key));
    return () => onDirty(false);
  }, [key, onDirty]);

  function updateDraft(next: T) {
    drafts.set(key, next);
    setDraft(next);
    onDirty(true);
  }

  /** For changes that land after an await, so edits made meanwhile are kept. */
  function patchDraft(change: (current: T) => T) {
    setDraft(current => {
      const next = change(current);
      drafts.set(key, next);
      return next;
    });
    onDirty(true);
  }

  function discardDraft() {
    drafts.delete(key);
    saves.delete(key);
    notify();
    onDirty(false);
  }

  return { draft, updateDraft, patchDraft, discardDraft };
}
