import { api } from "@/lib/api";
import type { Carrier } from "@/app/control-seguros/insurance-api";

export type InsurerPage = { items: Carrier[]; page: number; per_page: number; total: number };

const path = "/admin/insurance-carriers";
const insurerPath = (id: string) => `${path}/${encodeURIComponent(id)}`;

export function listInsurers(accountId: string, page: number, perPage: number, signal: AbortSignal) {
  return api<InsurerPage>(`${path}?page=${page}&per_page=${perPage}`, { expectedAccountId: accountId, signal });
}

export function saveInsurer(accountId: string, id: string | undefined, name: string) {
  return api<Carrier>(id ? insurerPath(id) : path, {
    method: id ? "PUT" : "POST", expectedAccountId: accountId, body: { name },
  });
}

export function deleteInsurer(accountId: string, id: string) {
  return api<void>(insurerPath(id), { method: "DELETE", expectedAccountId: accountId });
}
