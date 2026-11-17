"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, FileText, FileType2 } from "lucide-react";
import { Alert } from "@/components/arc/alert/alert";
import { Button } from "@/components/arc/button/button";
import { Input } from "@/components/arc/input/input";
import { Select } from "@/components/arc/select/select";
import { useToastStack } from "@/components/arc/toast-stack/toast-stack";
import { applicationAmountLabel, applicationDateLabel } from "@/components/case-application/case-application";
import { usePortalPreferences } from "@/app/configuracion/preferences-store";
import type { GeneratedFormat } from "@/app/contratos/generated-documents-api";
import { generateInitialExpedienteDocuments, type BatchGenerationResult, type BatchProgress } from "@/app/contratos/batch-document-generation";
import { MoneyField, typeMoney } from "@/app/contratos/money-field";
import { moneyMinor } from "@/app/contratos/native-field-kinds";
import { paymentDateAfterMonths } from "@/app/contratos/expediente-fields";
import { isActiveAccount } from "@/lib/api";
import { canManageCompanyBilling, usePortalAccess } from "@/lib/portal-access";
import { CaseIntakeSteps } from "./case-intake-steps";
import { amountInputValue, formatMoneyInput, parseAmountMinor } from "./amount-input";
import { clientErrorMessage, saveOperation, type Client, type Financing, type Operation, type OperationPatch, type OperationStatus, type Vehicle } from "./clients-api";
import { clientScope, markClientDirectoryUpdated, useClientDraft, useClientSave } from "./client-navigation";
import { ExpedienteGenerationStage } from "./expediente-generation-stage";
import { isOperationStatus, operationStatusOptions } from "./expediente-status";
import { IntakePaymentPlanStep } from "./intake-payment-plan-step";
import { loanApplicationDetails, missingLoanClientFields, missingLoanVehicleFields, vehicleFields } from "./loan-application-fields";
import {
  installmentDraft,
  maxMonthlyInstallments,
  planCalculationOutOfRange,
  planFromInputs,
  validateMonthlyPayments,
  type InstallmentDraft,
} from "./monthly-payment-plan";
import { MonthlyPaymentTable } from "./monthly-payment-table";
import { VehicleFormFields } from "./vehicle-form-fields";
import { billOfLadingFieldLabels, readDocument, registrationFieldLabels, relevantWarnings, vehicleFromBillOfLading, vehicleFromRegistration, type DocumentCategory } from "./document-readings-api";
import { DocumentScan, type ScanOutcome } from "./document-scan";

const vehicleDocuments = [
  { value: "vehicle_registration", label: "Matrícula", uploadLabel: "Sube la matrícula", hint: "Foto o PDF del Certificado de Propiedad de Vehículos de Motor (DGII)." },
  { value: "bill_of_lading", label: "Bill of lading", uploadLabel: "Sube el bill of lading", hint: "PDF o fotos de todas las páginas del conocimiento de embarque." },
] as const;

async function readVehicle(category: DocumentCategory, files: File[], signal: AbortSignal): Promise<{ mismatch: string } | { vehicle: Vehicle; warnings: string[] }> {
  if (category === "bill_of_lading") {
    const reading = await readDocument("bill_of_lading", files, signal);
    if (!reading.matches_category) return { mismatch: "El archivo no parece un bill of lading" };
    const vehicle = vehicleFromBillOfLading(reading.data);
    if (!vehicle) return { mismatch: "El bill of lading no describe ningún vehículo" };
    return { vehicle, warnings: relevantWarnings(reading.warnings, billOfLadingFieldLabels) };
  }
  const reading = await readDocument("vehicle_registration", files, signal);
  if (!reading.matches_category) return { mismatch: "El archivo no parece una matrícula de vehículo" };
  return { vehicle: vehicleFromRegistration(reading.data), warnings: relevantWarnings(reading.warnings, registrationFieldLabels) };
}
import styles from "./clients.module.css";

type LoanDraft = {
  status: OperationStatus;
  date: string;
  amount: string;
  signatureDate: string;
  insurancePaid: boolean;
  insuranceAmount: string;
  insuranceCount: string;
  vehicle: Vehicle;
  installmentAmount: string;
  installmentCount: string;
  installmentRows: InstallmentDraft[];
};
type IntakeStage = "application" | "plan" | "review";

function financingDraft(operation: Operation | undefined, capital: number): Pick<LoanDraft, "installmentAmount" | "installmentCount" | "installmentRows"> {
  const existing = operation?.financing;
  if (!existing) return { installmentAmount: "", installmentCount: "", installmentRows: [] };
  const payments = [...existing.interest_installments, existing.final_principal];
  const amount = existing.interest_installments[0]?.amount_minor
    ?? Math.max(0, existing.final_principal.amount_minor - capital);
  return {
    installmentAmount: amount > 0 ? formatMoneyInput(amount) : "",
    installmentCount: String(payments.length),
    installmentRows: payments.map(installmentDraft),
  };
}

