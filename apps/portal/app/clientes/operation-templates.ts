import { getTemplate, listContracts, type Contract } from "@/app/contratos/contracts-api";
import { ApiError } from "@/lib/api";
import type { DocumentType } from "@/app/contratos/document-catalog";
import { matchDocumentTemplate } from "./document-template-match";

export function resolveDocumentTemplate(templates: { matching: Contract[]; compatible: Contract[] }, accountId: string, companyId: string, type: DocumentType) {
  const { matching, compatible } = templates;
  const candidates = [...matching, ...compatible];
  let remembered: string | null = null;
  try { remembered = window.localStorage.getItem(`yzy-contracts:document-template:${accountId}:${companyId}:${type}`); } catch { /* Storage can be unavailable. */ }
  const assigned = candidates.find(contract => contract.id === remembered);
  if (assigned) return { kind: "ready" as const, contract: assigned };
  const ranked = matching.length ? matching : compatible;
  const scoped = ranked.filter(contract => contract.company_id === companyId);
  const preferred = scoped.length ? scoped : ranked;
  if (preferred.length === 1) return { kind: "ready" as const, contract: preferred[0] };
  return { kind: candidates.length ? "ambiguous" as const : "missing" as const };
}

export function hasOperationCompanyScope(contract: Pick<Contract, "company_id" | "shared_company_ids">, companyId: string) {
  return contract.company_id === companyId || (!contract.company_id && contract.shared_company_ids?.includes(companyId) === true);
}

async function listOperationContracts(accountId: string, companyId: string, signal: AbortSignal) {
  const contracts: Contract[] = [];
  let page = 1;
  while (!signal.aborted) {
    const result = await listContracts({ page, perPage: 100, name: "", status: "converted" }, accountId);
    contracts.push(...result.items.filter(contract => hasOperationCompanyScope(contract, companyId) && Boolean(contract.template_id)));
    if (result.items.length === 0 || result.page * result.per_page >= result.total) break;
    page += 1;
  }
  return contracts;
}

export async function listDocumentTemplates(accountId: string, companyId: string, type: DocumentType, signal: AbortSignal) {
  const contracts = (await listOperationContracts(accountId, companyId, signal)).filter(contract => contract.original_file_name.toLowerCase().endsWith(".docx"));
  const matching: Contract[] = [];
  const compatible: Contract[] = [];
  for (let index = 0; index < contracts.length && !signal.aborted; index += 8) {
    const templates = await Promise.all(contracts.slice(index, index + 8).map(async contract => {
      if (!contract.template_id) return;
      try {
        return { contract, template: await getTemplate(contract.template_id, accountId) };
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) return;
        throw error;
      }
    }));
    for (const entry of templates) {
      if (!entry) continue;
      const { contract, template } = entry;
      const keys = template.native_variables?.map(field => field.key);
      if (!keys) continue;
      const match = matchDocumentTemplate(type, contract.name, keys);
      if (match === "matching") matching.push(contract);
      if (match === "compatible") compatible.push(contract);
    }
  }
  return { matching, compatible };
}
