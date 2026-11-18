import { api, ApiError } from "@/lib/api";

export type Prospect = {
  id: string;
  submitted_at: string;
  name: string;
  identity: string;
  phone: string;
  address: string;
  email: string | null;
  nationality: string | null;
  marital_status: string | null;
  position: string | null;
};

export type ProspectLink = { token: string; expires_at: string };

type ProspectList = { items: Prospect[] };
type ConvertedProspect = { client_id: string };

function companyPath(companyId: string) {
  return `/companies/${encodeURIComponent(companyId)}`;
}

export function createProspectLink(accountId: string, companyId: string) {
  return api<ProspectLink>(`${companyPath(companyId)}/prospect-links`, {
    method: "POST",
    expectedAccountId: accountId,
  });
}

export function listProspects(accountId: string, companyId: string, signal: AbortSignal) {
  return api<ProspectList>(`${companyPath(companyId)}/prospects`, { expectedAccountId: accountId, signal });
}

export function convertProspect(accountId: string, companyId: string, prospectId: string) {
  return api<ConvertedProspect>(`${companyPath(companyId)}/prospects/${encodeURIComponent(prospectId)}/convert`, {
    method: "POST",
    expectedAccountId: accountId,
  });
}

export function prospectLinkUrl(origin: string, token: string) {
  return `${origin}/prospecto#${token}`;
}

export function prospectErrorMessage(error: unknown, fallback: string) {
  if (error instanceof ApiError && error.status === 409) {
    return "Ya existe un cliente con esa identificación. No se cambió ningún dato del cliente existente.";
  }
  if (error instanceof ApiError && error.status === 404) {
    return "El prospecto ya no está disponible para esta empresa.";
  }
  if (error instanceof ApiError && error.status === 401) {
    return "Tu sesión terminó. Vuelve a iniciar sesión.";
  }
  if (error instanceof ApiError && error.status === 403) {
    return "Tu cuenta no puede gestionar prospectos de esta empresa.";
  }
  return fallback;
}

const prospectDate = new Intl.DateTimeFormat("es-DO", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Santo_Domingo" });

export function formatProspectDate(value: string) {
  return prospectDate.format(new Date(value));
}

export function prospectMatches(prospect: Prospect, search: string) {
  const term = search.trim().toLocaleLowerCase("es-DO");
  if (!term) return true;
  return [prospect.name, prospect.identity, prospect.phone, prospect.email]
    .some(value => value?.toLocaleLowerCase("es-DO").includes(term));
}
