import { listCompanies, type Company } from "@/app/configuracion/empresas/companies-api";
import {
  companyFieldLimit,
  companyNotaryField,
  companyProfileLimit,
  companyProfileValue,
  companyValueLimit,
  companyValuesSize,
  companyWitnessField,
  isCompanyContractClauseField,
  isCompanyField,
} from "@/app/configuracion/empresas/company-fields";
import type { Client, Operation } from "@/app/clientes/clients-api";
import { documentTypeFromName, matchDocumentTemplate } from "@/app/clientes/document-template-match";
import { loadOperationDocxTemplates, resolveDocumentTemplate, type LoadedDocumentTemplate } from "@/app/clientes/operation-templates";
import { ApiError } from "@/lib/api";
import { checkGenerationAccess, type Contract } from "./contracts-api";
import {
  buildCompanySnapshot,
  buildContractTemplateFields,
  fileBase,
  getContractCompanyFields,
  isInsuranceIssuerField,
  resolveCompanyAndDerivedValues,
} from "./contract-template-fields";
import {
  documentFieldAliases,
  getDocumentType,
  initialExpedienteDocumentTypes,
  INSURANCE_COMPANY_NAME,
  isInsuranceCompanyName,
  isInsuranceDocumentType,
  type DocumentType,
} from "./document-catalog";
import { caseVehicleKeys, isExpedienteField, missingVehicleMessage, percentageDateKey, resolveExpedienteFields, usesBoldNotarialDate, usesDisbursementData, usesUppercaseDocumentData } from "./expediente-fields";
import { getGeneratedDocument, saveGeneratedArtifact, type DocumentFormat, type GeneratedDocumentMetadata, type GeneratedFormat, type GeneratedOutput } from "./generated-documents-api";
import { hasInsuranceIssuerInContract, NativeDocumentError, prepareNativeDocument, readSalesCommitmentFromContract } from "./native-document";
import { wordsSource } from "./native-field-kinds";
import { validateTemplateField } from "./template-fields";

export type BatchDocumentStatus = "pending" | "active" | "done" | "error";

export type BatchQueueItem = {
  type: DocumentType;
  label: string;
  status: BatchDocumentStatus;
  format?: DocumentFormat;
  message?: string;
};

export type BatchProgress = {
  completed: number;
  total: number;
  phase: "preparing" | "generating" | "complete";
  currentType: DocumentType;
  currentLabel: string;
  items: BatchQueueItem[];
};

export type BatchDocumentFailure = {
  type: DocumentType | null;
  savedDocumentId?: string;
  label: string;
  message: string;
  billingBlocked?: boolean;
};

export type BatchGenerationResult = {
  generated: { type: DocumentType; label: string; filename: string }[];
  failed: BatchDocumentFailure[];
  billingBlocked: boolean;
  stoppedEarly: boolean;
};

function resolveTemplateEntry(
  entries: readonly LoadedDocumentTemplate[],
  accountId: string,
  companyId: string,
  type: DocumentType,
) {
  const matching: Contract[] = [];
  const compatible: Contract[] = [];
  const byId = new Map<string, LoadedDocumentTemplate>();
  for (const entry of entries) {
    byId.set(entry.contract.id, entry);
    const keys = entry.template.native_variables?.map(field => field.key);
    if (!keys) continue;
    const match = matchDocumentTemplate(type, entry.contract.name, keys, entry.contract.catalog_key);
    if (match === "matching") matching.push(entry.contract);
    if (match === "compatible") compatible.push(entry.contract);
  }
  const resolution = resolveDocumentTemplate({ matching, compatible }, accountId, companyId, type);
  if (resolution.kind !== "ready") {
    return resolution.kind === "ambiguous" ? { kind: "ambiguous" as const } : { kind: "missing" as const };
  }
  return { kind: "ready" as const, entry: byId.get(resolution.contract.id)! };
}

function formatErrorMessage(error: unknown, fallback: string) {
  if (error instanceof NativeDocumentError) return error.message;
  if (error instanceof ApiError) {
    if (error.status === 413) return "El documento supera el tamaño máximo del historial.";
    if (error.code === "COMPANY_NOT_FOUND") return "La empresa de este expediente ya no está disponible.";
    if (error.status === 401) return "Tu sesión terminó. Vuelve a iniciar sesión.";
  }
  return fallback;
}

