import type { CaseApplication, ClientProfile } from "@/components/case-application/case-application";
import { api, apiBlob, ApiError } from "@/lib/api";

export type ClientWrite = {
  name: string;
  identity?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  income_source?: string | null;
  profile?: ClientProfile | null;
};

export type Vehicle = {
  registration_number?: string;
  chassis_number?: string;
  plate?: string;
  make?: string;
  model?: string;
  year?: string;
  color?: string;
  engine_number?: string;
  vehicle_type?: string;
};

export type Payment = { date: string; amount_minor: number };
export type MonthlyPlan = { capital_minor: number; monthly_rate_basis_points: number; installment_count: number };
export type Financing = {
  interest_installments: Payment[];
  final_principal: Payment;
  extraordinary_payments: Payment[];
  extraordinary_from_signature?: boolean;
  extraordinary_payment_count?: number;
  insurance_installment_count?: number | null;
  monthly_plan?: MonthlyPlan;
};

export type OperationStatus = "solicitud" | "en_proceso" | "firma" | "desembolso" | "cerrado";

export type OperationWrite = {
  contract_id?: string | null;
  reference?: string | null;
  contract_date?: string | null;
  signature_date?: string | null;
  status?: OperationStatus;
  vehicle: Vehicle;
  financing?: Financing | null;
  application?: CaseApplication | null;
  insurance_installment_minor?: number | null;
  insurance_paid?: boolean;
};

export type OperationPatch = Partial<OperationWrite> & { extraordinary_payment_amounts_minor?: number[] };

type AuditFields = { id: string; created_at: string; updated_at: string };
export type Client = ClientWrite & AuditFields;
export type Operation = Omit<OperationWrite, "status"> & AuditFields & {
  contract_id: string | null;
  client_id: string;
  company_id: string;
  status: OperationStatus;
};
type DirectoryPage<T> = { items: T[]; page: number; per_page: number; total: number };
export type ClientPage = DirectoryPage<Client>;
export type ExpedienteListItem = {
  id: string;
  client_id: string;
  client_name: string;
  client_identity: string | null;
  company_id: string;
  company_name: string;
  reference: string | null;
  contract_date: string | null;
  status: OperationStatus;
  vehicle: Vehicle;
  created_at: string;
};
export type ExpedientePage = DirectoryPage<ExpedienteListItem>;
export type ClientTimelineValue = string | number | boolean | null | ClientTimelineValue[] | { [key: string]: ClientTimelineValue };
export type ClientTimelineChange = { field: string; before: ClientTimelineValue; after: ClientTimelineValue };
export type ClientTimelineEvent = {
  id: string;
  kind: "client_created" | "client_updated" | "operation_created" | "operation_updated" | "document_generated";
  occurred_at: string;
  operation_label: string | null;
  document_name: string | null;
  actor_name?: string | null;
  changes?: ClientTimelineChange[];
};
export type ClientTimelinePage = { items: ClientTimelineEvent[]; page: number; per_page: number; total: number };

function clientPath(clientId: string) {
  return `/clients/${encodeURIComponent(clientId)}`;
}

function operationPath(companyId: string, clientId: string, operationId: string) {
  return `/companies/${encodeURIComponent(companyId)}${clientPath(clientId)}/operations/${encodeURIComponent(operationId)}`;
}

type DirectoryQuery = { page: number; perPage: number; search: string };
type ExpedienteQuery = DirectoryQuery & { companyId: string };

function directoryParams(query: DirectoryQuery) {
  const params = new URLSearchParams({ page: String(query.page), per_page: String(query.perPage) });
  if (query.search) params.set("q", query.search);
  return params;
}

export function listClients(accountId: string, query: DirectoryQuery, signal: AbortSignal) {
  return api<ClientPage>(`/clients?${directoryParams(query)}`, { expectedAccountId: accountId, signal });
}

export function listExpedientes(accountId: string, query: ExpedienteQuery, signal: AbortSignal) {
  const params = directoryParams(query);
  params.set("company_id", query.companyId);
  return api<ExpedientePage>(`/expedientes?${params}`, { expectedAccountId: accountId, signal });
}

export function getExpediente(accountId: string, expedienteId: string, signal?: AbortSignal) {
  return api<Operation>(`/expedientes/${encodeURIComponent(expedienteId)}`, { expectedAccountId: accountId, signal });
}

export function deleteExpediente(accountId: string, operation: Pick<Operation, "id" | "company_id" | "client_id">) {
  return api<void>(`/companies/${encodeURIComponent(operation.company_id)}/clients/${encodeURIComponent(operation.client_id)}/operations/${encodeURIComponent(operation.id)}`, {
    method: "DELETE", expectedAccountId: accountId,
  });
}

export function getLoanApplicationDocument(accountId: string, expedienteId: string, format: "pdf" | "docx") {
  return apiBlob(`/expedientes/${encodeURIComponent(expedienteId)}/solicitud-prestamo.${format}`, { expectedAccountId: accountId });
}

export function getClient(accountId: string, clientId: string, signal?: AbortSignal) {
  return api<Client>(clientPath(clientId), { expectedAccountId: accountId, signal });
}

export function listClientTimeline(accountId: string, clientId: string, page: number, signal: AbortSignal, operationId?: string) {
  const params = new URLSearchParams({ page: String(page), per_page: "20" });
  if (operationId) params.set("operation_id", operationId);
  return api<ClientTimelinePage>(`${clientPath(clientId)}/timeline?${params}`, {
    expectedAccountId: accountId,
    signal,
  });
}

export function saveClient(accountId: string, clientId: string | undefined, body: ClientWrite) {
  return api<Client>(clientId ? clientPath(clientId) : "/clients", {
    method: clientId ? "PATCH" : "POST", expectedAccountId: accountId, body,
  });
}

export function listOperations(accountId: string, clientId: string, signal: AbortSignal) {
  return api<Operation[]>(`${clientPath(clientId)}/operations`, { expectedAccountId: accountId, signal });
}

export function getOperation(accountId: string, companyId: string, clientId: string, operationId: string, signal?: AbortSignal) {
  return api<Operation>(operationPath(companyId, clientId, operationId), { expectedAccountId: accountId, signal });
}

export function saveOperation(accountId: string, companyId: string, clientId: string, operationId: string | undefined, body: OperationPatch) {
  return api<Operation>(operationId ? operationPath(companyId, clientId, operationId) : `${clientPath(clientId)}/operations`, {
    method: operationId ? "PATCH" : "POST", expectedAccountId: accountId,
    body: operationId ? body : { ...body, company_id: companyId },
  });
}

export function clientErrorMessage(error: unknown, fallback: string) {
  if (!(error instanceof ApiError)) return fallback;
  if (error.status === 401) return "Tu sesión terminó. Vuelve a iniciar sesión.";
  if (error.code === "CLIENT_IDENTITY_CONFLICT") return "Ya existe un cliente con esa identificación. Búscalo para usar sus datos en el expediente.";
  if (error.code === "BILLING_REQUIRED") return "Solo el responsable de facturación de la empresa puede eliminar expedientes.";
  if (error.status === 403 || error.status === 404) return "El expediente o la empresa ya no están disponibles para tu cuenta.";
  if (error.status === 422) return error.message || fallback;
  return fallback;
}
