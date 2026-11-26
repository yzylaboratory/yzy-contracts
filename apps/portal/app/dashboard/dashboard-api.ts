import { api } from "@/lib/api";
import type { OperationStatus } from "@/app/clientes/expediente-status";
import type { DashboardPeriodKey } from "./dashboard-period";

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

export type DashboardAmount = { count: number; amount_minor: number };

export type DashboardAgingBucket = { bucket: "1-30" | "31-60" | "61-90" | "90+"; count: number; amount_minor: number };

export type DashboardAttentionDue = {
  due_id: string;
  policy_id: string;
  policy_number: string;
  client_name: string;
  carrier_name: string;
  slot: number;
  due_on: string;
  amount_minor: number;
};

export type DashboardTrendMonth = {
  month: string;
  cases_created: number;
  disbursed_amount_minor: number;
  collected_amount_minor: number;
};

export type DashboardStalledCase = {
  id: string;
  client_id: string;
  client_name: string;
  reference: string | null;
  status: OperationStatus;
  last_activity_at: string;
  days_without_activity: number;
};

export type WorkspaceDashboard = {
  period: {
    key: DashboardPeriodKey;
    start: string;
    end: string;
    compare_start: string;
    compare_end: string;
    today: string;
  };
  attention: {
    overdue_dues: DashboardAmount;
    renewals_next_7_days: DashboardAmount;
    unsigned_over_5_days: number;
  };
  clients_total: number;
  clients_this_month: number;
  prospects_pending: number;
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
  contracts: {
    disbursed: { count: number; amount_minor: number; without_plan: number; previous_count: number; previous_amount_minor: number };
    in_process: { count: number; amount_minor: number; without_amount: number; solicitud: number; en_proceso: number; firma: number };
    cases_created: { count: number; previous_count: number };
    days_to_disbursement: { average: number | null; previous_average: number | null; sample: number };
  };
  insurance: {
    collected: { count: number; amount_minor: number; previous_amount_minor: number; due_in_period: number; paid_of_due_in_period: number };
    pending: { count: number; amount_minor: number; overdue_amount_minor: number };
    policies_total: number;
    policies_new: number;
    policies_new_previous: number;
    insured_clients: number;
    aging: DashboardAgingBucket[];
    by_carrier: { carrier_id: string; carrier_name: string; count: number; amount_minor: number }[];
    attention_dues: DashboardAttentionDue[];
  };
  trend: DashboardTrendMonth[];
  stalled_cases: { count: number; items: DashboardStalledCase[] };
  productivity: {
    time_saved_minutes: number;
    documents: { total: number; pdf: number; docx: number; email: number };
  };
  user_stats: DashboardUserStat[];
};

export function getWorkspaceDashboard(accountId: string, companyId: string, period: DashboardPeriodKey, signal?: AbortSignal) {
  const params = new URLSearchParams({ company_id: companyId, period });
  return api<WorkspaceDashboard>(`/dashboard?${params}`, { expectedAccountId: accountId, signal });
}
