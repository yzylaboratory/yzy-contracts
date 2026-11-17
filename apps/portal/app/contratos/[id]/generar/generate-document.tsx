"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { expedienteDocumentsHref, expedienteHref } from "@/app/clientes/client-paths";
import { MonthlyPaymentTable } from "@/app/clientes/monthly-payment-table";
import { hasOperationCompanyScope } from "@/app/clientes/operation-templates";
import { conditionalSaleHandwrittenFields, documentFieldAliases, getDocumentType, insuranceScheduleFields, isInsuranceSaleCalculatedField } from "@/app/contratos/document-catalog";
import { matchDocumentTemplate, documentTypeFromName } from "@/app/clientes/document-template-match";
import { buildCompanySnapshot, buildContractTemplateFields, fileBase, getContractCompanyFields } from "@/app/contratos/contract-template-fields";
import { nativeFieldLabel } from "@/app/contratos/native-field-label";
import { caseVehicleKeys, missingVehicleMessage, documentClauseCase, expedienteExtraordinaryPayments, isExpedienteField, isExtraordinaryPaymentField, multilinePaymentFields, percentageDateKey, usesBoldNotarialDate, usesSignatureAsContractDate, usesUppercaseDocumentData } from "@/app/contratos/expediente-fields";
import { applicationAmountLabel, applicationDateLabel, clientContractFields } from "@/components/case-application/case-application";
import { usePortalPreferences } from "@/app/configuracion/preferences-store";
import { companyContractClauseField, companyFieldLimit, companyNotaryField, companyProfileLimit, companyProfileValue, companyValueLimit, companyValuesSize, companyWitnessField, isCompanyContractClauseField, isCompanyField } from "@/app/configuracion/empresas/company-fields";
import { useCompanies } from "@/app/configuracion/empresas/use-companies";
import { syncLegacyGeneratedDocuments } from "@/app/contratos/contracts-store";
import { checkGenerationAccess, type NativeVariable } from "@/app/contratos/contracts-api";
import { formatTemplateValue, validateTemplateField } from "@/app/contratos/template-fields";
import { useContract } from "@/app/contratos/use-contract";
import { saveGeneratedArtifact, type DocumentFormat, type GeneratedFormat, type GeneratedOutput } from "@/app/contratos/generated-documents-api";
import { createEmailDraftBlob, downloadBlob, isEmailAddress } from "@/app/contratos/document-export";
import { DocumentPreviewDialog } from "@/app/contratos/document-preview-dialog";
import { NativeDocumentError, normalizeWordTemplateLine, prepareNativeDocument } from "@/app/contratos/native-document";
import { recordPortalActivity } from "@/lib/activity";
import { ApiError, isActiveAccount } from "@/lib/api";
import { canManageCompanyBilling, usePortalAccess } from "@/lib/portal-access";
import { Button } from "@/components/arc/button/button";
import { Input } from "@/components/arc/input/input";
import SegmentedControl from "@/components/arc/segmented-control/segmented-control";
import { Textarea } from "@/components/arc/textarea/textarea";
import { Accordion } from "@/components/arc/accordion/accordion";
import { sortFieldsBySection, wordsFor, wordsSource } from "@/app/contratos/native-field-kinds";
import { PaymentScheduleField } from "./payment-schedule-field";
import { TemplateFieldControl } from "./template-field-control";

const scheduleGroups = [
  { title: "Cuotas de intereses", keys: { numbers: "cuotas_intereses_numeros", dates: "cuotas_intereses_fechas", amounts: "cuotas_intereses_montos" } },
  { title: "Cuotas del seguro", keys: { numbers: "cuotas_seguro_numeros", dates: "cuotas_seguro_fechas", amounts: "cuotas_seguro_montos" } },
];
const caseDates = new Set(["fecha_firma", percentageDateKey]);
const caseDatesWithContractDate = new Set([...caseDates, "fecha_contrato"]);
const clientContractKeys = new Set<string>(clientContractFields.map(([, , , key]) => key));
const conditionalSaleHandwrittenKeys = new Set<string>(conditionalSaleHandwrittenFields);
const insuranceScheduleKeys = new Set<string>(insuranceScheduleFields);
import { useToastStack } from "@/components/arc/toast-stack/toast-stack";
import { LoadingContent } from "@/components/loading/loading-ui";
import { PortalShell } from "@/components/portal-shell/portal-shell";
import { useProductTour } from "@/components/product-tour/product-tour";
import { DocumentCompanyPicker } from "./document-company-picker";
import { isInsuranceIssuerField, useExpedienteContext, type OperationContext } from "./expediente-context";
import { useOperationContext, type OperationSelection } from "./use-operation-context";
import { GenerateDocumentSkeleton } from "./generate-document-skeleton";
import styles from "./generate-document.module.css";

const formats = [
  { value: "pdf", label: "PDF" },
  { value: "docx", label: "Word" },
];
const formatNames = { pdf: "PDF", docx: "Word", email: "correo" };

