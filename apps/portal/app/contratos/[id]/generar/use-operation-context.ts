"use client";

import { useEffect, useState } from "react";
import { clientErrorMessage, getClient, getOperation } from "@/app/clientes/clients-api";
import { usePortalAccess } from "@/lib/portal-access";
import type { DocumentType } from "@/app/contratos/document-catalog";
import type { OperationContext } from "./expediente-context";

export type OperationSelection = { companyId: string; clientId: string; operationId: string; type: DocumentType };

type Result = { kind: "ready"; data: OperationContext } | { kind: "error"; message: string };

export function useOperationContext(selection: OperationSelection | null, invalid: boolean, accountId?: string) {
  const { state } = usePortalAccess();
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ key: string; result: Result }>();
  const authorized = Boolean(selection && state.kind === "ready" && state.identity.id === accountId && state.identity.access === "active" &&
    state.identity.companies.some(company => company.id === selection.companyId));
  const key = JSON.stringify([accountId, selection, attempt]);

  useEffect(() => {
    if (!authorized || !accountId || !selection) return;
    const { companyId, clientId, operationId, type } = selection;
    const controller = new AbortController();
    Promise.all([getClient(accountId, clientId, controller.signal), getOperation(accountId, companyId, clientId, operationId, controller.signal)])
      .then(([client, operation]) => {
        if (controller.signal.aborted) return;
        if (operation.id !== operationId || operation.company_id !== companyId || operation.client_id !== client.id) {
          throw new Error("The operation scope did not match the request");
        }
        setResult({ key, result: { kind: "ready", data: { client, operation, type } } });
      })
      .catch(error => {
        if (!controller.signal.aborted) setResult({ key, result: { kind: "error", message: clientErrorMessage(error, "No se pudo cargar el expediente.") } });
      });
    return () => controller.abort();
  }, [accountId, authorized, key, selection]);

  const reload = () => setAttempt(value => value + 1);
  if (invalid) return { kind: "invalid" as const, message: "Abre el documento desde un expediente para cargar los datos del cliente." };
  if (!selection) return { kind: "manual" as const };
  if (!accountId || state.kind === "loading") return { kind: "loading" as const };
  if (!authorized) return { kind: "invalid" as const, message: "Este expediente no está disponible para tu cuenta." };
  return result?.key === key ? { ...result.result, reload } : { kind: "loading" as const };
}
