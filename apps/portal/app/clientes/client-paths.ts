import type { DocumentType } from "@/app/contratos/document-catalog";
import type { Operation } from "./clients-api";

const contractDates = new Intl.DateTimeFormat("es-DO", { dateStyle: "medium", timeZone: "UTC" });

export function clientsHref(page?: number, newExpediente = false) {
  const params = new URLSearchParams();
  if (page !== undefined) params.set("page", String(page));
  if (newExpediente) params.set("nuevo", "1");
  return params.size ? `/clientes?${params}` : "/clientes";
}

export function clientDirectoryHref(page?: number, create = false) {
  const params = new URLSearchParams();
  if (page !== undefined) params.set("page", String(page));
  if (create) params.set("nuevo", "1");
  return params.size ? `/directorio-clientes?${params}` : "/directorio-clientes";
}

export function clientDirectoryRecordHref(clientId: string) {
  return `/directorio-clientes/${encodeURIComponent(clientId)}`;
}

export function clientHref(clientId: string) {
  return `/clientes/${encodeURIComponent(clientId)}`;
}

export function newClientExpedienteHref(clientId: string) {
  return `${clientHref(clientId)}?nuevo=1`;
}

export function expedienteHref(clientId: string, expedienteId: string) {
  return `${clientHref(clientId)}?${new URLSearchParams({ expediente: expedienteId })}`;
}

export function expedienteDocumentsHref(clientId: string, expedienteId: string) {
  return `${clientHref(clientId)}/generar?${new URLSearchParams({ expediente: expedienteId })}`;
}

export function expedienteDetails(operation: Pick<Operation, "id" | "reference" | "contract_date" | "vehicle">) {
  const { registration_number, plate, make, model } = operation.vehicle;
  const vehicle = [make, model, plate ?? registration_number].filter(Boolean).join(" · ");
  const date = operation.contract_date && contractDates.format(new Date(`${operation.contract_date}T00:00:00Z`));
  const label = operation.reference || vehicle || `Expediente ${operation.id.slice(0, 8).toUpperCase()}`;
  return { label, vehicle, date };
}

export function generateFromOperationHref(contractId: string, companyId: string, clientId: string, operationId: string, documentType: DocumentType) {
  const params = new URLSearchParams({ company_id: companyId, client_id: clientId, operation_id: operationId, document_type: documentType });
  return `/contratos/${encodeURIComponent(contractId)}/generar?${params}`;
}

export function isRecordId(value: string | undefined): value is string {
  return Boolean(value && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value));
}
