import { api, ApiError } from "@/lib/api";
import type { Company } from "@/app/configuracion/empresas/companies-api";
import type { TourOutcome, TourStep } from "@/components/product-tour/tour-steps";
import type { ActivityScreen } from "@/lib/activity";

export type UserStatus = "pending" | "invited" | "active" | "suspended";
export type DashboardActivity = {
  daily_users: { day: string; users: number }[];
  top_screens: { screen: ActivityScreen; visits: number }[];
};

export const activityScreenLabels: Record<ActivityScreen, string> = {
  dashboard: "Dashboard",
  clients: "Clientes",
  client_record: "Expediente del cliente",
  contracts: "Contratos",
  contract_create: "Nuevo contrato",
  contract_edit: "Editar contrato",
  document_generate: "Generar documento",
  generated_documents: "Docs Generados",
  settings: "Configuración",
  administration: "Administración",
  billing: "Facturación",
  insurance: "Control de Pólizas",
  preaccess: "Acceso pendiente",
  login: "Inicio de sesión",
  not_found: "Página no encontrada",
};

export type DashboardSummary = {
  activity?: DashboardActivity;
  usage: {
    period: string;
    active_companies: number;
    enabled_users: number;
    users_seen_this_month: number;
    access_requests: number;
    documents_this_month: number;
  };
  collections: {
    transfers_to_review: number;
    transfers_to_review_minor: number;
    overdue_invoices: number;
    overdue_minor: number;
    confirmed_this_month_minor: number;
    recent_reports_total: number;
    recent_reports_page: number;
    recent_reports_per_page: number;
    recent_reports: { invoice_id: string; account_name: string; total_minor: number; reported_at: string }[];
  };
};

export function getAdminDashboard(accountId: string, signal: AbortSignal, page: number, perPage: number) {
  return api<DashboardSummary>(`/admin/dashboard?page=${page}&per_page=${perPage}`, { expectedAccountId: accountId, signal });
}

export type AdminActivity = {
  id: string | null;
  name: string | null;
  email: string;
  status: UserStatus;
  invited_at: string | null;
  invitation_sent_at: string | null;
  invitation_accepted: boolean;
  first_portal_access_at: string | null;
  last_portal_access_at: string | null;
  last_tour: {
    opened_at: string;
    last_step: TourStep;
    last_step_at: string;
    outcome: TourOutcome | null;
    outcome_at: string | null;
  } | null;
  onboarding_completed_at: string | null;
  documents_generated: number;
  last_document_generated_at: string | null;
  last_activity: ActivityEvent | null;
};
export type AdminActivityPage = { items: AdminActivity[]; page: number; per_page: number; total: number };
export type ActivityEventKind =
  | "portal_visit" | "portal_redirect" | "not_found" | "document_previewed"
  | "client_created" | "client_updated" | "operation_created" | "operation_updated"
  | "generation_access" | "document_render" | "document_export" | "portal_access"
  | "tour_opened" | "tour_step_viewed" | "tour_completed" | "tour_skipped"
  | "document_generated" | "invitation_registered" | "invitation_sent";
export type ActivityEvent = {
  event: ActivityEventKind;
  screen: ActivityScreen | null;
  result: "observed" | "success" | "blocked" | "failed";
  occurred_at: string;
  step: TourStep | null;
};
export type ActivityEventPage = Omit<AdminActivityPage, "items"> & { items: ActivityEvent[] };
export const userStatuses: Record<UserStatus, string> = {
  pending: "Pendiente", invited: "Invitado", active: "Habilitado", suspended: "Deshabilitado",
};

export type AdminUser = {
  id: string | null;
  name: string | null;
  email: string;
  status: UserStatus;
  created_at: string;
  manages_billing: boolean;
};

export type AdminUsersPage = { items: AdminUser[]; page: number; per_page: number; total: number };

export function getAdminUsers(accountId: string, query: string, status: UserStatus | "", signal: AbortSignal, pagination?: { page: number; perPage: number }) {
  const params = new URLSearchParams();
  if (query) params.set("query", query);
  if (status) params.set("status", status);
  if (pagination) {
    params.set("page", String(pagination.page));
    params.set("per_page", String(pagination.perPage));
  }
  return api<AdminUsersPage>(`/admin/users?${params}`, { expectedAccountId: accountId, signal });
}

export function setUserAccess(accountId: string, userId: string, enabled: boolean) {
  return api<AdminUser>(`/admin/users/${encodeURIComponent(userId)}/access`, {
    method: "PUT", body: { enabled }, expectedAccountId: accountId,
  });
}

export function setUserBilling(accountId: string, userId: string, managesBilling: boolean) {
  return api<AdminUser>(`/admin/users/${encodeURIComponent(userId)}/billing`, {
    method: "PUT", body: { manages_billing: managesBilling }, expectedAccountId: accountId,
  });
}

export function getAdminActivity(accountId: string, query: string, page: number, signal: AbortSignal) {
  const params = new URLSearchParams({ page: String(page), per_page: "25" });
  if (query) params.set("query", query);
  return api<AdminActivityPage>(`/admin/activity?${params}`, { expectedAccountId: accountId, signal });
}

export function getAdminActivityEvents(accountId: string, userId: string, page: number, signal: AbortSignal) {
  const params = new URLSearchParams({ page: String(page), per_page: "25" });
  return api<ActivityEventPage>(`/admin/activity/${encodeURIComponent(userId)}/events?${params}`, {
    expectedAccountId: accountId, signal,
  });
}

export function getAdminCompanies(accountId: string, signal: AbortSignal) {
  return api<{ items: Company[] }>("/admin/companies", { expectedAccountId: accountId, signal });
}

export function adminErrorMessage(error: unknown) {
  if (error instanceof ApiError) {
    if (error.code === "COMPANY_NOT_FOUND" || error.code === "COMPANY_ARCHIVED") return "Una empresa ya no está disponible. Actualiza la lista e intenta de nuevo.";
    if (error.code === "ACCESS_USER_NOT_FOUND") return "La persona todavía no ha iniciado sesión en el portal.";
    if (error.code === "VALIDATION_ERROR") return "Revisa los datos ingresados e intenta de nuevo.";
    if (error.status === 409) return "Los datos cambiaron. Actualiza la lista antes de continuar.";
    if (error.status === 401 || error.status === 403) return "Tu sesión o tus permisos cambiaron. Comprueba tu acceso.";
  }
  return "No pudimos completar la operación. Intenta de nuevo.";
}
