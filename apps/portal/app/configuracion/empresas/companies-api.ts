import { api, ApiError } from "@/lib/api";

export type CompanySnapshot = {
  id: string;
  name: string;
  values: Record<string, string>;
};

export type Company = CompanySnapshot & {
  is_default: boolean;
  can_manage: boolean;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

type CompanyData = Pick<Company, "name" | "values">;
export type CompanyAction = "default" | "archive" | "restore";

const path = "/companies";
const companyPath = (id: string) => `${path}/${encodeURIComponent(id)}`;

export function listCompanies(accountId: string, includeArchived: boolean, signal?: AbortSignal, administration = false) {
  const endpoint = administration ? "/admin/companies" : includeArchived ? `${path}?include_archived=true` : path;
  return api<{ items: Company[] }>(endpoint, { expectedAccountId: accountId, signal });
}

export function saveCompany(accountId: string, companyId: string | undefined, body: CompanyData) {
  return api<Company>(companyId ? companyPath(companyId) : path, {
    method: companyId ? "PUT" : "POST", expectedAccountId: accountId, body,
  });
}

export function changeCompany(accountId: string, companyId: string, action: CompanyAction) {
  return api<Company>(`${companyPath(companyId)}/${action}`, { method: "POST", expectedAccountId: accountId });
}

export function deleteCompany(accountId: string, companyId: string) {
  return api<void>(companyPath(companyId), { method: "DELETE", expectedAccountId: accountId });
}

export function companyErrorMessage(error: unknown, fallback: string) {
  if (!(error instanceof ApiError)) return fallback;
  switch (error.code) {
    case "COMPANY_NOT_FOUND": return "La empresa ya no está disponible en tu cuenta.";
    case "COMPANY_ARCHIVED": return "La empresa está archivada. Restáurala antes de cambiar sus datos.";
    case "COMPANY_NOT_ARCHIVED": return "Archiva la empresa antes de borrarla.";
    case "COMPANY_IN_USE": return error.message;
    case "UNAUTHENTICATED": return "Inicia sesión de nuevo para continuar.";
    default: return fallback;
  }
}
