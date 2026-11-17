"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { extraordinaryPaymentDate } from "@/app/contratos/expediente-fields";
import { MoneyField, typeMoney } from "@/app/contratos/money-field";
import { moneyMinor } from "@/app/contratos/native-field-kinds";
import { Button } from "@/components/arc/button/button";
import { Input } from "@/components/arc/input/input";
import { Select } from "@/components/arc/select/select";
import { amountInputValue, formatMoneyInput, parseAmountMinor } from "./amount-input";
import { saveOperation, type Operation, type OperationPatch, type OperationStatus, type Payment, type Vehicle } from "./clients-api";
import { clientScope, useClientDraft, useClientSave } from "./client-navigation";
import { isOperationStatus, operationStatusOptions } from "./expediente-status";
import { vehicleFields } from "./loan-application-fields";
import { VehicleFormFields } from "./vehicle-form-fields";
import styles from "./clients.module.css";

type PaymentDraft = { id: number; date: string; amount: string };
type OperationDraft = {
  status: OperationStatus;
  contractDate: string;
  insuranceAmount: string;
  vehicle: Vehicle;
  interest: PaymentDraft[];
  principal: Omit<PaymentDraft, "id">;
  extraordinary: PaymentDraft[];
};
const emptyPayment = { date: "", amount: "" };
const readPayment = (payment?: Payment) => payment ? { date: payment.date, amount: formatMoneyInput(payment.amount_minor) } : emptyPayment;
const interestDateError = "Las fechas de las cuotas de intereses deben estar en orden ascendente, sin repetirse y antes de la última cuota de capital.";

function amountFieldValue(minor: number | null | undefined) {
  if (minor == null) return "";
  return typeMoney(amountInputValue(minor));
}

function typedMoneyMinor(value: string) {
  const settled = moneyMinor(value);
  if (settled !== null) return settled;
  const digits = value.trim().replace(/^RD\$/, "").replace(/,/g, "");
  if (!/^\d+(?:\.\d{0,2})?$/.test(digits)) return undefined;
  const [whole, fraction = ""] = digits.split(".");
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, "0").slice(0, 2));
  return Number.isSafeInteger(minor) ? minor : undefined;
}

function samePayment(draft: Omit<PaymentDraft, "id">, payment: Payment) {
  return draft.date === payment.date && parseAmountMinor(draft.amount) === payment.amount_minor;
}

function validatePayment(name: string, payment: Omit<PaymentDraft, "id">, errors: Record<string, string>) {
  const amount = parseAmountMinor(payment.amount);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(payment.date)) errors[`${name}-date`] = "Indica una fecha válida.";
  if (amount === undefined || amount <= 0) {
    errors[`${name}-amount`] = "Indica un monto mayor que cero con hasta dos decimales.";
    return;
  }
  if (!errors[`${name}-date`]) return { date: payment.date, amount_minor: amount };
}

function PaymentFields({ name, date, amount, onChange, errors, required = true, dateReadOnly = false }: {
  name: string;
  date: string;
  amount: string;
  onChange: (update: Partial<typeof emptyPayment>) => void;
  errors: Record<string, string>;
  required?: boolean;
  dateReadOnly?: boolean;
}) {
  return <div className={styles.paymentFields}>
    <Input name={`${name}-date`} label="Fecha" type="date" value={date} required={required && !dateReadOnly} readOnly={dateReadOnly} error={errors[`${name}-date`]} onChange={event => onChange({ date: event.target.value })} />
    <MoneyField name={`${name}-amount`} label="Monto" value={amount} required={required} error={errors[`${name}-amount`]} onValueChange={nextAmount => onChange({ amount: nextAmount })} />
  </div>;
}

