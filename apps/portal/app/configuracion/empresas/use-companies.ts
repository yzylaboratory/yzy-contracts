"use client";

import { useEffect, useState } from "react";
import { api, isActiveAccount } from "@/lib/api";
import { companyErrorMessage, listCompanies, type Company } from "./companies-api";

type CompanyList =
  | { kind: "loading" }
  | { kind: "ready"; items: Company[]; total?: number }
  | { kind: "error"; message: string };

export function useCompanies(accountId: string, includeArchived = false, administration = false, page = 1, perPage = 10) {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ key: string; list: CompanyList } | null>(null);
  const key = JSON.stringify([accountId, includeArchived, administration, attempt, page, perPage]);

  useEffect(() => {
    function refresh(event: Event) {
      if ((event as CustomEvent<string>).detail === accountId) setAttempt(current => current + 1);
    }
    window.addEventListener("yzy:companies-updated", refresh);
    return () => window.removeEventListener("yzy:companies-updated", refresh);
  }, [accountId]);

  useEffect(() => {
    const request = new AbortController();

    async function load() {
      try {
        const { signal } = request;
        const options = { expectedAccountId: accountId, signal };
        let next: CompanyList;
        if (administration) {
          const { items, total } = await api<{ items: Company[]; total: number }>(`/admin/companies?archived=${includeArchived}&page=${page}&per_page=${perPage}`, options);
          next = { kind: "ready", items, total };
        } else {
          const { items } = await listCompanies(accountId, includeArchived, signal);
          next = { kind: "ready", items };
        }
        if (await isActiveAccount(accountId) && !signal.aborted) setResult({ key, list: next });
      } catch (error) {
        if (!request.signal.aborted) {
          setResult({ key, list: { kind: "error", message: companyErrorMessage(error, "No se pudieron cargar las empresas.") } });
        }
      }
    }

    void load();
    return () => request.abort();
  }, [accountId, includeArchived, administration, key, page, perPage]);

  const list: CompanyList = result?.key === key ? result.list : { kind: "loading" };
  return { list, previous: result?.list, reload: () => setAttempt(current => current + 1) };
}

export function refreshCompanyLists(accountId: string) {
  window.dispatchEvent(new CustomEvent("yzy:companies-updated", { detail: accountId }));
}
