import { api, apiBlob } from "@/lib/api";
import type { CompanySnapshot } from "@/app/configuracion/empresas/companies-api";

export type DocumentFormat = "pdf" | "docx";
export type GeneratedFormat = DocumentFormat | "email";

type EmailDraft = {
  to: string;
  cc?: string;
  subject: string;
  message: string;
  attachmentFormat: DocumentFormat;
};

export type GeneratedOutput = {
  format: GeneratedFormat;
  filename: string;
  markdown: string;
  email?: EmailDraft;
  company?: CompanySnapshot;
  operationId?: string;
  documentType?: string;
};

export type GeneratedDocumentMetadata = Pick<GeneratedOutput, "format" | "filename" | "company" | "operationId" | "documentType"> & {
  id: string;
  contractId: string;
  contractName: string;
  createdAt: string;
  hasArtifact?: boolean;
};

export type GeneratedDocument = GeneratedOutput & GeneratedDocumentMetadata;

type MetadataResponse = Pick<GeneratedOutput, "format" | "filename"> & {
  id: string;
  contract_id: string;
  contract_name: string;
  created_at: string;
  has_artifact?: boolean;
  company?: CompanySnapshot | null;
  operation_id?: string | null;
  document_type?: string | null;
};

type EmailResponse = Omit<EmailDraft, "attachmentFormat"> & { attachment_format: DocumentFormat };
type DetailResponse = MetadataResponse & { markdown: string; email?: EmailResponse | null };
type PageResponse = { items: MetadataResponse[]; total: number; page: number; per_page: number };

export type GeneratedDocumentStats = {
  total: number;
  current_month_total: number;
  months: { month: string; total: number }[];
  formats: Record<GeneratedFormat, number>;
};

const documentsPath = "/generated-documents";

function metadata({ id, contract_id, contract_name, format, filename, created_at, has_artifact, company, operation_id, document_type }: MetadataResponse): GeneratedDocumentMetadata {
  return { id, contractId: contract_id, contractName: contract_name, format, filename, createdAt: created_at, hasArtifact: has_artifact === true, ...(company && { company }), ...(operation_id && { operationId: operation_id }), ...(document_type && { documentType: document_type }) };
}

export async function saveGeneratedArtifact(
  accountId: string,
  id: string,
  contractId: string,
  { format, filename, markdown, email, company, operationId, documentType }: GeneratedOutput,
  artifact: Blob,
) {
  const body = new FormData();
  const emailBody = toEmailResponse(email);
  body.set("metadata", JSON.stringify({ contract_id: contractId, format, filename, markdown, ...(emailBody && { email: emailBody }), ...(company && { company }), ...(operationId && { operation_id: operationId }), ...(documentType && { document_type: documentType }) }));
  const artifactName = email ? filename.replace(/\.eml$/, `.${email.attachmentFormat}`) : filename;
  body.set("artifact", artifact, artifactName);
  const saved = await api<MetadataResponse>(`${documentsPath}/${encodeURIComponent(id)}/artifact`, {
    method: "PUT", expectedAccountId: accountId, body,
  });
  if (saved.id !== id || saved.has_artifact !== true) throw new Error("The saved document did not match the request");
}

export async function getGeneratedArtifact(accountId: string, id: string) {
  const artifact = await apiBlob(`${documentsPath}/${encodeURIComponent(id)}/artifact`, { expectedAccountId: accountId });
  if (artifact.type !== "application/vnd.openxmlformats-officedocument.wordprocessingml.document") return artifact;
  const { repairStoredWordProperties } = await import("./native-document");
  try { return await repairStoredWordProperties(artifact); }
  catch { return artifact; } // Preserve access to historical formats the native editor cannot unpack.
}

export const renderGeneratedPdf = (accountId: string, id: string) =>
  apiBlob(`${documentsPath}/${encodeURIComponent(id)}/render-pdf`, { method: "POST", expectedAccountId: accountId });

function toEmailResponse(email: EmailDraft | undefined): EmailResponse | undefined {
  if (!email) return;
  const { attachmentFormat, ...fields } = email;
  return { ...fields, attachment_format: attachmentFormat };
}

export async function saveGeneratedDocument(
  accountId: string,
  id: string,
  contractId: string,
  { format, filename, markdown, email }: GeneratedOutput,
  legacy?: { contractName: string; createdAt: string },
) {
  const emailBody = toEmailResponse(email);
  const saved = await api<MetadataResponse>(`${documentsPath}/${encodeURIComponent(id)}`, {
    method: "PUT",
    expectedAccountId: accountId,
    body: {
      contract_id: contractId, format, filename, markdown,
      ...(emailBody && { email: emailBody }),
      ...(legacy && { legacy: { contract_name: legacy.contractName, created_at: legacy.createdAt } }),
    },
  });
  if (saved.id !== id) throw new Error("The saved document did not match the request");
}

export async function listGeneratedDocuments(
  accountId: string,
  query: { page: number; perPage: number; search: string; format: string; period: string; operationId?: string },
  signal?: AbortSignal,
) {
  const params = new URLSearchParams({ page: String(query.page), per_page: String(query.perPage) });
  if (query.search) params.set("q", query.search);
  if (query.format !== "all") params.set("format", query.format);
  if (query.period !== "any") params.set("period", query.period);
  if (query.operationId) params.set("operation_id", query.operationId);
  const response = await api<PageResponse>(`${documentsPath}?${params}`, { expectedAccountId: accountId, signal });
  return { items: response.items.map(metadata), total: response.total };
}

export async function getGeneratedDocument(accountId: string, id: string): Promise<GeneratedDocument> {
  const response = await api<DetailResponse>(`${documentsPath}/${encodeURIComponent(id)}`, { expectedAccountId: accountId });
  let email: EmailDraft | undefined;
  if (response.email) {
    const { attachment_format, ...fields } = response.email;
    email = { ...fields, attachmentFormat: attachment_format };
  }
  return { ...metadata(response), markdown: response.markdown, ...(email && { email }) };
}

export function getGeneratedDocumentStats(accountId: string, signal?: AbortSignal) {
  return api<GeneratedDocumentStats>(`${documentsPath}/stats`, { expectedAccountId: accountId, signal });
}