export function OperationEditor({ accountId, companyId, clientId, clientName, operation, onSaved, onCancel, onDirty }: {
  accountId: string;
  companyId: string | undefined;
  clientId: string;
  clientName?: string;
  operation?: Operation;
  onSaved: (operation: Operation, fromThisVisit: boolean) => void;
  onCancel: () => boolean;
  onDirty: (dirty: boolean) => void;
}) {
  const formId = useId();
  const key = `${clientScope(accountId, clientId)}:operation:${operation?.id ?? `new:${companyId}`}`;
  const { save, saving, failure } = useClientSave(key, onDirty, onSaved, clientScope(accountId));
  const { draft, updateDraft, discardDraft } = useClientDraft<OperationDraft>(key, () => ({
    status: operation?.status ?? "solicitud",
    contractDate: operation?.contract_date ?? "",
    insuranceAmount: amountFieldValue(operation?.insurance_installment_minor),
    vehicle: operation?.vehicle ?? {},
    interest: operation?.financing?.interest_installments.map((payment, index) => ({ id: index, ...readPayment(payment) })) ?? [],
    principal: readPayment(operation?.financing?.final_principal),
    extraordinary: operation?.financing?.extraordinary_payments.map((payment, index) => ({ id: index, ...readPayment(payment) })) ?? [],
  }), onDirty);
  const { interest, principal, extraordinary } = draft;
  const savedPlan = operation?.financing;
  const requiresPlan = !operation || Boolean(savedPlan || principal.date || principal.amount.trim() || interest.length || extraordinary.length);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const heading = useRef<HTMLHeadingElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const interestAdd = useRef<HTMLButtonElement>(null);
  const extraordinaryAdd = useRef<HTMLButtonElement>(null);
  const pendingFocus = useRef<{ name: string } | { add: "interest" | "extraordinary" }>(undefined);
  const nextPaymentId = useRef(1 + Math.max(-1, ...interest.map(payment => payment.id), ...extraordinary.map(payment => payment.id)));

  useEffect(() => {
    if (typeof window !== "undefined" && window.location.hash === "#monto-cuota-seguro") {
      const target = document.getElementById("monto-cuota-seguro");
      if (target) {
        target.focus();
        return;
      }
    }
    heading.current?.focus();
  }, []);

  useLayoutEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    pendingFocus.current = undefined;
    const control = "name" in target ? form.current?.elements.namedItem(target.name)
      : target.add === "interest" ? interestAdd.current : extraordinaryAdd.current;
    if (control instanceof HTMLElement) control.focus();
  }, [interest, extraordinary]);

  function changeDraft(update: Partial<OperationDraft>) {
    updateDraft({ ...draft, ...update });
    setErrors({});
  }

  function editExtraordinary(index: number, update: Partial<typeof emptyPayment>) {
    changeDraft({ extraordinary: extraordinary.map((payment, row) => {
      if (index === 0 && update.date !== undefined) return {
        ...payment, ...(row === 0 ? update : {}), date: extraordinaryPaymentDate(update.date, row) ?? "",
      };
      return row === index ? { ...payment, ...update } : payment;
    }) });
  }

  function removePayment(group: "interest" | "extraordinary", index: number) {
    const remaining = draft[group].filter((_, row) => row !== index);
    const focusIndex = Math.min(index, remaining.length - 1);
    const neighbor = remaining[focusIndex];
    const field = group === "extraordinary" && focusIndex > 0 ? "amount" : "date";
    pendingFocus.current = neighbor ? { name: `${group}-${neighbor.id}-${field}` } : { add: group };
    if (group === "interest") {
      changeDraft({ interest: remaining });
    } else {
      const firstDate = remaining[0]?.date ?? "";
      changeDraft({ extraordinary: remaining.map((payment, row) => ({ ...payment, date: extraordinaryPaymentDate(firstDate, row) ?? "" })) });
    }
  }

  function addPayment(group: "interest" | "extraordinary") {
    const id = nextPaymentId.current++;
    const payment = { id, ...emptyPayment };
    const rows = draft[group];
    const derivedDate = group === "extraordinary" && rows.length > 0;
    if (derivedDate) payment.date = extraordinaryPaymentDate(rows[0].date, rows.length) ?? "";
    pendingFocus.current = { name: `${group}-${id}-${derivedDate ? "amount" : "date"}` };
    changeDraft({ [group]: [...rows, payment] });
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    if (!companyId) {
      setErrors({ company_id: "Abre una empresa para guardar el expediente." });
      return;
    }
    const nextErrors: Record<string, string> = {};
    const vehicle: OperationDraft["vehicle"] = {};
    if (draft.contractDate && !/^\d{4}-\d{2}-\d{2}$/.test(draft.contractDate)) nextErrors.contract_date = "Indica una fecha válida.";
    const hasInsuranceInput = draft.insuranceAmount.trim() !== "";
    const insuranceInstallment = hasInsuranceInput ? typedMoneyMinor(draft.insuranceAmount) : undefined;
    if (hasInsuranceInput && (insuranceInstallment === undefined || insuranceInstallment <= 0)) {
      nextErrors.insurance_installment_amount = "Indica un monto mayor que cero con hasta dos decimales.";
    }
    for (const [key] of vehicleFields) {
      const value = draft.vehicle[key]?.trim();
      if (value && [...value].length > 200) nextErrors[key] = "Usa un máximo de 200 caracteres.";
      if (value) vehicle[key] = value;
    }
    const body: OperationPatch = {
      ...(operation ? { status: draft.status } : {}),
      contract_date: draft.contractDate || null,
      insurance_installment_minor: hasInsuranceInput ? insuranceInstallment : null,
      vehicle,
    };
    const samePlan = savedPlan &&
      samePayment(principal, savedPlan.final_principal) &&
      interest.length === savedPlan.interest_installments.length &&
      interest.every((draft, index) => samePayment(draft, savedPlan.interest_installments[index])) &&
      extraordinary.length === savedPlan.extraordinary_payments.length &&
      extraordinary.every((draft, index) => samePayment(draft, savedPlan.extraordinary_payments[index]));

    if (requiresPlan && !samePlan) {
      const interestPayments = interest.map(payment => validatePayment(`interest-${payment.id}`, payment, nextErrors));
      const finalPrincipal = validatePayment("principal", principal, nextErrors);
      const extraordinaryPayments = savedPlan?.extraordinary_from_signature ? savedPlan.extraordinary_payments
        : extraordinary.map(payment => validatePayment(`extraordinary-${payment.id}`, payment, nextErrors));
      const invalidPayment = interest.find(({ date }, index) =>
        date && ((finalPrincipal && date >= finalPrincipal.date) || (index > 0 && date <= interest[index - 1].date)));
      if (invalidPayment) nextErrors[`interest-${invalidPayment.id}-date`] ??= interestDateError;
      let total = 0;
      for (const [index, payment] of [...interestPayments, finalPrincipal].entries()) {
        if (!payment) continue;
        if (payment.amount_minor > Number.MAX_SAFE_INTEGER - total) {
          const name = index === interest.length ? "principal" : `interest-${interest[index].id}`;
          nextErrors[`${name}-amount`] = "El monto supera el total permitido para el plan.";
          break;
        }
        total += payment.amount_minor;
      }
      if (finalPrincipal) body.financing = {
        interest_installments: interestPayments.filter(payment => payment !== undefined),
        final_principal: finalPrincipal,
        extraordinary_payments: extraordinaryPayments.filter(payment => payment !== undefined),
        extraordinary_from_signature: savedPlan?.extraordinary_from_signature,
        insurance_installment_count: savedPlan?.insurance_installment_count,
        monthly_plan: savedPlan?.monthly_plan,
      };
    }
    setErrors(nextErrors);
    const firstInvalid = Array.from(event.currentTarget.elements).find(control =>
      control instanceof HTMLInputElement && nextErrors[control.name],
    );
    if (Object.keys(nextErrors).length) {
      if (firstInvalid instanceof HTMLElement) requestAnimationFrame(() => firstInvalid.focus());
      return;
    }
    void save(() => saveOperation(accountId, companyId, clientId, operation?.id, body), "No se pudo guardar el expediente. Intenta de nuevo.");
  }

  return <section className={styles.panel} aria-labelledby="operation-editor-title" data-tour={!operation ? "operation-form" : undefined}>
    <div className={styles.header}>
      <div>
        <h2 id="operation-editor-title" ref={heading} tabIndex={-1}>{operation ? "Editar expediente" : "Datos del expediente"}</h2>
        {clientName && <p className={styles.muted}>{clientName}</p>}
      </div>
      <div className={styles.actions}>
        <Button type="button" variant="secondary" disabled={saving} onClick={() => { if (onCancel()) discardDraft(); }}>Cancelar</Button>
        <Button type="submit" form={formId} loading={saving}>{saving ? "Guardando…" : "Guardar expediente"}</Button>
      </div>
    </div>
    {errors.company_id && <p className={styles.failure} role="alert">{errors.company_id}</p>}
    {failure && <p className={styles.failure} role="alert">{failure}</p>}
    <form id={formId} className={styles.stack} ref={form} noValidate onSubmit={submit}>
      <fieldset className={`${styles.formFields} ${styles.alignTop}`} aria-label="Datos del expediente" disabled={saving}>
        {operation && <Select id="expediente-status" label="Estado" options={operationStatusOptions}
          value={draft.status} disabled={saving}
          onValueChange={value => { if (isOperationStatus(value)) changeDraft({ status: value }); }} />}
        <Input name="contract_date" label="Fecha del contrato" type="date" value={draft.contractDate} error={errors.contract_date} onChange={event => changeDraft({ contractDate: event.target.value })} />
        <MoneyField id="monto-cuota-seguro" name="insurance_installment_amount" label="Monto de cada cuota del seguro"
          description="Opcional. Se usa en la venta condicional de seguro."
          value={draft.insuranceAmount} error={errors.insurance_installment_amount}
          onValueChange={insuranceAmount => changeDraft({ insuranceAmount })} />
      </fieldset>
      <VehicleFormFields value={draft.vehicle} errors={errors} disabled={saving} onChange={vehicle => changeDraft({ vehicle })} />
      <fieldset className={styles.sectionFields} disabled={saving}>
        <legend>Plan de pagos</legend>
        <div className={styles.stack}>
          {savedPlan?.monthly_plan ? <p className={styles.muted}>Las cuotas mensuales se editan desde Plan de pagos en el detalle del expediente.</p> : <>
            <div className={styles.stack}>
              <h3>Cuotas de intereses</h3>
              {interest.map((payment, index) => <fieldset className={styles.payment} key={payment.id}>
                <legend>Cuota {index + 1}</legend>
                <PaymentFields name={`interest-${payment.id}`} {...payment} errors={errors}
                  onChange={update => changeDraft({ interest: interest.map(row => row.id === payment.id ? { ...row, ...update } : row) })} />
                <Button type="button" variant="ghost" aria-label={`Quitar cuota ${index + 1}`} onClick={() => removePayment("interest", index)}>Quitar cuota</Button>
              </fieldset>)}
              <Button ref={interestAdd} className={styles.alignStart} type="button" variant="secondary" onClick={() => addPayment("interest")}>Agregar cuota de intereses</Button>
            </div>
            <fieldset className={styles.payment}>
              <legend>Última cuota de capital</legend>
              <PaymentFields name="principal" {...principal} errors={errors} required={requiresPlan} onChange={update => changeDraft({ principal: { ...principal, ...update } })} />
            </fieldset>
          </>}
          {!savedPlan?.monthly_plan && !savedPlan?.extraordinary_from_signature && <div className={styles.stack}>
            <h3>Abonos extraordinarios</h3>
            {extraordinary.map((payment, index) => <fieldset className={styles.payment} key={payment.id}>
              <legend>Abono {index + 1}</legend>
              <PaymentFields name={`extraordinary-${payment.id}`} {...payment} errors={errors} dateReadOnly={index > 0} onChange={update => editExtraordinary(index, update)} />
              <Button type="button" variant="ghost" aria-label={`Quitar abono ${index + 1}`} onClick={() => removePayment("extraordinary", index)}>Quitar abono</Button>
            </fieldset>)}
            <Button ref={extraordinaryAdd} className={styles.alignStart} type="button" variant="secondary" onClick={() => addPayment("extraordinary")}>Agregar abono extraordinario</Button>
          </div>}
        </div>
      </fieldset>
    </form>
  </section>;
}
