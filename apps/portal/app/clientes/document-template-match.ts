import { DOCUMENT_TYPES, hasDocumentTemplateFields, type DocumentType } from "../contratos/document-catalog";

function normalizeDocumentName(value: string) {
  return value.replace(/\.docx$/i, "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function documentTypeFromName(name: string) {
  const normalized = normalizeDocumentName(name);
  if (normalized === "venta condicional de vehiculo con financiamiento de seguro" || normalized === "venta condicional del seguro") {
    return DOCUMENT_TYPES.find(document => document.id === "venta_condicional_seguro");
  }
  if (normalized === "levantamiento de oposicion") {
    return DOCUMENT_TYPES.find(document => document.id === "levantamiento_oposicion");
  }
  if (
    normalized === "autorizacion para asegurar vehiculo" ||
    normalized === "carta de autorizacion para asegurar vehiculo" ||
    normalized === "autorizacion para asegurar el vehiculo"
  ) {
    return DOCUMENT_TYPES.find(document => document.id === "autorizacion_asegurar_vehiculo");
  }
  return DOCUMENT_TYPES.find(document =>
    normalizeDocumentName(document.label) === normalized || normalizeDocumentName(document.id) === normalized);
}

export function matchDocumentTemplate(type: DocumentType, name: string, keys: readonly string[], catalogKey?: string | null) {
  if (catalogKey) return catalogKey === type && hasDocumentTemplateFields(type, keys) ? "matching" : undefined;
  const namedType = documentTypeFromName(name);
  if (namedType && namedType.id !== type) return;
  if (!hasDocumentTemplateFields(type, keys)) return;
  if (namedType || DOCUMENT_TYPES.filter(document => hasDocumentTemplateFields(document.id, keys)).length === 1) return "matching";
  return "compatible";
}