export async function generateInitialExpedienteDocuments(input: {
  accountId: string;
  client: Client;
  operation: Operation;
  preferredFormat: GeneratedFormat;
  requestDisbursementDistribution: (signal: AbortSignal) => Promise<string>;
  retryOnlyTypes?: readonly DocumentType[];
  regenerationDocuments?: readonly GeneratedDocumentMetadata[];
  requestConfirmedBalance?: (signal: AbortSignal) => Promise<{ confirmedBalanceMinor: number; balanceDate: string }>;
  onProgress?: (progress: BatchProgress) => void;
  signal?: AbortSignal;
}): Promise<BatchGenerationResult> {
  const { accountId, client, operation, preferredFormat, retryOnlyTypes, regenerationDocuments, onProgress, signal } = input;
  const targetTypes = retryOnlyTypes?.length
    ? [...retryOnlyTypes]
    : initialExpedienteDocumentTypes({ insurancePaid: operation.insurance_paid === true });
  const controller = new AbortController();
  const requestSignal = signal ?? controller.signal;
  const outputFormat: DocumentFormat = preferredFormat === "docx" ? "docx" : "pdf";

  const generated: BatchGenerationResult["generated"] = [];
  const failed: BatchDocumentFailure[] = [];
  let billingBlocked = false;
  let stoppedEarly = false;

  const [{ items: companies }, loadedTemplates] = await Promise.all([
    listCompanies(accountId, false, requestSignal),
    loadOperationDocxTemplates(accountId, operation.company_id, requestSignal, regenerationDocuments?.map(document => document.contractId)),
  ]);

  const selectedCompany: Company | undefined = companies.find(company => company.id === operation.company_id);
  const potentialIssuers = companies.filter(company =>
    isInsuranceCompanyName(company.values.empresa_razon_social || company.name));
  const issuer = potentialIssuers.length === 1 ? potentialIssuers[0] : undefined;
  const issuerName = issuer && (issuer.values.empresa_razon_social || issuer.name);
  const issuerValues = issuer ? {
    ...issuer.values,
    ...(issuer.values.empresa_representante_nombre?.trim() ? {} : {
      empresa_representante_nombre: companyProfileValue(issuer.values, "empresa_representante_nombre"),
    }),
  } : undefined;

  const resolvedTargets: { type: DocumentType; label: string; entry?: LoadedDocumentTemplate; unavailable?: string; saved?: GeneratedDocumentMetadata }[] = [];
  if (regenerationDocuments) {
    const seen = new Set<string>();
    for (const saved of regenerationDocuments) {
      const key = `${saved.contractId}:${saved.format}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const entry = loadedTemplates.find(item => item.contract.id === saved.contractId);
      const type = getDocumentType(saved.documentType)?.id
        ?? getDocumentType(entry?.contract.catalog_key)?.id
        ?? documentTypeFromName(saved.contractName)?.id;
      const label = `${saved.contractName} (${saved.format === "docx" ? "Word" : saved.format === "pdf" ? "PDF" : "Correo"})`;
      if (!type) {
        failed.push({ type: null, savedDocumentId: saved.id, label, message: "Abre la generación individual para revisar los campos de esta plantilla." });
        continue;
      }
      const unavailable = !entry ? "La plantilla usada para emitir este documento ya no está disponible."
        : operation.insurance_paid && isInsuranceDocumentType(type) ? "El expediente indica que el seguro ya está pagado."
        : undefined;
      resolvedTargets.push({ type, label, entry, unavailable, saved });
    }
  }
  for (const type of regenerationDocuments ? [] : targetTypes) {
    const label = getDocumentType(type)?.label ?? type;
    const resolution = resolveTemplateEntry(loadedTemplates, accountId, operation.company_id, type);
    if (resolution.kind === "missing") continue;
    if (resolution.kind === "ambiguous") {
      resolvedTargets.push({ type, label, unavailable: "Hay varias plantillas compatibles. Selecciona la plantilla desde el expediente." });
      continue;
    }
    resolvedTargets.push({ type, label, entry: resolution.entry });
  }

  const needsDistribution = resolvedTargets.some(({ type, entry, unavailable }) =>
    !unavailable && usesDisbursementData(type) && entry?.template.native_variables?.some(field => field.key === "distribucion_desembolso"));
  const distribution = needsDistribution
    ? await input.requestDisbursementDistribution(requestSignal)
    : undefined;
  const balance = resolvedTargets.some(target => target.type === "carta_saldo" && !target.unavailable)
    ? await input.requestConfirmedBalance?.(requestSignal)
    : undefined;

  let cachedSalesParagraph: string | undefined;
  let salesParagraphError: string | undefined;

  async function resolveSalesParagraph() {
    if (cachedSalesParagraph !== undefined) return cachedSalesParagraph;
    if (salesParagraphError !== undefined) throw new NativeDocumentError(salesParagraphError);

    const salesEntry = operation.contract_id
      ? loadedTemplates.find(entry => entry.contract.id === operation.contract_id)
      : (() => {
        const res = resolveTemplateEntry(loadedTemplates, accountId, operation.company_id, "venta_condicional");
        return res.kind === "ready" ? res.entry : undefined;
      })();

    if (!salesEntry) {
      salesParagraphError = "Carga una plantilla de venta condicional para extraer la cláusula de compromiso del pagaré.";
      throw new NativeDocumentError(salesParagraphError);
    }

    const salesValues = resolveExpedienteFields("venta_condicional", client, operation, {}).values;
    const requiresDate = salesEntry.template.native_variables?.some(field => field.key === percentageDateKey) === true;
    if (requiresDate && !salesValues[percentageDateKey]) {
      salesParagraphError = "Guarda la fecha de firma para calcular el compromiso de pago de la venta.";
      throw new NativeDocumentError(salesParagraphError);
    }

    try {
      cachedSalesParagraph = await readSalesCommitmentFromContract(salesEntry.contract.id, accountId, salesValues,
        salesEntry.contract.catalog_key ? selectedCompany : undefined);
      return cachedSalesParagraph;
    } catch (error) {
      salesParagraphError = error instanceof NativeDocumentError
        ? error.message
        : "No se pudo leer la cláusula de compromiso de la venta condicional.";
      throw new NativeDocumentError(salesParagraphError);
    }
  }

  const total = resolvedTargets.length + failed.length;
  const queue: BatchQueueItem[] = resolvedTargets.map(target => ({
    type: target.type,
    label: target.label,
    status: "pending",
  }));

  function emitProgress(
    completedCount: number,
    phase: BatchProgress["phase"],
    currentType: DocumentType,
    currentLabel: string,
  ) {
    onProgress?.({
      completed: completedCount,
      total,
      phase,
      currentType,
      currentLabel,
      items: queue.map(item => ({ ...item })),
    });
  }

  if (resolvedTargets.length > 0) {
    emitProgress(failed.length, "preparing", resolvedTargets[0].type, resolvedTargets[0].label);
  }

  for (let index = 0; index < resolvedTargets.length; index++) {
    const target = resolvedTargets[index];
    if (requestSignal.aborted) {
      stoppedEarly = true;
      break;
    }

    queue[index] = { ...queue[index], status: "active" };
    emitProgress(generated.length + failed.length, "generating", target.type, target.label);

    if (target.unavailable || !target.entry) {
      const message = target.unavailable ?? "La plantilla no está disponible.";
      failed.push({ type: target.type, savedDocumentId: target.saved?.id, label: target.label, message });
      queue[index] = { ...queue[index], status: "error", message };
      continue;
    }

    const { contract, template } = target.entry;
    const definition = getDocumentType(target.type);
    const isInsuranceDocument = definition?.requiresInsuranceCompany === true;
    const isInsuranceSale = target.type === "venta_condicional_seguro";

    try {
      const { markdown, fields } = buildContractTemplateFields(
        template.content_markdown,
        template.native_variables ?? null,
        target.type,
        operation.vehicle,
      );
      const companyFields = getContractCompanyFields(fields, target.type);
      const clauseFields = fields.filter(field => companyNotaryField(field.key) || companyWitnessField(field.key));
      const companyRequired = Boolean(operation.company_id) || companyFields.length > 0 || clauseFields.length > 0;
      if (companyRequired && !selectedCompany) {
        throw new NativeDocumentError("La empresa de este expediente no está disponible.");
      }

      const fieldKeys = fields.map(field => field.key);
      const hasGenericCompanyFields = fieldKeys.some(key => isCompanyField(key) && !isInsuranceIssuerField(key));
      const hasDedicatedIssuerFields = fieldKeys.some(isInsuranceIssuerField);
      const verifyLiteral = isInsuranceDocument && !hasDedicatedIssuerFields && !hasGenericCompanyFields;
      let insuranceCompanyName = issuerName;

      if (isInsuranceDocument && !isInsuranceSale && hasGenericCompanyFields && issuer?.id !== operation.company_id) {
        throw new NativeDocumentError("El Word usa variables generales de empresa para un emisor de seguro distinto.");
      }
      if (verifyLiteral && !insuranceCompanyName) {
        const hasLiteral = await hasInsuranceIssuerInContract(contract.id, accountId);
        if (hasLiteral) insuranceCompanyName = INSURANCE_COMPANY_NAME;
      }

      const salesCommitmentParagraph = target.type === "pagare_autentico"
        ? await resolveSalesParagraph()
        : undefined;

      const resolved = resolveExpedienteFields(target.type, client, operation, {
        ...balance,
        salesCommitmentParagraph,
        insuranceCompanyName,
        insuranceCompanyValues: issuerValues,
      });

      const uppercaseValues = usesUppercaseDocumentData(target.type);
      const values = resolveCompanyAndDerivedValues(
        fields,
        selectedCompany,
        usesDisbursementData(target.type) && distribution !== undefined
          ? { ...resolved.values, distribucion_desembolso: distribution }
          : resolved.values,
        key => isExpedienteField(key, target.type) ||
          (isInsuranceDocument && isInsuranceIssuerField(key)) ||
          (isInsuranceSale && isCompanyField(key) && !isCompanyContractClauseField(key)),
        uppercaseValues,
      );

      const hasDocumentValue = (key: string) => !isInsuranceIssuerField(key) && (
        Boolean(values[key]?.trim()) ||
        documentFieldAliases(key).some(group => group.every(alias => Boolean(values[alias]?.trim())))
      );

      const vehicleGaps = fields.filter(field => caseVehicleKeys.has(field.key) && validateTemplateField(field, values[field.key] ?? ""));
      if (vehicleGaps.length) throw new NativeDocumentError(missingVehicleMessage(vehicleGaps));
      for (const issue of resolved.issues) {
        if (!hasDocumentValue(issue.key)) {
          throw new NativeDocumentError(issue.message);
        }
      }

      for (const field of fields) {
        if (wordsSource(field.key, fields)) continue;
        const value = values[field.key] ?? "";
        const error = validateTemplateField(field, value);
        if (error) {
          if (companyNotaryField(field.key)) {
            throw new NativeDocumentError("Guarda los datos del notario en la configuración de la empresa.");
          }
          if (companyWitnessField(field.key)) {
            throw new NativeDocumentError("Completa los datos de los testigos en la configuración de la empresa.");
          }
          throw new NativeDocumentError(`Falta o es inválido el campo «${field.label}».`);
        }
        if (companyFields.includes(field) && Array.from(value.trim()).length > companyValueLimit) {
          throw new NativeDocumentError(`El valor de «${field.label}» supera el máximo de ${companyValueLimit} caracteres.`);
        }
      }

      const companySnapshot = buildCompanySnapshot(selectedCompany, companyFields, values, uppercaseValues);
      if (companySnapshot && (Object.keys(companySnapshot.values).length > companyFieldLimit || companyValuesSize(companySnapshot.values) > companyProfileLimit)) {
        throw new NativeDocumentError("Los valores de empresa de este documento superan el tamaño permitido.");
      }

      const sourceFormat: DocumentFormat = contract.original_file_name.toLowerCase().endsWith(".docx") ? "docx" : "pdf";
      const email = target.saved?.format === "email"
        ? (await getGeneratedDocument(accountId, target.saved.id)).email
        : undefined;
      if (target.saved?.format === "email" && !email) {
        throw new NativeDocumentError("No se encontraron los datos del borrador de correo anterior.");
      }
      const savedFormat = target.saved?.format;
      const effectiveOutput = email?.attachmentFormat ?? (savedFormat === "email" ? undefined : savedFormat)
        ?? (sourceFormat === "pdf" ? "pdf" : outputFormat);

      await checkGenerationAccess(contract.id, accountId, companySnapshot?.id, operation.id);

      const artifact = await prepareNativeDocument({
        accountId,
        contractId: contract.id,
        companyId: companySnapshot?.id,
        companyProfile: contract.catalog_key ? selectedCompany : undefined,
        operationId: operation.id,
        sourceFormat,
        output: effectiveOutput,
        markdown,
        fields,
        values,
        nativeVariables: template.native_variables ?? null,
        allowIncomplete: false,
        conditionalSale: target.type === "venta_condicional" || isInsuranceSale,
        uppercase: uppercaseValues,
        boldPagareDate: usesBoldNotarialDate(target.type),
        vehicle: operation.vehicle,
      });

      const extension = target.saved?.format === "email" ? "eml" : effectiveOutput;
      const filename = contract.catalog_key === "venta_condicional" || contract.catalog_key === "declaracion_jurada"
        || contract.catalog_key === "levantamiento_oposicion" || contract.catalog_key === "gps" || contract.catalog_key === "acto_seguro"
        || contract.catalog_key === "autorizacion_asegurar_vehiculo" || contract.catalog_key === "acuerdo_seguro"
        || contract.catalog_key === "pagare_autentico" || contract.catalog_key === "pagare_seguro" || !target.saved
        ? `${fileBase(contract.name, contract.catalog_key)}.${extension}` : target.saved.filename;
      const record: GeneratedOutput = {
        format: target.saved?.format ?? effectiveOutput,
        ...(email && { email }),
        filename,
        markdown: "",
        ...(companySnapshot && { company: companySnapshot }),
        operationId: operation.id,
        documentType: target.type,
      };
      requestSignal.throwIfAborted();
      await saveGeneratedArtifact(accountId, crypto.randomUUID(), contract.id, record, artifact);
      generated.push({ type: target.type, label: target.label, filename });
      queue[index] = { ...queue[index], status: "done", format: effectiveOutput };
      emitProgress(generated.length + failed.length, "generating", target.type, target.label);
    } catch (error) {
      if (requestSignal.aborted) {
        stoppedEarly = true;
        break;
      }
      if (error instanceof ApiError && error.code === "PAYMENT_REQUIRED") {
        billingBlocked = true;
        stoppedEarly = true;
        const message = "La generación está pausada para esta empresa por falta de pago.";
        failed.push({ type: target.type, savedDocumentId: target.saved?.id, label: target.label, message, billingBlocked: true });
        queue[index] = { ...queue[index], status: "error", message };
        resolvedTargets.slice(index + 1).forEach((remaining, offset) => {
          const remainingMessage = "Pendiente por bloqueo de facturación de la empresa.";
          failed.push({
            type: remaining.type,
            savedDocumentId: remaining.saved?.id,
            label: remaining.label,
            message: remainingMessage,
            billingBlocked: true,
          });
          queue[index + 1 + offset] = { ...queue[index + 1 + offset], status: "error", message: remainingMessage };
        });
        break;
      }
      if (error instanceof ApiError && error.status === 401) {
        stoppedEarly = true;
        const message = "Tu sesión terminó. Vuelve a iniciar sesión.";
        failed.push({ type: target.type, savedDocumentId: target.saved?.id, label: target.label, message });
        queue[index] = { ...queue[index], status: "error", message };
        resolvedTargets.slice(index + 1).forEach((remaining, offset) => {
          const remainingMessage = "No se generó porque la sesión expiró.";
          failed.push({
            type: remaining.type,
            savedDocumentId: remaining.saved?.id,
            label: remaining.label,
            message: remainingMessage,
          });
          queue[index + 1 + offset] = { ...queue[index + 1 + offset], status: "error", message: remainingMessage };
        });
        break;
      }
      const message = formatErrorMessage(error, `No se pudo generar «${target.label}».`);
      failed.push({
        type: target.type,
        savedDocumentId: target.saved?.id,
        label: target.label,
        message,
      });
      queue[index] = { ...queue[index], status: "error", message };
    }
  }

  emitProgress(
    generated.length + failed.length,
    "complete",
    resolvedTargets.at(-1)?.type ?? "venta_condicional",
    "",
  );

  return { generated, failed, billingBlocked, stoppedEarly };
}
