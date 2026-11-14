"use client";

import { useEffect, useState } from "react";
import { ApiError, isActiveAccount } from "@/lib/api";
import { usePortalAccess } from "@/lib/portal-access";
import { errorMessage, getContract, getConversion, getTemplate, type Contract, type Conversion, type Template } from "./contracts-api";

type ContractDetail =
  | { kind: "loading" }
  | { kind: "missing" }
  | { kind: "error"; message: string }
  | { kind: "ready"; contract: Contract; conversion: Conversion | null; template: Template | null };

const POLL_MS = 2000;

/** Loads a contract with its conversion and template, and keeps polling while the conversion runs. */
export function useContract(id: string, accountId: string | undefined) {
  const { state } = usePortalAccess();
  const scope = state.kind === "ready" && state.identity.id === accountId &&
    state.identity.access === "active" && state.identity.companies.length
    ? JSON.stringify(state.identity.companies.map(company => company.id).sort()) : null;
  const [result, setResult] = useState<{ id: string; accountId: string; scope: string; detail: ContractDetail } | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!accountId || scope === null) return;
    const request = { id, accountId, scope };
    let active = true;
    let timer: number | undefined;

    async function load() {
      try {
        const contract = await getContract(id, request.accountId);
        const [conversion, contractTemplate] = await Promise.all([
          contract.latest_conversion_id ? getConversion(contract.latest_conversion_id, request.accountId) : null,
          contract.template_id ? getTemplate(contract.template_id, request.accountId) : null,
        ]);
        // The conversion may finish between the contract and conversion requests.
        const template = contractTemplate ?? (conversion?.template_id ? await getTemplate(conversion.template_id, request.accountId) : null);
        if (!await isActiveAccount(request.accountId) || !active) return;
        setResult({ ...request, detail: { kind: "ready", contract, conversion, template } });
        if (!template && (conversion?.status === "pending" || conversion?.status === "processing")) {
          timer = window.setTimeout(() => void load(), POLL_MS);
        }
      } catch (error) {
        if (!active) return;
        const missing = error instanceof ApiError && error.status === 404;
        setResult({ ...request, detail: missing ? { kind: "missing" } : { kind: "error", message: errorMessage(error, "No se pudo cargar el contrato.") } });
      }
    }

    void load();
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [id, accountId, attempt, scope]);

  const detail: ContractDetail = result && result.id === id && result.accountId === accountId && result.scope === scope ? result.detail : { kind: "loading" };
  return { detail, reload: () => setAttempt(current => current + 1) };
}
