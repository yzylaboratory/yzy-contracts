import { api, ApiError } from "@/lib/api";

export type BillingAccount = {
  id: string;
  company_id?: string | null;
  name: string;
  manager_user_id: string;
  starts_on: string;
  companies: { id: string; name: string }[];
  monthly_total_minor: number;
};

export type BillingInvoice = {
  id: string;
  account_id: string;
  account_name: string;
  period: string;
  due_on: string;
  state: "pending" | "in_review" | "paid";
  is_overdue: boolean;
  total_minor: number;
  months: number;
  discount_minor: number;
  renewal_month_limit: number;
  transfer_memo: string;
  transfer_report_id: string | null;
  transfer_reported_at?: string | null;
  lines: { company_id: string; company_name: string; unit_price_minor: number }[];
  transfer_reference: string | null;
  paid_at: string | null;
};

export type BankAccount = {
  bank_name: string;
  account_holder: string;
  account_type: string;
  account_number: string;
};

export type BankAccountSettings = {
  bank_account: BankAccount | null;
  revision: string | null;
  updated_at: string | null;
};

type BillingAccountInput = { name: string; manager_user_id: string; company_ids: string[] };
export type BillingDecision = "confirm" | "reject";
export type BillingOverview = { accounts: BillingAccount[]; invoices: BillingInvoice[]; bank_account: BankAccount | null };

export function getBilling(accountId: string, signal: AbortSignal) {
  return api<BillingOverview>("/billing", { expectedAccountId: accountId, signal });
}

export function prepareRenewal(accountId: string, billingAccountId: string) {
  return api<BillingInvoice>(`/billing/accounts/${encodeURIComponent(billingAccountId)}/renewal-invoice`, {
    method: "POST", expectedAccountId: accountId,
  });
}

export function reportTransfer(accountId: string, invoiceId: string, reference: string, months: number, expectedTotal: number) {
  return api<BillingInvoice>(`/billing/invoices/${encodeURIComponent(invoiceId)}/transfer`, {
    method: "PUT", expectedAccountId: accountId, body: { reference, months, expected_total_minor: expectedTotal },
  });
}

export type BillingPage<T> = { items: T[]; total: number; page: number; per_page: number };

export function getBillingAccounts(accountId: string, signal: AbortSignal, page: number, perPage: number) {
  return api<BillingPage<BillingAccount>>(`/admin/billing/accounts?page=${page}&per_page=${perPage}`, { expectedAccountId: accountId, signal });
}

export function getBankAccountSettings(accountId: string, signal?: AbortSignal) {
  return api<BankAccountSettings>("/admin/billing/bank-account", { expectedAccountId: accountId, signal });
}

export function saveBankAccountSettings(accountId: string, bankAccount: BankAccount, revision: string | null) {
  return api<BankAccountSettings>("/admin/billing/bank-account", {
    method: "PUT", expectedAccountId: accountId, body: { ...bankAccount, expected_revision: revision },
  });
}

export function getBillingInvoices(accountId: string, signal: AbortSignal, page: number, perPage: number, inReview: boolean) {
  return api<BillingPage<BillingInvoice>>(`/admin/billing/invoices?page=${page}&per_page=${perPage}&in_review=${inReview}`, { expectedAccountId: accountId, signal });
}

export function saveBillingAccount(accountId: string, billingAccountId: string, body: BillingAccountInput) {
  return api<BillingAccount>(`/admin/billing/accounts/${encodeURIComponent(billingAccountId)}`, {
    method: "PUT", expectedAccountId: accountId, body,
  });
}

export function verifyTransfer(accountId: string, invoiceId: string, reportId: string, decision: BillingDecision) {
  return api<BillingInvoice>(`/admin/billing/invoices/${encodeURIComponent(invoiceId)}/verification`, {
    method: "PUT", expectedAccountId: accountId, body: { report_id: reportId, decision },
  });
}

export function billingError(error: unknown, fallback: string) {
  if (!(error instanceof ApiError)) return fallback;
  if (error.code === "BILLING_BANK_REQUIRED") return "Configura la cuenta bancaria de transferencias antes de activar la facturación.";
  if (error.status === 401 || error.status === 403) return "Tu sesión o tus permisos cambiaron. Comprueba tu acceso.";
  if (error.status === 404) return "Este registro ya no está disponible. Actualiza la página e intenta de nuevo.";
  if (error.code === "BILLING_CONFLICT") return error.message;
  if (error.status === 422 || error.status === 400) return "Revisa los datos ingresados e intenta de nuevo.";
  return fallback;
}