const localDate = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Santo_Domingo", year: "numeric", month: "2-digit", day: "2-digit" });

function amountFieldValue(minor: number | null | undefined) {
  if (minor == null) return "";
  return typeMoney(amountInputValue(minor));
}

function isCalendarDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !value.startsWith("0000");
}

/** Accepts settled values and amounts still being typed (before cents settle on blur). */
function typedMoneyMinor(value: string) {
  const settled = moneyMinor(value);
  if (settled !== null) return settled;
  const digits = value.trim().replace(/^RD\$/, "").replace(/,/g, "");
  if (!/^\d+(?:\.\d{0,2})?$/.test(digits)) return undefined;
  const [whole, fraction = ""] = digits.split(".");
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, "0").slice(0, 2));
  return Number.isSafeInteger(minor) ? minor : undefined;
}

export function LoanApplicationEditor({ accountId, companyId, client, operation, onDirty, onSaved, onCancel, onSelectClient, onCompleteClient }: {
  accountId: string;
  companyId: string;
  client: Client;
  operation?: Operation;
  onDirty: (dirty: boolean) => void;
  onSaved: (operation: Operation, fromThisVisit: boolean) => void;
  onCancel: () => boolean;
  onSelectClient?: () => void;
  onCompleteClient: () => void;
}) {
  const formId = useId();
  const key = `${clientScope(accountId, client.id)}:loan:${operation?.id ?? companyId}`;
  const { save, saving, failure } = useClientSave(key, onDirty, onSaved, clientScope(accountId));
  const { draft, updateDraft, patchDraft, discardDraft } = useClientDraft<LoanDraft>(key, () => {
    const capital = operation?.application?.requested_amount_minor ?? 0;
    return {
      status: operation?.status ?? "solicitud",
      date: operation?.application?.application_date ?? (operation ? "" : localDate.format(new Date())),
      amount: amountFieldValue(operation?.application?.requested_amount_minor),
      signatureDate: operation?.signature_date ?? "",
      insurancePaid: Boolean(operation?.insurance_paid),
      insuranceAmount: amountFieldValue(operation?.insurance_installment_minor),
      insuranceCount: operation?.financing?.insurance_installment_count ? String(operation.financing.insurance_installment_count) : "",
      vehicle: operation?.vehicle ?? {},
      ...financingDraft(operation, capital),
    };
  }, onDirty);
  const { preferences } = usePortalPreferences();
  const { state: accessState } = usePortalAccess();
  const { toast } = useToastStack();
  const billingAccess = accessState.kind === "ready" && canManageCompanyBilling(accessState.identity, companyId);
  const [intakeStage, setIntakeStage] = useState<IntakeStage>("application");
  const [pending, setPending] = useState<OperationPatch>();
  const [amountFocused, setAmountFocused] = useState(false);
  const [insuranceFocused, setInsuranceFocused] = useState(false);
  const [confirmBusy, setConfirmBusy] = useState<"saving" | "generating" | null>(null);
  const [confirmFailure, setConfirmFailure] = useState("");
  const [batchFormat, setBatchFormat] = useState<GeneratedFormat | null>(null);
  const formatSheetRef = useRef<HTMLDialogElement>(null);
  const [createdOperation, setCreatedOperation] = useState<Operation | null>(null);
  const [generationProgress, setGenerationProgress] = useState<BatchProgress | null>(null);
  const [generationResult, setGenerationResult] = useState<BatchGenerationResult | null>(null);
  const [completionOperation, setCompletionOperation] = useState<Operation | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const focusedHash = useRef(false);
  const mounted = useRef(true);
  const batchAbort = useRef<AbortController | null>(null);
  const completionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      batchAbort.current?.abort();
      if (completionTimer.current) {
        clearTimeout(completionTimer.current);
        completionTimer.current = null;
      }
    };
  }, []);
  useEffect(() => {
    if (intakeStage === "application" && operation && !focusedHash.current && typeof window !== "undefined") {
      focusedHash.current = true;
      const hash = window.location.hash;
      if (hash === "#fecha-firma" || hash === "#monto-cuota-seguro") {
        const target = document.getElementById(hash.slice(1))
          ?? (hash === "#monto-cuota-seguro" ? document.getElementById("seguro-saldo") : null);
        if (target) {
          target.focus();
          return;
        }
      }
    }
    heading.current?.focus();
  }, [intakeStage, operation]);

  const requestedAmount = typedMoneyMinor(draft.amount);
  const capital = requestedAmount !== undefined && requestedAmount > 0 ? requestedAmount : 0;
  const hasDate = isCalendarDate(draft.date);
  const hasAmount = requestedAmount !== undefined && requestedAmount > 0;
  const hasSignature = isCalendarDate(draft.signatureDate);
  const signatureOk = operation ? (!draft.signatureDate || hasSignature) : hasSignature;
  const insurancePaid = Boolean(draft.insurancePaid);
  const hasInsuranceInput = draft.insuranceAmount.trim() !== "";
  const insuranceInstallment = !insurancePaid && hasInsuranceInput ? typedMoneyMinor(draft.insuranceAmount) : undefined;
  const insuranceOk = insurancePaid || (insuranceInstallment !== undefined && insuranceInstallment > 0);
  const insuranceCountInput = (draft.insuranceCount ?? "").trim();
  const insuranceCount = !insurancePaid && /^\d{1,3}$/.test(insuranceCountInput) ? Number(insuranceCountInput) : undefined;
  const insuranceCountOk = insurancePaid || (insuranceCount !== undefined && insuranceCount >= 1 && insuranceCount <= maxMonthlyInstallments);
  const clientMissing = missingLoanClientFields(client);
  const vehicleMissing = missingLoanVehicleFields(draft.vehicle);
  const installmentAmount = parseAmountMinor(draft.installmentAmount) ?? 0;
  const installmentCount = /^\d+$/.test(draft.installmentCount) ? Number(draft.installmentCount) : 0;
  const validInstallmentCount = Number.isInteger(installmentCount) && installmentCount >= 1 && installmentCount <= maxMonthlyInstallments;
  const planOutOfRange = planCalculationOutOfRange(draft.signatureDate, capital, draft.installmentAmount, draft.installmentCount);
  const { errors: planErrors, plan: draftPlan, total: planTotal, totalError: planTotalError } = validateMonthlyPayments(
    draft.installmentRows,
    paymentDateAfterMonths(draft.signatureDate, maxMonthlyInstallments),
  );
  const planStarted = Boolean(draft.installmentAmount || draft.installmentCount || draft.installmentRows.length);
  const planOk = !planStarted || (Boolean(draftPlan) && !planTotalError && !planOutOfRange);
  const canContinue = hasDate && hasAmount && signatureOk && insuranceOk && insuranceCountOk && clientMissing.length === 0 && vehicleMissing.length === 0 && planOk;
  const amountError = !amountFocused && draft.amount !== "" && !hasAmount ? "Indica un monto mayor que cero." : undefined;
  const insuranceError = !insurancePaid && !insuranceFocused && hasInsuranceInput && !insuranceOk ? "Indica un monto mayor que cero." : undefined;
  const insuranceMissing = insurancePaid ? [] : [
    ...(insuranceOk ? [] : ["el monto de cada cuota del seguro"]),
    ...(insuranceCountOk ? [] : ["la cantidad de cuotas del seguro"]),
  ];

  function refreshPlan(next: LoanDraft) {
    const nextCapital = typedMoneyMinor(next.amount);
    const capitalValue = nextCapital !== undefined && nextCapital > 0 ? nextCapital : 0;
    const generated = planFromInputs(next.signatureDate, capitalValue, next.installmentAmount, next.installmentCount);
    return { ...next, installmentAmount: generated.amount, installmentCount: generated.count, installmentRows: generated.rows };
  }

  function vehicleBody(): Vehicle {
    const vehicle: Vehicle = {};
    for (const [field] of vehicleFields) {
      const value = draft.vehicle[field]?.trim();
      if (value) vehicle[field] = value;
    }
    return vehicle;
  }

  function applicationBody(): OperationPatch {
    const financing = draftPlan ? {
      ...draftPlan,
      extraordinary_payments: operation?.financing?.extraordinary_payments ?? [],
      insurance_installment_count: insurancePaid ? null : (insuranceCount ?? null),
      extraordinary_from_signature: operation?.financing?.extraordinary_from_signature,
      monthly_plan: operation?.financing?.monthly_plan,
    } : undefined;
    return {
      ...(operation ? { status: draft.status } : {}),
      application: { ...operation?.application, application_date: draft.date, requested_amount_minor: requestedAmount },
      vehicle: vehicleBody(),
      signature_date: draft.signatureDate || null,
      insurance_paid: insurancePaid,
      insurance_installment_minor: insurancePaid ? null : (insuranceInstallment ?? null),
      ...(financing ? { financing } : {}),
    };
  }

  function editInstallment(index: number, update: Partial<InstallmentDraft>) {
    updateDraft({
      ...draft,
      installmentRows: draft.installmentRows.map((row, position) => position === index ? { ...row, ...update } : row),
    });
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canContinue || saving) return;
    const body = applicationBody();
    if (operation) {
      persist(body);
      return;
    }
    setPending(current => {
      const keepFinancing = current?.financing &&
        current.signature_date === body.signature_date &&
        current.application?.requested_amount_minor === body.application?.requested_amount_minor;
      return keepFinancing ? { ...body, financing: current.financing } : body;
    });
    setIntakeStage("plan");
  }

  function continueFromPlan(financing: Financing) {
    if (!pending) return;
    setPending({
      ...pending,
      financing: { ...financing, insurance_installment_count: insurancePaid ? null : (insuranceCount ?? null) },
    });
    setIntakeStage("review");
  }

  function persist(body: OperationPatch) {
    if (operation && !canContinue) return;
    void save(() => saveOperation(accountId, companyId, client.id, operation?.id, body), "No se pudo guardar el expediente. Intenta de nuevo.");
  }

  function openCompletedExpediente(target: Operation) {
    if (completionTimer.current) {
      clearTimeout(completionTimer.current);
      completionTimer.current = null;
    }
    onSaved(target, true);
  }

  async function confirmAndGenerate(format: GeneratedFormat, retryOnly = false) {
    if (!pending || confirmBusy !== null || completionOperation !== null) return;
    setBatchFormat(format);
    setConfirmFailure("");
    setCompletionOperation(null);
    if (completionTimer.current) {
      clearTimeout(completionTimer.current);
      completionTimer.current = null;
    }
    onDirty(true);
    let targetOperation = createdOperation;
    if (!targetOperation) {
      setConfirmBusy("saving");
      try {
        targetOperation = await saveOperation(accountId, companyId, client.id, undefined, pending);
        if (!mounted.current || !(await isActiveAccount(accountId))) return;
        discardDraft();
        markClientDirectoryUpdated(clientScope(accountId));
        setCreatedOperation(targetOperation);
      } catch (error) {
        if (!mounted.current) return;
        setConfirmFailure(clientErrorMessage(error, "No se pudo guardar el expediente. Intenta de nuevo."));
        setConfirmBusy(null);
        onDirty(false);
        return;
      }
    }

    setConfirmBusy("generating");
    setGenerationProgress(null);
    const controller = new AbortController();
    batchAbort.current = controller;
    const retryTypes = retryOnly && generationResult
      ? generationResult.failed.map(item => item.type)
      : undefined;

    try {
      const result = await generateInitialExpedienteDocuments({
        accountId,
        client,
        operation: targetOperation,
        preferredFormat: format,
        retryOnlyTypes: retryTypes,
        onProgress: progress => {
          if (mounted.current) setGenerationProgress(progress);
        },
        signal: controller.signal,
      });
      if (!mounted.current || !(await isActiveAccount(accountId))) return;

      const mergedGenerated = retryOnly && generationResult
        ? [...generationResult.generated, ...result.generated]
        : result.generated;
      const mergedResult: BatchGenerationResult = {
        ...result,
        generated: mergedGenerated,
      };
      setGenerationResult(mergedResult);
      setConfirmBusy(null);
      onDirty(false);

      if (mergedResult.failed.length === 0) {
        toast({
          type: "success",
          title: mergedGenerated.length > 0 ? "Expediente guardado y documentos generados" : "Expediente guardado",
          description: mergedGenerated.length > 0
            ? `${mergedGenerated.length} documentos guardados en el expediente.`
            : undefined,
        });
        if (mergedGenerated.length > 0) {
          setCompletionOperation(targetOperation);
          const completedOp = targetOperation;
          completionTimer.current = setTimeout(() => {
            if (mounted.current) openCompletedExpediente(completedOp);
          }, 950);
        } else {
          onSaved(targetOperation, true);
        }
      }
    } catch (error) {
      if (!mounted.current) return;
      setConfirmFailure(clientErrorMessage(error, "No se pudieron generar los documentos iniciales del expediente."));
      setConfirmBusy(null);
      onDirty(false);
    } finally {
      if (batchAbort.current === controller) batchAbort.current = null;
    }
  }

  const applicationForm = <section className={styles.panel} aria-labelledby="loan-application-title" data-tour={!operation ? "operation-form" : undefined}>
    <div className={styles.header}>
      <div>
        <h2 id="loan-application-title" ref={heading} tabIndex={-1}>{operation ? "Editar expediente" : "Solicitud de préstamo"}</h2>
        <p className={styles.muted}>{client.name}</p>
      </div>
      {operation && <div className={styles.actions}>
        <Button type="button" variant="secondary" disabled={saving} onClick={() => { if (onCancel()) discardDraft(); }}>Cancelar</Button>
        <Button type="submit" form={formId} loading={saving} disabled={!canContinue}>Guardar cambios</Button>
      </div>}
    </div>
    {operation && failure && <p className={styles.failure} role="alert">{failure}</p>}
    <form id={formId} className={styles.stack} onSubmit={submit}>
      <fieldset className={`${styles.formFields} ${styles.alignTop}`} aria-label="Datos del expediente" disabled={saving}>
        {operation && <Select id="expediente-status" label="Estado" options={operationStatusOptions}
          value={draft.status} disabled={saving}
          onValueChange={value => { if (isOperationStatus(value)) updateDraft({ ...draft, status: value }); }} />}
        <Input name="application_date" label="Fecha de la solicitud" type="date" min="0001-01-01" max="9999-12-31" required value={draft.date}
          onChange={event => updateDraft({ ...draft, date: event.target.value })} />
        <MoneyField name="requested_amount" label="Monto solicitado" required value={draft.amount}
          error={amountError}
          onFocus={() => setAmountFocused(true)}
          onBlur={() => setAmountFocused(false)}
          onValueChange={amount => updateDraft(refreshPlan({ ...draft, amount }))} />
        <Input id="fecha-firma" name="signature_date" label="Fecha de firma" type="date" min="0001-01-01" max="9999-12-31"
          required={!operation || planStarted || Boolean(operation.financing)}
          value={draft.signatureDate}
          error={draft.signatureDate && !hasSignature ? "Indica una fecha válida." : undefined}
          onChange={event => updateDraft(refreshPlan({ ...draft, signatureDate: event.target.value }))} />
      </fieldset>
      <fieldset className={styles.sectionFields} aria-label="Seguro del vehículo" disabled={saving}>
        <legend>Seguro</legend>
        <label className={styles.insuranceToggle} htmlFor="seguro-saldo">
          <input
            id="seguro-saldo"
            name="insurance_paid"
            type="checkbox"
            checked={insurancePaid}
            onChange={event => {
              if (event.target.checked) setInsuranceFocused(false);
              updateDraft({ ...draft, insurancePaid: event.target.checked });
            }}
          />
          <span className={styles.insuranceToggleText}>
            <span className={styles.insuranceToggleTitle}>¿Seguro saldo?</span>
            <span className={styles.muted}>
              {insurancePaid
                ? "El seguro está saldo. No se requerirán cuotas ni se generarán los documentos del seguro al crear el expediente."
                : "Marca esta opción si el seguro ya está saldo y no requiere financiamiento ni documentos del seguro."}
            </span>
          </span>
        </label>
        {!insurancePaid && (
          <div className={`${styles.formFields} ${styles.alignTop}`}>
            <MoneyField id="monto-cuota-seguro" name="insurance_installment_amount" label="Monto de cada cuota del seguro" required
              value={draft.insuranceAmount}
              error={insuranceError}
              onFocus={() => setInsuranceFocused(true)}
              onBlur={() => setInsuranceFocused(false)}
              onValueChange={insuranceAmount => updateDraft({ ...draft, insuranceAmount })} />
            <Input id="cantidad-cuotas-seguro" name="insurance_installment_count" label="Cantidad de cuotas del seguro" required
              inputMode="numeric" value={draft.insuranceCount ?? ""}
              error={insuranceCountInput && !insuranceCountOk ? `Indica un número entero entre 1 y ${maxMonthlyInstallments}.` : undefined}
              onChange={event => updateDraft({ ...draft, insuranceCount: event.target.value.replace(/\D/g, "").slice(0, 3) })} />
          </div>
        )}
      </fieldset>
      {!operation && <p className={styles.muted}>La fecha de firma se usa para calcular el calendario de cuotas.</p>}
      {operation && <div className={styles.stack}>
        <h3>Plan de pagos</h3>
        <p className={styles.muted}>
          {!hasAmount
            ? "Indica el monto solicitado para calcular el plan de pagos."
            : !draft.signatureDate
              ? "Indica la fecha de firma para calcular las cuotas."
              : "Al completar el monto de la cuota y la cantidad, se genera el calendario."}
        </p>
        <fieldset className={`${styles.formFields} ${styles.alignTop}`} aria-label="Datos para calcular las cuotas" disabled={saving || !hasAmount || !hasSignature}>
          <MoneyField name="installment_amount" label="Monto de la cuota"
            value={draft.installmentAmount}
            error={draft.installmentAmount && installmentAmount <= 0 ? "Indica un monto mayor que cero con hasta dos decimales." : undefined}
            onValueChange={nextAmount => {
              if (draft.installmentRows.length > 0 && parseAmountMinor(nextAmount) === parseAmountMinor(draft.installmentAmount)) {
                updateDraft({ ...draft, installmentAmount: nextAmount });
                return;
              }
              updateDraft(refreshPlan({ ...draft, installmentAmount: nextAmount }));
            }} />
          <Input name="installment_count" label="Cantidad de cuotas" type="number" min={1} max={maxMonthlyInstallments} step={1}
            description="Incluye la última cuota, a la que se suma el capital financiado."
            value={draft.installmentCount}
            error={draft.installmentCount && !validInstallmentCount ? `Indica entre 1 y ${maxMonthlyInstallments} cuotas.` : undefined}
            onChange={event => updateDraft(refreshPlan({ ...draft, installmentCount: event.target.value }))} />
        </fieldset>
        {planOutOfRange && <p className={styles.failure} role="alert">El calendario o el total supera el rango permitido. Revisa el monto y la cantidad de cuotas.</p>}
        {draft.installmentRows.length > 0 && <>
          <p className={styles.muted}>Puedes editar cada fecha y monto en la tabla. Si cambias el monto o la cantidad, se regeneran las cuotas.</p>
          <fieldset className={styles.paymentTableFieldset} disabled={saving}>
            <div className={styles.paymentTableFrame} role="region" aria-label="Calendario de cuotas" tabIndex={0}>
              <table className={`${styles.paymentTable} ${styles.editablePaymentTable}`}>
                <caption>Calendario de cuotas</caption>
                <thead><tr><th scope="col">Cuota</th><th scope="col">Vencimiento</th><th scope="col">Monto (RD$)</th></tr></thead>
                <tbody>{draft.installmentRows.map((row, index) => <tr key={index}>
                  <th scope="row">{index + 1}{index === draft.installmentRows.length - 1 && " · Cuota final"}</th>
                  <td><Input name={`installment-date-${index}`} label={`Vencimiento de la cuota ${index + 1}`} type="date" required
                    value={row.date} error={planErrors[index]?.date} onChange={event => editInstallment(index, { date: event.target.value })} /></td>
                  <td><MoneyField name={`installment-amount-${index}`} label={`Monto de la cuota ${index + 1}`} required
                    value={row.amount} error={planErrors[index]?.amount} onValueChange={nextAmount => editInstallment(index, { amount: nextAmount })} /></td>
                </tr>)}</tbody>
                {draftPlan && <tfoot><tr><th scope="row" colSpan={2}>Total de cuotas</th><td>{applicationAmountLabel(planTotal)}</td></tr></tfoot>}
              </table>
            </div>
          </fieldset>
          {planTotalError && <p className={styles.failure} role="alert">El total de las cuotas supera el monto permitido.</p>}
        </>}
      </div>}
      <DocumentScan title="Rellenar con un documento del vehículo" disabled={saving} options={vehicleDocuments}
        onRead={async (category, files, signal): Promise<ScanOutcome> => {
          const result = await readVehicle(category, files, signal);
          if ("mismatch" in result) return result;
          patchDraft(current => ({ ...current, vehicle: { ...current.vehicle, ...result.vehicle } }));
          const filled = vehicleFields.filter(([key]) => result.vehicle[key]).map(([, label]) => label);
          return { filled, warnings: result.warnings };
        }} />
      <VehicleFormFields value={draft.vehicle} disabled={saving} required onChange={vehicle => updateDraft({ ...draft, vehicle })} />
      {clientMissing.length > 0 && <div className={styles.stack}>
        <Alert tone="info" title={`El cliente tiene ${clientMissing.length} datos pendientes`}>
          Completa el perfil del cliente para poder continuar con la solicitud.
        </Alert>
        <Button className={styles.alignStart} variant="secondary" type="button" onClick={onCompleteClient}>Completar datos del cliente</Button>
      </div>}
      <Alert open={insuranceMissing.length > 0} tone="warning" title="Completa los datos del seguro">
        {`Indica ${insuranceMissing.join(" y ")} para continuar.`}
      </Alert>
      <Alert open={vehicleMissing.length > 0} tone="warning" title="Completa los datos del vehículo">
        {vehicleMissing.length > 0 ? vehicleMissingHint(vehicleMissing) : "Todos los campos del vehículo son obligatorios para continuar."}
      </Alert>
      {!operation && <div className={styles.actions}>
        <Button type="button" variant="secondary" disabled={saving} onClick={onSelectClient}>
          <ArrowLeft size={16} aria-hidden="true" /> Atrás
        </Button>
        <Button type="submit" loading={saving} disabled={!canContinue}>
          Continuar al plan de pagos
        </Button>
      </div>}
    </form>
  </section>;

  if (operation) return applicationForm;

  const showingGenerationStage = confirmBusy !== null || completionOperation !== null;
  const stagePhase = completionOperation
    ? "complete"
    : confirmBusy === "saving"
      ? "saving"
      : generationProgress?.phase ?? "preparing";

  const intakeCapital = pending?.application?.requested_amount_minor ?? requestedAmount ?? 0;
  const signatureDate = typeof pending?.signature_date === "string" ? pending.signature_date : draft.signatureDate;
  const content = intakeStage === "plan" && pending?.application && signatureDate
    ? <IntakePaymentPlanStep capital={intakeCapital} signatureDate={signatureDate} initial={pending.financing}
        onBack={() => setIntakeStage("application")} onContinue={continueFromPlan} />
    : intakeStage === "review" && pending?.application && pending.vehicle && pending.financing
      ? showingGenerationStage
        ? <section className={styles.panel} aria-labelledby="loan-application-title" data-tour="operation-generating">
          <h2 id="loan-application-title" ref={heading} tabIndex={-1}>
            {completionOperation ? "Expediente emitido" : "Emitiendo documentos del expediente"}
          </h2>
          <ExpedienteGenerationStage
            phase={stagePhase}
            clientName={client.name}
            preferredFormat={batchFormat ?? preferences.defaultFormat}
            progress={generationProgress}
            operationReference={createdOperation?.reference}
            insurancePaid={Boolean(pending.insurance_paid)}
            onOpenExpediente={completionOperation ? () => openCompletedExpediente(completionOperation) : undefined}
          />
        </section>
        : <section className={styles.panel} aria-labelledby="loan-application-title" data-tour="operation-form">
          <h2 id="loan-application-title" ref={heading} tabIndex={-1}>Revisión y confirmación</h2>
          <LoanReview client={client} application={pending.application} vehicle={pending.vehicle}
            signatureDate={typeof pending.signature_date === "string" ? pending.signature_date : undefined}
            insurancePaid={Boolean(pending.insurance_paid)}
            insuranceInstallmentMinor={typeof pending.insurance_installment_minor === "number" ? pending.insurance_installment_minor : undefined}
            insuranceInstallmentCount={pending.financing?.insurance_installment_count ?? undefined}
            financing={pending.financing} />
          {confirmFailure && <Alert tone="danger" title="No se pudo completar el guardado">{confirmFailure}</Alert>}
          {createdOperation && generationResult && generationResult.failed.length > 0 && (
            <div className={styles.stack}>
              <Alert
                tone="warning"
                title={`Expediente guardado (${generationResult.generated.length} de ${generationResult.generated.length + generationResult.failed.length} documentos generados)`}
              >
                {generationResult.billingBlocked && billingAccess ? (
                  <>
                    Algunos documentos no se pudieron generar porque la facturación de la empresa requiere atención.{" "}
                    <Link href="/facturacion">Ir a facturación</Link>
                  </>
                ) : (
                  "El expediente se guardó, pero algunos documentos iniciales no pudieron generarse. Puedes reintentar los pendientes o abrir el expediente."
                )}
              </Alert>
              <ul className={styles.rows}>
                {generationResult.failed.map(item => (
                  <li key={item.type} className={styles.directoryRow}>
                    <div className={styles.directoryIdentity}>
                      <strong>{item.label}</strong>
                      <span>{item.message}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className={styles.actions} data-tour="operation-review">
            {!createdOperation && (
              <Button type="button" variant="secondary" onClick={() => setIntakeStage("plan")}>
                <ArrowLeft size={16} aria-hidden="true" /> Atrás
              </Button>
            )}
            {createdOperation && (
              <Button type="button" variant="secondary" onClick={() => onSaved(createdOperation, true)}>
                Ir al expediente
              </Button>
            )}
            {batchFormat ? (
              <Button type="button" onClick={() => void confirmAndGenerate(batchFormat, Boolean(generationResult?.failed.length))}>
                {generationResult?.failed.length ? "Reintentar documentos pendientes" : "Reintentar generación"}
              </Button>
            ) : (
              <>
                <Button type="button" onClick={() => formatSheetRef.current?.showModal()}>
                  Confirmar
                </Button>
                <dialog
                  ref={formatSheetRef}
                  className={styles.formatSheet}
                  aria-labelledby="batch-format-label"
                  onClick={event => { if (event.target === event.currentTarget) event.currentTarget.close(); }}
                >
                  <div className={styles.formatSheetBody}>
                    <span className={styles.formatSheetHandle} aria-hidden="true" />
                    <h2 id="batch-format-label">¿En qué formato generamos los documentos?</h2>
                    <div className={styles.formatChoice}>
                      <button type="button" className={`${styles.formatButton} ${styles.formatWord}`} onClick={() => { formatSheetRef.current?.close(); void confirmAndGenerate("docx"); }}>
                        <FileText size={22} aria-hidden="true" />
                        <span><strong>Word</strong><small>.docx editable</small></span>
                      </button>
                      <button type="button" className={`${styles.formatButton} ${styles.formatPdf}`} onClick={() => { formatSheetRef.current?.close(); void confirmAndGenerate("pdf"); }}>
                        <FileType2 size={22} aria-hidden="true" />
                        <span><strong>PDF</strong><small>.pdf listo para imprimir</small></span>
                      </button>
                    </div>
                    <Button type="button" variant="secondary" onClick={() => formatSheetRef.current?.close()}>
                      Cancelar
                    </Button>
                  </div>
                </dialog>
              </>
            )}
          </div>
        </section>
      : applicationForm;

  const currentStep = intakeStage === "review" ? 3 : intakeStage === "plan" ? 2 : 1;
  return <CaseIntakeSteps current={currentStep} onStepSelect={saving || showingGenerationStage || createdOperation !== null ? undefined : index => {
    if (index === 0) onSelectClient?.();
    if (index === 1) setIntakeStage("application");
    if (index === 2 && pending?.application) setIntakeStage("plan");
  }}>{content}</CaseIntakeSteps>;
}

function vehicleMissingHint(missing: string[]) {
  if (missing.length === 1) return `Falta ${missing[0]}.`;
  if (missing.length <= 3) return `Faltan: ${missing.join(", ")}.`;
  return "Todos los campos del vehículo son obligatorios para continuar.";
}

function LoanReview({ client, application, vehicle, signatureDate, insurancePaid, insuranceInstallmentMinor, insuranceInstallmentCount, financing }: {
  client: Client;
  application: NonNullable<Operation["application"]>;
  vehicle: Vehicle;
  signatureDate?: string;
  insurancePaid?: boolean;
  insuranceInstallmentMinor?: number;
  insuranceInstallmentCount?: number;
  financing?: Financing | null;
}) {
  const details = loanApplicationDetails(client, application, vehicle);
  return <div className={styles.stack}>
    <ReviewSection title="Datos del solicitante" fields={[
      ["Fecha de la solicitud", details.date],
      ...(signatureDate ? [["Fecha de firma", applicationDateLabel(signatureDate)]] : []),
      ...(insurancePaid
        ? [["Seguro", "Saldo (sin documentos del seguro)"]]
        : [
          ...(insuranceInstallmentMinor ? [["Monto de cada cuota del seguro", applicationAmountLabel(insuranceInstallmentMinor)]] : []),
          ...(insuranceInstallmentCount ? [["Cantidad de cuotas del seguro", String(insuranceInstallmentCount)]] : []),
        ]),
      ...details.applicant,
    ]} />
    <ReviewSection title="Datos del vehículo" fields={details.vehicle} />
    <ReviewSection title="Datos del cónyuge" fields={details.spouse} />
    {details.references.map(({ title, labels, rows }) => {
      const filled = rows.map((row, index) => ({ index, fields: labels.map((label, column) => [label, row[column]]) }))
        .filter(row => row.fields.some(([, value]) => value?.trim()));
      return filled.length > 0 && <section className={styles.stack} key={title}>
        <h3>{title}</h3>
        <ol className={styles.reviewReferences}>{filled.map(({ index, fields }) => <li key={index} value={index + 1}><ReviewFields fields={fields} /></li>)}</ol>
      </section>;
    })}
    {financing && <section className={styles.stack}>
      <h3>Plan de pagos</h3>
      <MonthlyPaymentTable plan={financing} />
      {financing.extraordinary_payments.length > 0 && (
        <div className={styles.paymentTableFrame} role="region" aria-label="Abonos extraordinarios" tabIndex={0}>
          <table className={styles.paymentTable}>
            <caption>Abonos extraordinarios</caption>
            <thead><tr><th scope="col">Abono</th><th scope="col">Fecha</th><th scope="col">Monto</th></tr></thead>
            <tbody>
              {financing.extraordinary_payments.map((payment, index) => (
                <tr key={`${payment.date}-${index}`}>
                  <th scope="row">Abono {index + 1}</th>
                  <td><time dateTime={payment.date}>{applicationDateLabel(payment.date)}</time></td>
                  <td>{applicationAmountLabel(payment.amount_minor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>}
  </div>;
}

function ReviewSection({ title, fields }: { title: string; fields: (string | null | undefined)[][] }) {
  if (!fields.some(([, value]) => value?.trim())) return null;
  return <section className={styles.stack}>
    <h3>{title}</h3>
    <ReviewFields fields={fields} />
  </section>;
}

function ReviewFields({ fields }: { fields: (string | null | undefined)[][] }) {
  return <dl className={styles.summary}>{fields.filter(([, value]) => value?.trim()).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>;
}
