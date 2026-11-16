import { api } from "@/lib/api";
import type { OperationStatus } from "@/app/clientes/expediente-status";

export type DashboardStatusCounts = {
  solicitud: number;
  en_proceso: number;
  firma: number;
  desembolso: number;
  cerrado: number;
};

export type DashboardUserStat = {
  user_id: string;
  user_name: string;
  is_current_user: boolean;
  disbursements_total: number;
  unsigned_cases: number;
  pending_disbursement_cases: number;
  cases_total: number;
  documents_total: number;
  time_saved_minutes: number;
};

export type WorkspaceDashboard = {
  clients_total: number;
  cases_total: number;
  cases_this_month: number;
  cases_without_plan: number;
  unsigned_cases: number;
  pending_disbursement_cases: number;
  disbursed_cases: number;
  disbursed_this_month: number;
  documents_total: number;
  documents_this_month: number;
  time_saved_minutes: number;
  user_time_saved_minutes: number;
  user_disbursements_total: number;
  user_documents_total: number;
  status_counts: DashboardStatusCounts;
  user_stats: DashboardUserStat[];
  months: { month: string; total: number }[];
  formats: { pdf: number; docx: number; email: number };
  recent_cases: {
    id: string;
    client_id: string;
    client_name: string;
    reference: string | null;
    status: OperationStatus;
    created_at: string;
    has_payment_plan: boolean;
    actor_name?: string | null;
  }[];
};

export function getWorkspaceDashboard(accountId: string, companyId: string, signal?: AbortSignal) {
  const params = new URLSearchParams({ company_id: companyId });
  return api<WorkspaceDashboard>(`/dashboard?${params}`, { expectedAccountId: accountId, signal });
}