export function GenerateDocument({ contractId, selection, invalidSelection }: {
  contractId: string;
  selection: OperationSelection | null;
  invalidSelection: boolean;
}) {
  const { session, state, activeCompany } = usePortalAccess();
  const accountId = state.kind === "ready" && state.identity.role === "member" && state.identity.access === "active" ? state.identity.id : undefined;
  const operation = useOperationContext(selection, invalidSelection, accountId);
  const expediente = operation.kind === "ready" ? operation.data : undefined;
  const { preferences, ready: preferencesReady } = usePortalPreferences();
  const { detail } = useContract(contractId, accountId);
  const contract = detail.kind === "ready" ? detail.contract : undefined;
  const template = detail.kind === "ready" ? detail.template : null;
  const incompatible = Boolean(expediente && contract && template && (
    !hasOperationCompanyScope(contract, expediente.operation.company_id) ||
    !contract.original_file_name.toLowerCase().endsWith(".docx") ||
    !template.native_variables ||
    !matchDocumentTemplate(expediente.type, contract.name, template.native_variables.map(field => field.key), contract.catalog_key)
  ));
  const typeLabel = getDocumentType(selection?.type)?.label;
  const documentPicker = selection && expedienteDocumentsHref(selection.clientId, selection.operationId);

  useEffect(() => {
    if (accountId) void syncLegacyGeneratedDocuments(accountId);
  }, [accountId]);

  return (
    <PortalShell
      currentPage={selection ? "/clientes" : "/contratos"}
      title={typeLabel ?? "Generar documento"}
      backLink={documentPicker ? { href: documentPicker, label: "Volver a los tipos de documento" } : undefined}
      breadcrumb={
        <nav aria-label="Ruta de navegación" className={styles.breadcrumb}>
          <Link href={documentPicker || "/contratos"}>{selection ? "Generar Documento" : "Contratos"}</Link>
          <span aria-hidden="true">/</span>
          <span aria-current="page">{contract?.name ?? "Generar documento"}</span>
        </nav>
      }
    >
      {operation.kind === "error" || operation.kind === "invalid" || incompatible ? (
        <section className={styles.panel} aria-labelledby="expediente-error">
          <h2 id="expediente-error">No se pudo abrir el documento del expediente</h2>
          <p className={styles.failure} role="alert">{incompatible ? "Elige un Word compatible con el tipo de documento y la empresa del expediente." : "message" in operation ? operation.message : "Revisa el expediente seleccionado."}</p>
          {operation.kind === "error" && <Button type="button" variant="secondary" onClick={operation.reload}>Reintentar</Button>}
          <Link href="/clientes" className={styles.returnLink}>Volver a Clientes</Link>
        </section>
      ) : !accountId || !preferencesReady || detail.kind === "loading" || operation.kind === "loading" ? (
        <LoadingContent label={selection ? "Cargando el expediente…" : "Cargando el contrato…"}>
          <GenerateDocumentSkeleton />
        </LoadingContent>
      ) : contract && template ? (
        <DocumentForm
          key={`${accountId}:${contract.id}:${expediente?.operation.id ?? activeCompany?.id ?? "manual"}:${expediente?.type ?? ""}`}
          accountId={accountId}
          expediente={expediente}
          companyScope={contract.company_id ?? null}
          sharedCompanyIds={contract.shared_company_ids ?? null}
          catalogKey={contract.catalog_key}
          contractId={contract.id}
          sourceFormat={contract.original_file_name.toLowerCase().endsWith(".docx") ? "docx" : "pdf"}
          needsSourceConfirmation={!template.native_variables && (!template.created_at || template.created_at !== template.updated_at)}
          title={contract.name}
          content={template.content_markdown}
          nativeVariables={template.native_variables ?? null}
          editHref={!contract.catalog_key && contract.owner_id === accountId ? `/contratos/${contract.id}/editar` : undefined}
          defaultOutput={preferences.defaultFormat}
          copyEmail={preferences.sendCopy ? session?.user.email?.trim() ?? "" : ""}
        />
      ) : (
        <section className={styles.panel} aria-labelledby="missing-contract">
          <h2 id="missing-contract">{contract ? "Este contrato aún no tiene plantilla" : "No encontramos este contrato"}</h2>
          <p className={styles.hint}>{detail.kind === "error" ? detail.message : "Elige un contrato disponible en el listado."}</p>
          <Link href={selection ? "/clientes" : "/contratos"} className={styles.returnLink}>{selection ? "Volver a Clientes" : "Volver a Contratos"}</Link>
        </section>
      )}
    </PortalShell>
  );
}

