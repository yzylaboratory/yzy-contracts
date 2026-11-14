"use client";

import { ApiError } from "@/lib/api";
import { saveGeneratedDocument, type GeneratedDocument } from "./generated-documents-api";

export type { GeneratedDocument } from "./generated-documents-api";

export function localDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export const documentTimeZone = "America/Santo_Domingo";
const documentDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: documentTimeZone,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function documentDateKey(date = new Date()) {
  const parts = documentDate.formatToParts(date);
  return ["year", "month", "day"].map(type => parts.find(part => part.type === type)?.value).join("-");
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const imports = new Map<string, Promise<boolean>>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isLegacyDocument(value: unknown): value is GeneratedDocument {
  if (!isRecord(value)) return false;
  const { id, contractId, contractName, createdAt, format, filename, markdown, email } = value;
  if (typeof id !== "string" || !uuid.test(id) || typeof contractId !== "string" || !uuid.test(contractId) ||
      typeof contractName !== "string" || !contractName.trim() ||
      typeof createdAt !== "string" || !Number.isFinite(Date.parse(createdAt)) ||
      typeof filename !== "string" || !filename || typeof markdown !== "string" || !markdown.trim()) return false;
  if (format === "pdf" || format === "docx") return email === undefined;
  return format === "email" && isRecord(email) && typeof email.to === "string" &&
    (email.cc === undefined || typeof email.cc === "string") && typeof email.subject === "string" &&
    typeof email.message === "string" && (email.attachmentFormat === "pdf" || email.attachmentFormat === "docx");
}

function readLegacy(key: string): unknown[] {
  const raw = window.sessionStorage.getItem(key);
  if (!raw) return [];
  const snapshot: unknown = JSON.parse(raw);
  return isRecord(snapshot) && Array.isArray(snapshot.generatedDocuments) ? snapshot.generatedDocuments : [];
}

async function importLegacy(accountId: string) {
  const key = `yzy-contracts:workspace:v3:${accountId}`;
  let documents: unknown[];
  try {
    documents = readLegacy(key);
  } catch {
    return false;
  }

  let synced = true;
  for (const document of documents) {
    if (!isLegacyDocument(document)) {
      synced = false;
      continue;
    }
    try {
      await saveGeneratedDocument(accountId, document.id, document.contractId, document, document);
      const remaining = readLegacy(key).filter(entry => !isRecord(entry) || entry.id !== document.id);
      if (remaining.length) window.sessionStorage.setItem(key, JSON.stringify({ generatedDocuments: remaining }));
      else window.sessionStorage.removeItem(key);
    } catch (error) {
      synced = false;
      if (!(error instanceof ApiError) || [401, 403, 429].includes(error.status) || error.status >= 500) break;
    }
  }
  return synced;
}

export const legacyHistoryWarning = "Algunos documentos de esta sesión siguen pendientes de sincronización.";

export function syncLegacyGeneratedDocuments(accountId: string) {
  const existing = imports.get(accountId);
  if (existing) return existing;
  const pending = importLegacy(accountId).finally(() => { imports.delete(accountId); });
  imports.set(accountId, pending);
  return pending;
}
