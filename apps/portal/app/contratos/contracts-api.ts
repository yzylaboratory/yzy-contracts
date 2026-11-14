import { api, apiBlob, ApiError } from "@/lib/api";

export type ContractStatus = "uploaded" | "converting" | "converted" | "conversion_failed";
export type ConversionStatus = "pending" | "processing" | "completed" | "failed";

export const contractStatusLabels: Record<ContractStatus, string> = {
  uploaded: "Subido",
  converting: "Convirtiendo",
  converted: "Listo",
  conversion_failed: "Conversión fallida",
};

export type Contract = {
  id: string;
  name: string;
  owner_id: string;
  company_id: string | null;
  shared_company_ids?: string[] | null;
  original_file_name: string;
  status: ContractStatus;
  template_id?: string | null;
  latest_conversion_id?: string | null;
  created_at: string;
};

export type ContractSharing =
  | { company_id: string | null; shared_company_ids?: never }
  | { company_id?: never; shared_company_ids: string[] };

export type Conversion = {
  id: string;
  status: ConversionStatus;
  template_id?: string | null;
  error_code?: string | null;
  warnings: { code?: string; message?: string }[];
};

export type NativeVariable = { key: string; occurrences: number };

export type Template = {
  id: string;
  name: string;
  content_markdown: string;
  native_variables: NativeVariable[] | null;
  created_at?: string;
  updated_at?: string;
};

type ContractPage = { items: Contract[]; page: number; per_page: number; total: number };

type UploadTarget = {
  upload_id: string;
  upload_url: string;
  method: string;
  headers: Record<string, string>;
};

const mimeByExtension: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

const messages: Record<string, string> = {
  PAYMENT_REQUIRED: "Hay facturas vencidas para este contrato. Comunícate con el responsable de facturación para regularizar el pago.",
  FILE_TOO_LARGE: "El archivo supera el tamaño permitido.",
  PAYLOAD_TOO_LARGE: "El archivo supera el tamaño permitido.",
  UNSUPPORTED_FILE_TYPE: "Solo se admiten archivos PDF y Word (.docx).",
  UPLOAD_MISMATCH: "El archivo subido no coincide con el seleccionado. Vuelve a intentarlo.",
  UPLOAD_EXPIRED: "La subida expiró. Vuelve a intentarlo.",
  UPLOAD_NOT_COMPLETED: "La subida no terminó. Vuelve a intentarlo.",
  DOCX_VARIABLES_REQUIRED: "Agrega al menos una variable, como {{cliente_nombre}}, en el archivo Word antes de subirlo.",
  INVALID_DOCX_VARIABLES: "Revisa las variables en Word. Usa marcadores como {{cliente_nombre}}, sin espacios, en el texto normal de un párrafo o celda. El límite es de 100 variables distintas y 1,000 apariciones.",
  INVALID_DOCX_TEMPLATE: "No se pudo leer el archivo Word. Abre el original y guarda una copia .docx editable antes de subirla.",
  EMPTY_EXTRACTION: "No se pudo leer texto en el archivo.",
  COMPANY_NOT_FOUND: "La empresa ya no está disponible.",
  ACCESS_PENDING: "El superadministrador debe habilitar tu acceso para continuar.",
  CONTRACT_NOT_FOUND: "El contrato no existe o no pertenece a tu cuenta.",
  UNAUTHENTICATED: "Tu sesión terminó. Vuelve a iniciar sesión.",
  ACCOUNT_DELETED: "Esta cuenta ya no está activa.",
};

export function errorMessage(error: unknown, generic: string) {
  return error instanceof ApiError ? messages[error.code] ?? `${generic} (${error.code})` : generic;
}

export function listContracts(query: { page: number; perPage: number; name: string; status: string }, expectedAccountId?: string) {
  const params = new URLSearchParams({ page: String(query.page), per_page: String(query.perPage) });
  if (query.name) params.set("q", query.name);
  if (query.status !== "all") params.set("status", query.status);
  return api<ContractPage>(`/contracts?${params}`, { expectedAccountId });
}

export const getContract = (id: string, expectedAccountId?: string) => api<Contract>(`/contracts/${encodeURIComponent(id)}`, { expectedAccountId });
export const getContractDownload = (id: string, expectedAccountId: string) =>
  api<{ url: string }>(`/contracts/${encodeURIComponent(id)}/download-url`, { expectedAccountId });
function generationPath(id: string, action: "generation-access" | "render-pdf", companyId?: string, operationId?: string) {
  const path = `/contracts/${encodeURIComponent(id)}/${action}`;
  const params = new URLSearchParams();
  if (companyId) params.set("company_id", companyId);
  if (operationId) params.set("operation_id", operationId);
  return params.size ? `${path}?${params}` : path;
}
export const checkGenerationAccess = (id: string, expectedAccountId: string, companyId?: string, operationId?: string) =>
  api<void>(generationPath(id, "generation-access", companyId, operationId), { expectedAccountId });
export const renderContractPdf = (id: string, expectedAccountId: string, word: Blob, companyId?: string, operationId?: string) =>
  apiBlob(generationPath(id, "render-pdf", companyId, operationId), { method: "POST", expectedAccountId, body: word });
export const getConversion = (id: string, expectedAccountId?: string) => api<Conversion>(`/conversions/${id}`, { expectedAccountId });
export const getTemplate = (id: string, expectedAccountId?: string) => api<Template>(`/templates/${id}`, { expectedAccountId });
export const deleteContract = (id: string, expectedAccountId: string) =>
  api<void>(`/contracts/${encodeURIComponent(id)}`, { method: "DELETE", expectedAccountId });
export const startConversion = (id: string, expectedAccountId: string) =>
  api<Conversion>(`/contracts/${encodeURIComponent(id)}/convert`, { method: "POST", expectedAccountId, body: {} });
export const updateContract = (id: string, body: { name?: string } & Partial<ContractSharing>, expectedAccountId: string) =>
  api<Contract>(`/contracts/${encodeURIComponent(id)}`, { method: "PATCH", expectedAccountId, body });
export const saveTemplate = (id: string, name: string, markdown: string, expectedAccountId: string) =>
  api<Template>(`/templates/${encodeURIComponent(id)}`, { method: "PUT", expectedAccountId, body: { name, content_markdown: markdown } });

/** Uploads the file directly to storage and registers it as a contract. */
export async function uploadContract(file: File, name: string, sharing: ContractSharing, expectedAccountId: string) {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  const target = await api<UploadTarget>("/files/upload-url", {
    method: "POST", expectedAccountId,
    body: { file_name: file.name, mime_type: mimeByExtension[extension] ?? file.type, size_bytes: file.size },
  });

  const upload = await fetch(target.upload_url, { method: target.method, headers: target.headers, body: file });
  if (!upload.ok) throw new ApiError(upload.status, "UPLOAD_NOT_COMPLETED", "The upload to storage failed");

  return api<Contract>("/contracts", { method: "POST", expectedAccountId, body: { upload_id: target.upload_id, name, ...sharing } });
}
