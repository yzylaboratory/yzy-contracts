"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowLeft } from "lucide-react";
import { applicationAmountLabel, applicationDateLabel } from "@/components/case-application/case-application";
import { Button } from "@/components/arc/button/button";
import { Input } from "@/components/arc/input/input";
import { defaultExtraordinaryPayments, extraordinaryPaymentDates, paymentDateAfterMonths } from "@/app/contratos/expediente-fields";
import { MoneyField } from "@/app/contratos/money-field";
import { formatMoneyInput, parseAmountMinor } from "./amount-input";
import type { Financing } from "./clients-api";
import { installmentDraft, maxMonthlyInstallments, planCalculationOutOfRange, planFromInputs, validateMonthlyPayments, type InstallmentDraft } from "./monthly-payment-plan";
import styles from "./clients.module.css";

type PlanDraft = {
  amount: string;
  count: string;
  rows: InstallmentDraft[];
  extraordinary: Record<string, string>;
  extraordinaryCount?: number;
};

export function IntakePaymentPlanStep({ capital, signatureDate, initial, onBack, onContinue }: {
  capital: number;
  signatureDate: string;
  initial?: Financing | null;
  onBack: () => void;
  onContinue: (financing: Financing) => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  const newExtraordinary = useRef<HTMLInputElement>(null);
  const focusNewExtraordinary = useRef(false);
  const [draft, setDraft] = useState<PlanDraft>(() => {
    if (!initial) return { amount: "", count: "", rows: [], extraordinary: {} };
    const payments = [...initial.interest_installments, initial.final_principal];
    const amount = initial.interest_installments[0]?.amount_minor
      ?? Math.max(0, initial.final_principal.amount_minor - capital);
    const extraordinary = Object.fromEntries(
      (initial.extraordinary_payments ?? []).map(payment => [
        payment.date,
        payment.amount_minor > 0 ? formatMoneyInput(payment.amount_minor) : "",
      ]),
    );
    return {
      amount: amount > 0 ? formatMoneyInput(amount) : "",
      count: String(payments.length),
      rows: payments.map(installmentDraft),
      extraordinary,
      extraordinaryCount: initial.extraordinary_payment_count ?? initial.extraordinary_payments?.length,
    };
  });
  useEffect(() => { heading.current?.focus(); }, []);

  const amount = parseAmountMinor(draft.amount) ?? 0;
  const count = /^\d+$/.test(draft.count) ? Number(draft.count) : 0;
  const validCount = Number.isInteger(count) && count >= 1 && count <= maxMonthlyInstallments;
  const calculationOutOfRange = planCalculationOutOfRange(signatureDate, capital, draft.amount, draft.count);
  const { errors, plan, total, totalError } = validateMonthlyPayments(draft.rows, paymentDateAfterMonths(signatureDate, maxMonthlyInstallments));
  const finalDate = errors.at(-1)?.date ? undefined : draft.rows.at(-1)?.date;
  const dates = finalDate ? extraordinaryPaymentDates(signatureDate, finalDate) : [];
  const initialCount = Math.min(defaultExtraordinaryPayments, dates.length);
  const shownCount = Math.min(dates.length, Math.max(initialCount, draft.extraordinaryCount ?? initialCount));
  const extras = dates.slice(0, shownCount).map(date => {
    const value = draft.extraordinary[date] ?? "";
    const parsed = parseAmountMinor(value);
    return { date, value, amount: parsed };
  });
  useEffect(() => {
    if (!focusNewExtraordinary.current) return;
    focusNewExtraordinary.current = false;
    newExtraordinary.current?.focus();
  }, [extras.length]);

  const validExtras = extras.every(payment => payment.amount !== undefined && payment.amount > 0);
  const canContinue = Boolean(plan) && !totalError && validExtras;

  function editInstallment(index: number, update: Partial<InstallmentDraft>) {
    setDraft(current => ({
      ...current,
      rows: current.rows.map((row, position) => position === index ? { ...row, ...update } : row),
    }));
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!plan || !canContinue) return;
    const extraordinaryPayments = extras.map(payment => ({
      date: payment.date,
      amount_minor: payment.amount ?? 0,
    }));
    onContinue({
      ...plan,
      extraordinary_from_signature: extraordinaryPayments.length > 0,
      extraordinary_payment_count: extraordinaryPayments.length,
      extraordinary_payments: extraordinaryPayments,
    });
  }

  return <section className={styles.panel} aria-labelledby="intake-payment-plan-title" data-tour="operation-form">
    <h2 id="intake-payment-plan-title" ref={heading} tabIndex={-1}>Plan de pagos</h2>
    <p className={styles.muted}>Fecha de firma · {applicationDateLabel(signatureDate)}</p>
    <dl className={styles.summary}>
      <div><dt>Capital financiado · Solicitud de préstamo</dt><dd>{applicationAmountLabel(capital)}</dd></div>
    </dl>
    <form className={styles.stack} data-tour="operation-plan" onSubmit={submit} noValidate>
      <fieldset className={`${styles.formFields} ${styles.alignTop}`} aria-label="Datos para calcular las cuotas">
        <MoneyField name="installment_amount" label="Monto de la cuota" required
          value={draft.amount} error={draft.amount && amount <= 0 ? "Indica un monto mayor que cero con hasta dos decimales." : undefined}
          onValueChange={nextAmount => setDraft(current => {
            if (current.rows.length > 0 && parseAmountMinor(nextAmount) === parseAmountMinor(current.amount)) {
              return { ...current, amount: nextAmount };
            }
            return {
              ...planFromInputs(signatureDate, capital, nextAmount, current.count),
              extraordinary: current.extraordinary,
              extraordinaryCount: current.extraordinaryCount,
            };
          })} />
        <Input name="installment_count" label="Cantidad de cuotas" required type="number" min={1} max={maxMonthlyInstallments} step={1}
          description="Incluye la última cuota, a la que se suma el capital financiado."
          value={draft.count} error={draft.count && !validCount ? `Indica entre 1 y ${maxMonthlyInstallments} cuotas.` : undefined}
          onChange={event => setDraft(current => ({
            ...planFromInputs(signatureDate, capital, current.amount, event.target.value),
            extraordinary: current.extraordinary,
            extraordinaryCount: current.extraordinaryCount,
          }))} />
      </fieldset>
      {calculationOutOfRange && <p className={styles.failure} role="alert">El calendario o el total supera el rango permitido. Revisa el monto y la cantidad de cuotas.</p>}
      {draft.rows.length > 0 && <>
        <p className={styles.muted}>Puedes editar cada fecha y monto en la tabla. Si cambias el monto o la cantidad, se regeneran las cuotas.</p>
        <fieldset className={styles.paymentTableFieldset}>
          <div className={styles.paymentTableFrame} role="region" aria-label="Calendario de cuotas" tabIndex={0}>
            <table className={`${styles.paymentTable} ${styles.editablePaymentTable}`}>
              <caption>Calendario de cuotas</caption>
              <thead><tr><th scope="col">Cuota</th><th scope="col">Vencimiento</th><th scope="col">Monto (RD$)</th></tr></thead>
              <tbody>{draft.rows.map((row, index) => <tr key={index}>
                <th scope="row">{index + 1}{index === draft.rows.length - 1 && " · Cuota final"}</th>
                <td><Input name={`installment-date-${index}`} label={`Vencimiento de la cuota ${index + 1}`} type="date" required
                  value={row.date} error={errors[index].date} onChange={event => editInstallment(index, { date: event.target.value })} /></td>
                <td><MoneyField name={`installment-amount-${index}`} label={`Monto de la cuota ${index + 1}`} required
                  value={row.amount} error={errors[index].amount} onValueChange={nextAmount => editInstallment(index, { amount: nextAmount })} /></td>
              </tr>)}</tbody>
              {plan && <tfoot><tr><th scope="row" colSpan={2}>Total de cuotas</th><td>{applicationAmountLabel(total)}</td></tr></tfoot>}
            </table>
          </div>
        </fieldset>
        {totalError && <p className={styles.failure} role="alert">El total de las cuotas supera el monto permitido.</p>}
      </>}
      {extras.length > 0 && <fieldset className={styles.sectionFields}>
        <legend>Abonos extraordinarios</legend>
        <p className={styles.muted}>Indica el monto de cada abono extraordinario requerido para los contratos.</p>
        <div className={styles.formFields}>
          {extras.map(({ date, value, amount }, index) => <MoneyField key={date} name={`extraordinary-${date}`}
            ref={index === extras.length - 1 ? newExtraordinary : undefined}
            label={`Monto del abono ${index + 1}`} description={applicationDateLabel(date)}
            required value={value}
            error={value.trim() !== "" && (amount === undefined || amount <= 0) ? "Escribe un monto mayor que cero con hasta dos decimales." : undefined}
            onValueChange={nextValue => setDraft(current => ({
              ...current,
              extraordinary: { ...current.extraordinary, [date]: nextValue },
            }))} />)}
        </div>
        {(extras.length > initialCount || extras.length < dates.length) && <div className={styles.actions}>
          {extras.length > initialCount && <Button type="button" variant="secondary" onClick={() => {
            focusNewExtraordinary.current = true;
            setDraft(current => ({ ...current, extraordinaryCount: extras.length - 1 }));
          }}>Quitar último abono</Button>}
          {extras.length < dates.length && <Button type="button" variant="secondary" onClick={() => {
            focusNewExtraordinary.current = true;
            setDraft(current => ({ ...current, extraordinaryCount: extras.length + 1 }));
          }}>Agregar abono</Button>}
        </div>}
      </fieldset>}
      <div className={styles.actions}>
        <Button type="button" variant="secondary" onClick={onBack}>
          <ArrowLeft size={16} aria-hidden="true" /> Atrás
        </Button>
        <Button type="submit" disabled={!canContinue}>Continuar a revisión</Button>
      </div>
    </form>
  </section>;
}
