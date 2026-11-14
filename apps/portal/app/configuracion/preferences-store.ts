"use client";

import { useSyncExternalStore } from "react";

export type PortalPreferences = {
  name: string;
  readonly email: string;
  language: "es" | "en";
  defaultFormat: "pdf" | "docx" | "email";
  sendCopy: boolean;
};

const defaults: PortalPreferences = {
  name: "",
  email: "",
  language: "es",
  defaultFormat: "pdf",
  sendCopy: true,
};

const storageKey = "yzy-contracts:preferences:v1";
const listeners = new Set<() => void>();
let snapshot: PortalPreferences | undefined;

function isPreferences(value: unknown): value is PortalPreferences {
  if (typeof value !== "object" || value === null) return false;

  const { name, email, language, defaultFormat, sendCopy } = value as Partial<PortalPreferences>;
  return typeof name === "string" && name.length <= 100 &&
    typeof email === "string" && email.length <= 254 &&
    (language === "es" || language === "en") &&
    (defaultFormat === "pdf" || defaultFormat === "docx" || defaultFormat === "email") &&
    typeof sendCopy === "boolean";
}

function getSnapshot() {
  if (snapshot) return snapshot;

  try {
    const raw = window.sessionStorage.getItem(storageKey);
    if (raw) {
      const stored: unknown = JSON.parse(raw);
      if (isPreferences(stored)) {
        const { name, email, language, defaultFormat, sendCopy } = stored;
        snapshot = { name, email, language, defaultFormat, sendCopy };

        if (Object.hasOwn(stored, "photo")) {
          try {
            window.sessionStorage.setItem(storageKey, JSON.stringify(snapshot));
          } catch {
            // Legacy photo data stays outside the current snapshot if storage is blocked.
          }
        }

        return snapshot;
      }
    }
  } catch {
    // Defaults are available when browser storage is blocked.
  }

  return (snapshot = defaults);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function savePreferences(update: Partial<Omit<PortalPreferences, "email">>) {
  const current = getSnapshot();
  const preferences: PortalPreferences = {
    name: update.name ?? current.name,
    email: current.email,
    language: update.language ?? current.language,
    defaultFormat: update.defaultFormat ?? current.defaultFormat,
    sendCopy: update.sendCopy ?? current.sendCopy,
  };
  if (!isPreferences(preferences)) return false;

  try {
    window.sessionStorage.setItem(storageKey, JSON.stringify(preferences));
  } catch {
    return false;
  }

  snapshot = preferences;
  for (const listener of listeners) listener();
  return true;
}

export function usePortalPreferences() {
  const current = useSyncExternalStore(subscribe, getSnapshot, () => null);
  return {
    preferences: current ?? defaults,
    ready: current !== null,
    savePreferences,
  };
}