function DocumentForm({ accountId, expediente, companyScope, sharedCompanyIds, catalogKey, contractId, sourceFormat, needsSourceConfirmation, title, content, nativeVariables, editHref, defaultOutput, copyEmail }: {
  accountId: string;
  expediente?: OperationContext;
  companyScope: string | null;
  sharedCompanyIds: string[] | null;
  catalogKey?: string | null;
  contractId: string;
  sourceFormat: DocumentFormat;
  needsSourceConfirmation: boolean;
  title: string;
  content: string;
  nativeVariables: NativeVariable[] | null;
  editHref: string | undefined;
  defaultOutput: GeneratedFormat;
  copyEmail: string;
}) {
  const router = useRouter();
  const { state: accessState, activeCompany } = usePortalAccess();
  const { advance, run } = useProductTour();
  const tourStep = expediente && run?.route.surface === "generation" &&
    run.route.pathname === `/contratos/${contractId}/generar` ? run.step : undefined;
  const hasBillingAccess = accessState.kind === "ready" && accessState.identity.can_manage_billing === true;
  const { toast } = useToastStack();
  const conditionalSalePlan = expediente?.type === "venta_condicional" ? expediente.operation.financing : undefined;
  const isInsuranceSale = expediente?.type === "venta_condicional_seguro";
  const uppercaseValues = usesUppercaseDocumentData(expediente?.type ?? documentTypeFromName(title)?.id);
  const blankHandwrittenIdentity = expediente?.type === "venta_condicional";
  const { markdown, fields } = useMemo(
    () => buildContractTemplateFields(content, nativeVariables, expediente?.type, expediente?.operation.vehicle),
    [content, expediente?.type, expediente?.operation.vehicle, nativeVariables],
  );
  const { list: companyList, reload: reloadCompanies } = useCompanies(accountId);
  const effectiveCompanyScope = expediente?.operation.company_id ?? companyScope ?? activeCompany?.id;
  const allowedCompanyIds = effectiveCompanyScope
    ? [effectiveCompanyScope].filter(id => !sharedCompanyIds || sharedCompanyIds.includes(id))
    : sharedCompanyIds;
  const isInsuranceDocument = getDocumentType(expediente?.type)?.requiresInsuranceCompany === true;
  const fieldKeys = useMemo(() => fields.map(field => field.key), [fields]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const context = useExpedienteContext({
    expediente, contractId, accountId, companies: companyList, fieldKeys, errors,
    onChange: key => clearError(`expediente-${key}`),
  });
  const companies = allowedCompanyIds && companyList.kind === "ready"
    ? { ...companyList, items: companyList.items.filter(company => allowedCompanyIds.includes(company.id)) }
    : companyList;
  const companyFields = useMemo(
    () => getContractCompanyFields(fields, expediente?.type),
    [expediente?.type, fields],
  );
  const clauseFields = fields.filter(field => companyContractClauseField(field.key));
  const witnessFields = fields.filter(field => companyWitnessField(field.key));
  const companyRequired = Boolean(catalogKey || allowedCompanyIds) || companyFields.length > 0 || clauseFields.length > 0 || witnessFields.length > 0;
  const [companyId, setCompanyId] = useState<string | null>(null);
  const available = companies.kind === "ready" ? companies.items : [];
  const selectedCompany = effectiveCompanyScope
    ? available.find(company => company.id === effectiveCompanyScope)
    : companyId === null && companyRequired
      ? available.find(company => company.is_default) ?? (available.length === 1 ? available[0] : undefined)
      : available.find(company => company.id === companyId);
  const companySettingsHref = selectedCompany && accessState.kind === "ready" && canManageCompanyBilling(accessState.identity, selectedCompany.id)
    ? `/configuracion/empresas?id=${encodeURIComponent(selectedCompany.id)}` : undefined;
  const notaryFields = fields.filter(field => companyNotaryField(field.key));
  const missingNotaryFields = selectedCompany ? notaryFields.filter(field => {
    const notary = companyNotaryField(field.key)!;
    return validateTemplateField(field, companyProfileValue(selectedCompany.values, notary.key));
  }) : [];
  const missingNotary = missingNotaryFields.length > 0;
  const missingWitnesses = selectedCompany ? witnessFields.filter(field => {
    const witness = companyWitnessField(field.key)!;
    return validateTemplateField(field, companyProfileValue(selectedCompany.values, witness.key));
  }) : [];
  const [editedValues, setEditedValues] = useState<Record<string, string>>({});
  const [companyEdits, setCompanyEdits] = useState<{ id: string; values: Record<string, string> } | null>(null);
  const usesCaseExtraordinary = expediente?.type === "venta_condicional" || expediente?.type === "pagare_autentico";
  const usesSignatureForContractDate = usesSignatureAsContractDate(expediente?.type);
  const fixedDates = usesSignatureForContractDate ? caseDatesWithContractDate : caseDates;
  const hasSignatureField = fields.some(field => field.key === "fecha_firma");
  const extraordinary = usesCaseExtraordinary ? expedienteExtraordinaryPayments(expediente.operation) : undefined;
  const paymentPlanHref = usesCaseExtraordinary ? `${expedienteHref(expediente.client.id, expediente.operation.id)}#plan-de-pagos` : undefined;
  const missingClientData = expediente ? clientContractFields.filter(([, , , key]) =>
    fields.some(field => field.key === key) && !context.values[key]?.trim()) : [];
  function contextField(key: string) {
    return Boolean(expediente && (isExpedienteField(key, expediente.type) || isInsuranceDocument && isInsuranceIssuerField(key) ||
      isInsuranceSale && isCompanyField(key) && !isCompanyContractClauseField(key)));
  }

  const reviewFields = fields.filter(field => {
    const { key } = field;
    const notary = companyNotaryField(key);
    if (notary) return Boolean(selectedCompany && companyProfileValue(selectedCompany.values, notary.key).trim() && !missingNotaryFields.includes(field));
    const witness = companyWitnessField(key);
    if (witness) return Boolean(selectedCompany && companyProfileValue(selectedCompany.values, witness.key).trim() && !missingWitnesses.includes(field));
    const clause = companyContractClauseField(key);
    if (clause) {
      const value = companyProfileValue(selectedCompany?.values, key);
      return Boolean(value.trim() && !validateTemplateField(field, value) && companies.kind !== "loading");
    }
    if (!expediente) return false;
    if (usesSignatureForContractDate && key === "fecha_contrato" && hasSignatureField) return false;
    if (usesCaseExtraordinary && isExtraordinaryPaymentField(key)) return false;
    if (context.documentInputs.has(key) && key !== "parrafo_compromiso_pago") return false;
    const prefilled = contextField(key) ? context.values[key]
      : isCompanyField(key) ? companyProfileValue(selectedCompany?.values, key) : undefined;
    return Boolean(prefilled?.trim() && !validateTemplateField(field, prefilled));
  });
  const reviewKeys = new Set(reviewFields.map(field => field.key));
  const derivedWords = useMemo(() => new Map(fields.flatMap(field => {
    const source = wordsSource(field.key, fields);
    return source ? [[field.key, source] as const] : [];
  })), [fields]);
  // Vehicle data comes from the case file; a gap is reported there, never typed on the document.
  const templateVehicleGaps = expediente
    ? fields.filter(field => caseVehicleKeys.has(field.key) && validateTemplateField(field, context.values[field.key] ?? ""))
    : [];
  const vehicleGaps = [...templateVehicleGaps, ...(expediente ? context.issues
    .filter(issue => caseVehicleKeys.has(issue.key) && !templateVehicleGaps.some(field => field.key === issue.key) &&
      !documentFieldAliases(issue.key).some(group => group.every(alias => Boolean(context.values[alias]?.trim()))))
    .map(issue => ({ key: issue.key, label: nativeFieldLabel(issue.key) })) : [])];
  const vehicleIssue = vehicleGaps.length ? { key: "vehiculo", message: missingVehicleMessage(vehicleGaps) } : undefined;
  const missingFields = fields.filter(field => !(expediente && caseVehicleKeys.has(field.key)) &&
    !context.documentInputs.has(field.key) && !reviewKeys.has(field.key) &&
    !companyNotaryField(field.key) &&
    !companyWitnessField(field.key) &&
    !companyContractClauseField(field.key) &&
    !(expediente && fixedDates.has(field.key)) &&
    !(isInsuranceSale && (field.key === "fecha_de_firma" || isInsuranceSaleCalculatedField(field.key))) &&
    !(expediente?.type === "acto_seguro" && insuranceScheduleKeys.has(field.key)) &&
    !(isInsuranceDocument && field.key === "cantidad_cuotas_seguro") &&
    !(expediente && clientContractKeys.has(field.key)) &&
    !(blankHandwrittenIdentity && conditionalSaleHandwrittenKeys.has(field.key)) &&
    !(usesCaseExtraordinary && isExtraordinaryPaymentField(field.key)) &&
    !(isInsuranceDocument && isInsuranceIssuerField(field.key)) && !(isCompanyField(field.key) && companies.kind === "loading") &&
    !derivedWords.has(field.key));
  const missingKeySet = new Set(missingFields.map(field => field.key));
  const schedules = scheduleGroups.filter(group => Object.values(group.keys).every(key => missingKeySet.has(key)));
  const baseValues = useMemo(() => Object.fromEntries(fields.map(({ key, kind }) => {
    const forceUpper = uppercaseValues && kind !== "email";
    const notary = companyNotaryField(key);
    if (notary) return [key, selectedCompany ? documentClauseCase(key, normalizeWordTemplateLine(companyProfileValue(selectedCompany.values, notary.key)), forceUpper) : ""];
    const witness = companyWitnessField(key);
    if (witness) return [key, selectedCompany ? documentClauseCase(key, normalizeWordTemplateLine(companyProfileValue(selectedCompany.values, witness.key)), forceUpper) : ""];
    if (companyContractClauseField(key)) {
      return [key, documentClauseCase(key, normalizeWordTemplateLine(companyProfileValue(selectedCompany?.values, key)), forceUpper)];
    }
    if (usesCaseExtraordinary && isExtraordinaryPaymentField(key)) return [key, context.values[key] ?? ""];
    if (isInsuranceSale && (key === "fecha_de_firma" || isInsuranceSaleCalculatedField(key))) return [key, context.values[key] ?? ""];
    if (expediente?.type === "acto_seguro" && insuranceScheduleKeys.has(key) || isInsuranceDocument && key === "cantidad_cuotas_seguro") {
      return [key, context.values[key] ?? ""];
    }
    if (expediente && (isExpedienteField(key, expediente.type) || isInsuranceDocument && isInsuranceIssuerField(key) ||
      isInsuranceSale && isCompanyField(key) && !isCompanyContractClauseField(key))) {
      return [key, fixedDates.has(key) || clientContractKeys.has(key) || context.documentInputs.has(key) ? context.values[key] ?? "" : editedValues[key] ?? context.values[key] ?? ""];
    }
    if (!isCompanyField(key)) return [key, Object.hasOwn(editedValues, key) ? editedValues[key] : ""];
    if (!selectedCompany) return [key, isCompanyContractClauseField(key) ? companyProfileValue(undefined, key) : ""];
    if (companyEdits?.id === selectedCompany.id && Object.hasOwn(companyEdits.values, key)) {
      return [key, companyEdits.values[key]];
    }
    return [key, documentClauseCase(key, normalizeWordTemplateLine(companyProfileValue(selectedCompany.values, key)), forceUpper)];
  })), [usesCaseExtraordinary, uppercaseValues, companyEdits, context.documentInputs, context.values, editedValues, expediente, fields, fixedDates, isInsuranceDocument, isInsuranceSale, selectedCompany]);
  const values = useMemo(() => {
    const next: Record<string, string> = { ...baseValues };
    for (const [key, source] of derivedWords) {
      if (!next[key]?.trim()) {
        const words = wordsFor(source, baseValues[source.key]);
        next[key] = uppercaseValues ? words.toLocaleUpperCase("es") : words;
      }
    }
    return next;
  }, [baseValues, derivedWords, uppercaseValues]);
  const [emailOpen, setEmailOpen] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [confirmedSource, setConfirmedSource] = useState(false);
  const [recipient, setRecipient] = useState(expediente?.client.email ?? "");
  const [subject, setSubject] = useState(title);
  const [message, setMessage] = useState(`Hola,\n\nAdjunto el contrato “${title}” para su revisión y firma.\n\nQuedo atento a sus comentarios.\n\nSaludos,`);
  const [attachmentFormat, setAttachmentFormat] = useState<DocumentFormat>(sourceFormat === "docx" && defaultOutput === "docx" ? "docx" : "pdf");
  const [busy, setBusy] = useState<GeneratedFormat | "preview" | null>(null);
  const [lastOutput, setLastOutput] = useState<GeneratedFormat | "preview" | null>(null);
  const [notice, setNotice] = useState("");
  const [failure, setFailure] = useState("");
  const [expedienteValidation, setExpedienteValidation] = useState(false);
  const issueSummary = useRef<HTMLUListElement>(null);
  const hasDocumentValue = (key: string) => !isInsuranceIssuerField(key) && (Boolean(values[key]?.trim()) ||
    documentFieldAliases(key).some(group => group.every(alias => Boolean(values[alias]?.trim()))));
  const missingKeys = new Set(missingFields.map(field => field.key));
  const editableIssueKey = (key: string) => missingKeys.has(key) ? key
    : documentFieldAliases(key).flat().find(alias => missingKeys.has(alias) && !values[alias]?.trim());
  const summaryIssues = [...context.issues.filter(issue =>
    (!context.documentInputs.has(issue.key) || issue.key === "parrafo_compromiso_pago") &&
    !(expediente && caseVehicleKeys.has(issue.key)) &&
    !editableIssueKey(issue.key) && !hasDocumentValue(issue.key)), ...(vehicleIssue ? [vehicleIssue] : [])];
  const compactTourFields = expediente?.type === "carta_saldo" && !needsSourceConfirmation &&
    (companies.kind === "loading" || Boolean(selectedCompany)) && summaryIssues.length === 0 &&
    fields.every(field => context.documentInputs.has(field.key) ||
      (isExpedienteField(field.key, expediente.type) && !validateTemplateField(field, values[field.key])));
  const [paymentRequired, setPaymentRequired] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const recipientRef = useRef<HTMLInputElement>(null);
  const companyTrigger = useRef<HTMLButtonElement>(null);
  const inProgress = useRef(false);
  const pendingSave = useRef(new Map<string, { id: string; artifact: Blob }>());
  const previewArtifact = useRef<{ key: string; artifact: Blob } | null>(null);
  const previewTrigger = useRef<HTMLButtonElement>(null);
  const mounted = useRef(false);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useLayoutEffect(() => {
    if (emailOpen) recipientRef.current?.focus();
  }, [emailOpen]);
  useEffect(() => {
    if (previewUrl) return () => URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);
  const base = fileBase(title);
  const attachmentName = `${base}.${attachmentFormat}`;
  const cc = isEmailAddress(copyEmail) && copyEmail.toLowerCase() !== recipient.trim().toLowerCase()
    ? copyEmail
    : undefined;
  const operationId = expediente?.operation.id;
  const effectiveOutput = sourceFormat === "pdf" && defaultOutput === "docx" ? "pdf" : defaultOutput;

  function clearError(name: string) {
    if (errors[name]) setErrors(current => ({ ...current, [name]: "" }));
  }

  function selectCompany(id: string) {
    setCompanyId(id);
    setCompanyEdits(null);
    setErrors(current => {
      const next = { ...current };
      delete next.company;
      for (const field of companyFields) delete next[`contract-${field.key}`];
      return next;
    });
    setFailure("");
    setPaymentRequired(false);
  }

  function changeValue(key: string, value: string) {
    if (isCompanyField(key) && !contextField(key)) {
      if (!selectedCompany) return;
      const id = selectedCompany.id;
      setCompanyEdits(current => ({ id, values: { ...(current?.id === id && current.values), [key]: value } }));
    } else {
      setEditedValues(current => ({ ...current, [key]: value }));
    }
    clearError(`contract-${key}`);
  }

  function validateDocument(output: GeneratedFormat) {
    const nextErrors: Record<string, string> = {};
    setExpedienteValidation(true);
    if (vehicleIssue) nextErrors.vehiculo = vehicleIssue.message;
    for (const issue of context.issues) {
      if (!context.documentInputs.has(issue.key) && hasDocumentValue(issue.key)) continue;
      if (expediente && caseVehicleKeys.has(issue.key)) continue;
      nextErrors[context.documentInputs.has(issue.key) ? `expediente-${issue.key}` : `contract-${editableIssueKey(issue.key) ?? issue.key}`] = issue.message;
    }
    if (companyRequired && !selectedCompany) {
      nextErrors.company = companies.kind === "loading" ? "Espera a que se carguen las empresas." : "Selecciona una empresa para continuar.";
    }
    if (missingWitnesses.length) nextErrors.witnesses = "Completa los datos de los testigos en la configuración de la empresa.";
    if (missingNotary) nextErrors.notary = "Guarda los datos del notario en la configuración de la empresa.";
    for (const [, label, , key] of missingClientData) nextErrors[`contract-${key}`] = `Completa ${label.toLowerCase()} en los datos del cliente.`;
    if (usesCaseExtraordinary) {
      if (!extraordinary) nextErrors.extraordinary = "Guarda la fecha de firma y el plan de pagos del expediente para calcular los abonos.";
      else if (extraordinary.some(payment => payment.amount_minor <= 0)) nextErrors.extraordinary = "Completa los montos pendientes en el plan de pagos del expediente.";
      else if (fields.some(field => isExtraordinaryPaymentField(field.key) && !values[field.key])) nextErrors.extraordinary = "La plantilla requiere más abonos. Revisa el plan de pagos y el plazo del expediente.";
    }
    for (const field of fields) {
      if (derivedWords.has(field.key)) continue;
      if (expediente && caseVehicleKeys.has(field.key)) continue;
      const value = values[field.key];
      const error = validateTemplateField(field, value);
      const errorKey = context.documentInputs.has(field.key) ? `expediente-${field.key}` : `contract-${field.key}`;
      if (error) nextErrors[errorKey] ??= error;
      else if (companyFields.includes(field) && Array.from(value.trim()).length > companyValueLimit) {
        nextErrors[`contract-${field.key}`] = `Escribe hasta ${companyValueLimit} caracteres.`;
      }
    }
    if (needsSourceConfirmation && !confirmedSource) nextErrors.confirmedSource = "Confirma que quieres usar las cláusulas del archivo original.";
    if (output === "email") {
      const to = recipient.trim();
      if (!isEmailAddress(to)) {
        nextErrors.to = "Escribe una dirección de correo válida.";
      }
      if (!subject.trim()) nextErrors.subject = "Escribe el asunto.";
      if (!message.trim()) nextErrors.message = "Escribe el mensaje.";
    }
    setErrors(nextErrors);

    const invalidContext = [...context.documentInputs].map(key => `expediente-${key}`).find(key => nextErrors[key]);
    const firstInvalid = invalidContext ?? Object.keys(nextErrors)[0];
    if (!firstInvalid) return true;
    const control = firstInvalid === "notary" ? document.getElementById("company-notary")
      : firstInvalid === "witnesses" ? document.getElementById("company-witnesses")
      : firstInvalid === "extraordinary" ? document.getElementById("extraordinary-plan-link")
      : firstInvalid === "company" ? companyTrigger.current
      : firstInvalid === "expediente-empresa_seguro_nombre" ? context.issuerTrigger.current
      : formRef.current?.elements.namedItem(firstInvalid);
    if (control instanceof HTMLElement && !control.matches(":disabled")) control.focus();
    else requestAnimationFrame(() => issueSummary.current?.focus());
    return false;
  }

  function reviewTourFields() {
    if (busy !== null || context.waiting || companies.kind === "loading") return;
    advance("document-fields-confirmed");
  }

  async function generate(output: GeneratedFormat | "preview") {
    if (inProgress.current || context.waiting || companies.kind === "loading" || tourStep === "document-fields" ||
      (tourStep === "preview" && output !== "preview")) return;
    setLastOutput(output);
    setNotice("");
    setFailure("");
    setPaymentRequired(false);
    if (output !== "preview" && !validateDocument(output)) return;

    inProgress.current = true;
    setBusy(output);
    let recording = false;
    try {
      const nativeFormat = output === "email" ? attachmentFormat : output === "preview" ? "pdf" : output;
      const company: GeneratedOutput["company"] = buildCompanySnapshot(selectedCompany, companyFields, values, uppercaseValues);
      if (company && (Object.keys(company.values).length > companyFieldLimit || companyValuesSize(company.values) > companyProfileLimit)) {
        throw new NativeDocumentError("Los valores de empresa de este documento superan el tamaño permitido. Reduce los campos más largos.");
      }
      if (catalogKey && !selectedCompany) throw new NativeDocumentError("Selecciona una empresa para preparar el documento.");
      const companyProfile = catalogKey && selectedCompany ? { name: selectedCompany.name, values: selectedCompany.values } : undefined;
      const artifactKey = JSON.stringify([nativeFormat, values, company, companyProfile, operationId]);
      await checkGenerationAccess(contractId, accountId, company?.id, operationId);
      const docType = expediente?.type ?? documentTypeFromName(title)?.id;
      const boldPagareDate = usesBoldNotarialDate(docType) || /^\s*pagar[eé]\b/i.test(title);
      const prepare = () => prepareNativeDocument({ accountId, contractId, companyId: company?.id, companyProfile, operationId, sourceFormat, output: nativeFormat, markdown, fields, values, nativeVariables, allowIncomplete: output === "preview", conditionalSale: expediente?.type === "venta_condicional" || isInsuranceSale, uppercase: uppercaseValues, boldPagareDate, vehicle: expediente?.operation.vehicle });
      if (output === "preview") {
        const artifact = previewArtifact.current?.key === artifactKey ? previewArtifact.current.artifact : await prepare();
        if (!await isActiveAccount(accountId) || !mounted.current) return;
        previewArtifact.current = { key: artifactKey, artifact };
        previewTrigger.current?.focus();
        setPreviewUrl(URL.createObjectURL(artifact));
        return;
      }

      const filename = `${base}.${output === "email" ? "eml" : output}`;
      const email: GeneratedOutput["email"] = output === "email"
        ? { to: recipient.trim(), ...(cc && { cc }), subject: subject.trim(), message, attachmentFormat }
        : undefined;
      const record = { format: output, filename, markdown: "", ...(email && { email }), ...(company && { company }), ...(expediente && { operationId: expediente.operation.id, documentType: expediente.type }) };
      const payload = JSON.stringify([artifactKey, record]);
      let pending = pendingSave.current.get(payload);
      if (!pending) {
        const artifact = await prepare();
        pending = { id: crypto.randomUUID(), artifact };
        pendingSave.current.set(payload, pending);
      }
      const blob = email ? await createEmailDraftBlob({ ...email, attachment: pending.artifact, attachmentName }) : pending.artifact;
      if (!await isActiveAccount(accountId) || !mounted.current) return;
      recording = true;
      await saveGeneratedArtifact(accountId, pending.id, contractId, record, pending.artifact);
      recording = false;

      if (!await isActiveAccount(accountId) || !mounted.current) return;
      downloadBlob(blob, filename);
      pendingSave.current.delete(payload);
      setNotice(`Descarga solicitada. ${filename}`);
      toast({
        type: "success",
        title: output === "email" ? "Borrador de correo preparado" : "Documento generado",
        description: filename,
      });
      if (expediente) {
        advance("document-exported");
        router.replace(expedienteDocumentsHref(expediente.client.id, expediente.operation.id));
      }
    } catch (error) {
      if (mounted.current) {
        if (error instanceof ApiError && error.code === "PAYMENT_REQUIRED") {
          setPaymentRequired(true);
        } else if (error instanceof NativeDocumentError) {
          setFailure(error.message);
        } else if (error instanceof ApiError && error.status === 413) {
          setFailure("El documento supera el tamaño máximo del historial. Reduce su contenido y vuelve a intentarlo.");
        } else if (error instanceof ApiError && error.code === "COMPANY_NOT_FOUND") {
          setFailure(expediente ? "La empresa de este expediente ya no está disponible." : "La empresa ya no está disponible. Selecciona otra empresa para generar el documento.");
          reloadCompanies();
        } else {
          setFailure(recording
            ? "No se pudo guardar el documento en el historial. Vuelve a intentarlo."
            : "No se pudo preparar el archivo. Vuelve a intentarlo.");
        }
      }
    } finally {
      inProgress.current = false;
      if (mounted.current) setBusy(null);
    }
  }

  const reviewAction = tourStep === "document-fields" && (
    <div className={styles.reviewAction}>
      <Button type="button" disabled={busy !== null || context.waiting || companies.kind === "loading"} onClick={reviewTourFields}>
        Continuar a vista previa
      </Button>
    </div>
  );

  function renderFeedback(forEmail: boolean) {
    const current = (lastOutput === "email") === forEmail;
    return <div className={styles.feedback}>
      <p className={styles.status} role="status">{current ? notice : ""}</p>
      <p role="alert" className={styles.failure}>{current ? failure : ""}</p>
      {current && paymentRequired && <p className={styles.failure} role="alert">
        La generación está pausada para esta empresa por falta de pago. {hasBillingAccess
          ? <Link href="/facturacion" className={styles.returnLink}>Ir a Facturación</Link>
          : "Contacta al responsable de facturación."}
      </p>}
    </div>;
  }

  return (
    <form
      ref={formRef}
      className={styles.form}
      noValidate
      onSubmit={event => event.preventDefault()}
    >
      <div className={styles.top}>
        <section className={`${styles.panel} ${styles.dataPanel}`} aria-labelledby="contract-data"
          data-tour={expediente && !compactTourFields ? "document-fields" : undefined}>
          <h2 id="contract-data">Datos del contrato</h2>
          <fieldset className={styles.dataFields} disabled={busy !== null} aria-label="Datos del contrato">
            <DocumentCompanyPicker
              list={companies} selectedId={selectedCompany?.id} required={companyRequired} fixed={Boolean(effectiveCompanyScope)} busy={busy !== null}
              error={errors.company} trigger={companyTrigger} onSelect={selectCompany} onRetry={reloadCompanies}
            />
            {reviewFields.length > 0 && <Accordion defaultOpen={-1} items={[{
              title: `Datos registrados (${reviewFields.length})`,
              content: <dl className={styles.reviewValues}>{reviewFields.map(field => {
                const value = documentClauseCase(field.key, formatTemplateValue(field, values[field.key]), uppercaseValues && field.kind !== "email");
                return <div key={field.key} data-long={value.length > 48 ? "" : undefined}>
                  <dt>{usesSignatureForContractDate && field.key === "fecha_contrato" ? "Fecha de firma" : field.label}</dt><dd>{value}</dd>
                </div>;
              })}</dl>,
            }]} />}
            {context.renderControls(compactTourFields, compactTourFields && reviewAction, busy !== null)}
            {missingWitnesses.length > 0 && <div id="company-witnesses" tabIndex={-1} className={styles.hint}>
              {companySettingsHref ? <Link href={`${companySettingsHref}#testigos`} className={styles.returnLink}>Configurar testigos de la empresa</Link>
                : <p>Pide al responsable de la empresa que complete los testigos en Configuración.</p>}
              <p>{missingWitnesses.map(field => field.label).join(", ")}</p>
              {errors.witnesses && <p className={styles.failure} role="alert">{errors.witnesses}</p>}
            </div>}
            {missingNotary && <div id="company-notary" tabIndex={-1} className={styles.hint}>
              {companySettingsHref ? <Link href={`${companySettingsHref}#notario`} className={styles.returnLink}>Configurar notario de la empresa</Link>
                : <p>Pide al responsable de la empresa que registre el notario en Configuración.</p>}
              <p>{missingNotaryFields.map(field => field.label).join(", ")}</p>
              {errors.notary && <p className={styles.failure} role="alert">{errors.notary}</p>}
            </div>}
            {expediente && missingClientData.length > 0 && <p className={styles.hint}>
              <Link href={`${expedienteHref(expediente.client.id, expediente.operation.id)}#datos-del-cliente`} className={styles.returnLink}>Completar datos del cliente en el expediente</Link>
              {" · "}{missingClientData.map(([, label]) => label).join(", ")}
            </p>}
            {conditionalSalePlan?.monthly_plan && <MonthlyPaymentTable plan={conditionalSalePlan} />}
            {paymentPlanHref && <section className={styles.fieldSection} aria-labelledby="extraordinary-payments-title">
              <h3 id="extraordinary-payments-title">Abonos extraordinarios</h3>
              {!extraordinary ? <p className={styles.hint}>Guarda la fecha de firma y el plan de pagos para calcular los abonos.</p>
                : extraordinary.length === 0 ? <p className={styles.hint}>El plazo no incluye abonos extraordinarios.</p>
                : <dl className={styles.reviewValues}>{extraordinary.map(({ date, amount_minor }) => <div key={date}>
                  <dt><time dateTime={date}>{applicationDateLabel(date)}</time></dt>
                  <dd>{amount_minor > 0 ? applicationAmountLabel(amount_minor) : "Monto pendiente"}</dd>
                </div>)}</dl>}
              <Link id="extraordinary-plan-link" href={paymentPlanHref} className={styles.returnLink}>Ir al plan de pagos del expediente</Link>
              {errors.extraordinary && <p className={styles.failure} role="alert">{errors.extraordinary}</p>}
            </section>}
            {expedienteValidation && summaryIssues.length > 0 && <ul ref={issueSummary} className={styles.expedienteIssues} role="alert" tabIndex={-1}>
              {summaryIssues.map(issue => <li key={issue.key}>{issue.message}</li>)}
            </ul>}
            {missingFields.length > 0 ? (
              <div className={styles.fieldSections}>
                {sortFieldsBySection(missingFields).map(group => <section key={group.section} className={styles.fieldSection}
                  data-section={group.section} aria-labelledby={`fields-${group.section}`}>
                  <h3 id={`fields-${group.section}`}>{group.title}</h3>
                  <div className={styles.fields}>
                    {group.fields.map(field => {
                      const schedule = schedules.find(item => Object.values(item.keys).includes(field.key));
                      if (schedule) return schedule.keys.numbers === field.key || !missingKeySet.has(schedule.keys.numbers)
                        ? <div key={field.key} className={styles.field} data-width="wide">
                            <PaymentScheduleField title={schedule.title} keys={schedule.keys} values={values} disabled={busy !== null}
                              error={Object.values(schedule.keys).map(key => errors[`contract-${key}`]).find(Boolean)} onChange={changeValue} />
                          </div>
                        : null;
                      const name = `contract-${field.key}`;
                      const multiline = field.key === "parrafo_compromiso_pago" || multilinePaymentFields.has(field.key);
                      return (
                        <div key={field.key} className={styles.field} data-width={multiline ? "wide" : undefined}>
                          <TemplateFieldControl field={field} name={name} value={values[field.key]} error={errors[name]}
                            disabled={companyFields.includes(field) && (!selectedCompany || busy !== null)}
                            multiline={multiline} onChange={value => changeValue(field.key, value)} />
                        </div>
                      );
                    })}
                  </div>
                </section>)}
              </div>
            ) : fields.length === 0 && (
              <p className={styles.hint}>Este modelo todavía no tiene campos. Puedes usar el archivo original{editHref && <> o <Link href={editHref} className={styles.returnLink}>configurar campos en el editor</Link></>}.</p>
            )}
            {!expediente && <p className={styles.hint}>{nativeVariables
              ? "Cada valor se aplica a todas las apariciones de su variable en el Word original."
              : "La salida conserva el diseño del original y aplica los campos vinculados. Incorpora los cambios de cláusulas al archivo fuente antes de generar."}</p>}
            {needsSourceConfirmation && <label className={styles.sourceConfirmation}>
              <input
                type="checkbox" name="confirmedSource" checked={confirmedSource} required
                aria-invalid={errors.confirmedSource ? true : undefined}
                aria-describedby={errors.confirmedSource ? "source-confirmation-error" : undefined}
                onChange={event => {
                  setConfirmedSource(event.target.checked);
                  clearError("confirmedSource");
                }}
              />
              Confirmo que quiero usar las cláusulas del archivo original.
            </label>}
            {errors.confirmedSource && <p className={styles.failure} id="source-confirmation-error" role="alert">{errors.confirmedSource}</p>}
            {!expediente && fields.length > 0 && editHref && <Link href={editHref} className={styles.returnLink}>{nativeVariables ? "Revisar variables de Word" : "Revisar vínculos de campos"}</Link>}
            {!compactTourFields && reviewAction}
          </fieldset>
        </section>

      </div>

      <section id="email-draft" className={styles.panel} aria-labelledby="email-draft-title" hidden={!emailOpen}>
        <h2 id="email-draft-title">Borrador de correo</h2>
        <fieldset className={styles.emailGrid} disabled={busy !== null} aria-label="Datos del borrador">
          <div className={styles.emailFields}>
            <Input
              ref={recipientRef}
              type="email"
              label="Para"
              name="to"
              placeholder="nombre@correo.com…"
              autoComplete="off"
              spellCheck={false}
              value={recipient}
              error={errors.to}
              onChange={event => {
                setRecipient(event.target.value);
                clearError("to");
              }}
              className={styles.control}
            />
            <Input
              label="Asunto"
              name="subject"
              maxLength={998}
              autoComplete="off"
              value={subject}
              error={errors.subject}
              onChange={event => {
                setSubject(event.target.value);
                clearError("subject");
              }}
              className={styles.control}
            />
            <Textarea
              label="Mensaje"
              name="message"
              maxLength={12000}
              autoComplete="off"
              tabIndex={0}
              rows={6}
              value={message}
              error={errors.message}
              onChange={event => {
                setMessage(event.target.value);
                clearError("message");
              }}
              className={styles.control}
            />
            <div className={styles.attachmentFormat}>
              <p className={styles.smallLabel}>Adjuntar como</p>
              <SegmentedControl
                label="Adjuntar como"
                options={sourceFormat === "docx" ? formats : formats.slice(0, 1)}
                value={attachmentFormat}
                onValueChange={format => setAttachmentFormat(format === "docx" ? "docx" : "pdf")}
              />
            </div>
          </div>

          <div className={styles.emailPreview}>
            <h3 className={styles.smallLabel}>Vista previa del correo</h3>
            <div className={styles.envelope}>
              <dl className={styles.envelopeHeader}>
                <div><dt>Para</dt><dd>{recipient.trim() || "Por definir"}</dd></div>
                {cc && <div><dt>Cc</dt><dd>{cc}</dd></div>}
                <div><dt>Asunto</dt><dd>{subject.trim() || "Sin asunto"}</dd></div>
              </dl>
              <div className={styles.envelopeBody}>
                <p>{message.trim() ? message : "Escribe el mensaje del correo."}</p>
                <div className={styles.attachment}>
                  <span data-format={attachmentFormat}>{attachmentFormat === "pdf" ? "PDF" : "Word"}</span>
                  {attachmentName}
                </div>
              </div>
            </div>
          </div>
        </fieldset>

        <div className={styles.emailActions}>
          <p className={styles.hint}>Envía el borrador desde tu aplicación de correo después de descargarlo.</p>
            <Button type="button" className={styles.primary} loading={busy === "email"} disabled={(busy !== null && busy !== "email") || context.waiting || companies.kind === "loading"} onClick={() => void generate("email")}>Descargar borrador</Button>
        </div>
        {renderFeedback(true)}
      </section>

      <section className={styles.actionBar} aria-labelledby="document-format">
        {renderFeedback(false)}
        <div className={styles.actionRow}>
          <div className={styles.actionCopy}>
            <h2 id="document-format">Generar documento</h2>
            <p className={styles.hint}>Predeterminado: {formatNames[effectiveOutput]}</p>
          </div>
          <div className={styles.actionButtons}>
            <Button ref={previewTrigger} type="button" variant="ghost" aria-haspopup="dialog" data-tour={expediente ? "document-preview" : undefined}
              loading={busy === "preview"} disabled={(busy !== null && busy !== "preview") || context.waiting || companies.kind === "loading"} onClick={() => void generate("preview")}>
              Vista previa
            </Button>
            <Button type="button" variant="ghost" aria-expanded={emailOpen}
              aria-controls="email-draft" disabled={busy !== null} onClick={() => setEmailOpen(open => !open)}>
              Borrador de correo
            </Button>
            <div className={styles.downloadFormats} data-tour={expediente ? "document-export" : undefined}>
              {sourceFormat === "docx" && <Button type="button" variant="secondary" className={styles.word} loading={busy === "docx"} disabled={(busy !== null && busy !== "docx") || context.waiting || companies.kind === "loading"}
                onClick={() => void generate("docx")}>Word</Button>}
              <Button type="button" variant="secondary" className={styles.pdf} loading={busy === "pdf"} disabled={(busy !== null && busy !== "pdf") || context.waiting || companies.kind === "loading"} onClick={() => void generate("pdf")}>PDF</Button>
            </div>
          </div>
        </div>
      </section>

      {previewUrl && (
        <DocumentPreviewDialog
          pdfUrl={previewUrl}
          documentName={title}
          onOpen={() => {
            if (accessState.kind === "ready" && accessState.identity.id === accountId) {
              recordPortalActivity(accountId, "document_previewed", "document_generate");
            }
          }}
          onClose={() => {
            setPreviewUrl(null);
            previewTrigger.current?.focus();
            if (expediente) advance("preview-closed");
          }}
        />
      )}
    </form>
  );
}
