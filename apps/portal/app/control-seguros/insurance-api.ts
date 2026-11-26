import { api, ApiError } from "@/lib/api";

export type Carrier = { id: string; name: string };
export type PolicyWrite = {
  carrier_id: string;
  client_id: string;
  number: string;
  first_due_on: string;
  installment_count: number;
  installment_minor: number;
  renewal_on: string;
  renewal_minor: number;
};
export type Policy = PolicyWrite & { id: string; client_name: string; revision: number };
export type Due = {
  id: string;
  policy_id: string;
  slot: number;
  due_on: string;
  amount_minor: number;
  paid_on: string | null;
  replaced: boolean;
};
export type Overview = { today: string; carriers: Carrier[]; policies: Policy[]; dues: Due[] };
export type PolicyDetail = { today: string; carrier_name: string; policy: Policy; dues: Due[] };
export type Scope = { company: string; account: string };

export function insuranceMessage(error: unknown) {
  return error instanceof ApiError && (error.status === 409 || error.status === 422)
    ? error.message
    : error instanceof ApiError && error.status === 404
      ? "No se encontró el recurso o ya no tienes acceso."
      : "No se pudo completar la solicitud. Inténtalo de nuevo.";
}

export function insuranceApi({ company, account }: Scope) {
  const base = `/companies/${company}/insurance`;
  const policies = `${base}/policies`;
  const expectedAccountId = account;
  return {
    overview: (days: number, includeOverdue: boolean, signal: AbortSignal) =>
      api<Overview>(`${base}?days=${days}&include_overdue=${includeOverdue}`, { expectedAccountId, signal }),
    detail: (id: string, signal: AbortSignal) =>
      api<PolicyDetail>(`${policies}/${id}`, { expectedAccountId, signal }),
    save: (body: PolicyWrite, previous?: Policy) =>
      previous
        ? api<PolicyDetail>(`${policies}/${previous.id}`, { method: "PUT", body: { ...body, revision: previous.revision }, expectedAccountId })
        : api<PolicyDetail>(policies, { method: "POST", body, expectedAccountId }),
    pay: (policy: string, due: string, paidOn: string) =>
      api<Due>(`${policies}/${policy}/dues/${due}/payment`, { method: "PUT", body: { paid_on: paidOn }, expectedAccountId }),
  };
}
