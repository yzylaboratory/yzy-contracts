import { useEffect, useRef, type FormEvent } from "react";
import { applicationAmountLabel, applicationDateLabel } from "@/components/case-application/case-application";
import { Button } from "@/components/arc/button/button";
import { Input } from "@/components/arc/input/input";
import { defaultExtraordinaryPayments, expedienteExtraordinaryPayments, extraordinaryPaymentDates, paymentDateAfterMonths } from "@/app/contratos/expediente-fields";
import { amountInputValue, parseAmountMinor } from "./amount-input";
import { clientScope, useClientDraft, useClientSave } from "./client-navigation";
import { saveOperation, type Operation } from "./clients-api";
import { calculateMonthlyPayments, installmentDraft, maxMonthlyInstallments, validateMonthlyPayments, type InstallmentDraft } from "./monthly-payment-plan";
import styles from "./clients.module.css";

type PaymentDraft = {
  amount: string;
  count: string;
  rows: InstallmentDraft[];
  needsCalculation?: boolean;
  extraordinary?: Record<string, string>;
  extraordinaryCount?: number;
};

export function MonthlyPaymentEditor({ accountId, operation, amountsOnly = false, onSaved, onDirty, onCancel, onCompleteApplication }: {
  accountId: string;
  operation: Operation;
  amountsOnly?: boolean;
  onSaved: (operation: Operation) => void;
  onDirty: (dirty: boolean) => void;
  onCancel: () => boolean;
  onCompleteApplication: () => void;
}) {
  const key = `${clientScope(accountId, operation.client_id)}:${amountsOnly ? "extraordinary-payments" : "payment-plan"}:${operation.id}`;
  const capital = operation.application?.requested_amount_minor ?? 0;
  const { draft, updateDraft, discardDraft } = useClientDraft<PaymentDraft>(key, () => {
    const existing = operation.financing;
    if (!existing) return { amount: "", count: "", rows: [] };
    const payments = [...existing.interest_installments, existing.final_principal];
    const amount = existing.interest_installments[0]?.amount_minor ?? Math.max(0, existing.final_principal.amount_minor - capital);
    return { amount: amount > 0 ? amountInputValue(amount) : "", count: String(payments.length), rows: payments.map(installmentDraft) };
  }, onDirty);
  const { save, saving, failure } = useClientSave(key, onDirty, onSaved);
  const heading = useRef<HTMLHeadingElement>(null);
  const newExtraordinary = useRef<HTMLInputElement>(null);
  const focusNewExtraordinary = useRef(false);
  useEffect(() => { heading.current?.focus(); }, []);
  const amount = parseAmountMinor(draft.amount) ?? 0;
  const count = /^\d+$/.test(draft.count) ? Number(draft.count) : 0;
  const validCount = Number.isInteger(count) && count >= 1 && count <= maxMonthlyInstallments;
  const signature = operation.signature_date;
  const canCalculate = Boolean(signature) && capital > 0 && amount > 0 && validCount;
  const calculationOutOfRange = canCalculate && (!Number.isSafeInteger(capital + count * amount) || !paymentDateAfterMonths(signature, count));
  const { errors, plan, total, totalError } = validateMonthlyPayments(draft.rows, paymentDateAfterMonths(signature, maxMonthlyInstallments));
  const finalDate = amountsOnly ? operation.financing?.final_principal.date
    : errors.at(-1)?.date ? undefined : draft.rows.at(-1)?.date;
  const dates = finalDate ? extraordinaryPaymentDates(signature, finalDate) : [];
  const saved = finalDate ? expedienteExtraordinaryPayments(operation, finalDate) ?? [] : [];
  const initialCount = Math.min(defaultExtraordinaryPayments, dates.length);
  const extras = dates.slice(0, draft.extraordinaryCount ?? saved.length).map((date, index) => {
    const value = draft.extraordinary?.[date] ?? amountInputValue(saved[index]?.amount_minor ?? 0);
    return { date, value, amount: parseAmountMinor(value) };
  });
  useEffect(() => {
    if (!focusNewExtraordinary.current) return;
    focusNewExtraordinary.current = false;
    newExtraordinary.current?.focus();
  }, [extras.length]);
  const validExtras = extras.every(payment => payment.amount !== undefined);
  const canSave = validExtras && Boolean(signature) &&
    (amountsOnly ? extras.length > 0 : Boolean(plan) && !draft.needsCalculation);

  function editInstallment(index: number, update: Partial<InstallmentDraft>) {
    const rows = draft.rows.map((row, position) => position === index ? { ...row, ...update } : row);
    updateDraft({ ...draft, rows });
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSave || saving) return;
    void save(() => saveOperation(accountId, operation.company_id, operation.client_id, operation.id, {
      financing: !amountsOnly && plan ? {
        ...plan,
        extraordinary_payments: operation.financing?.extraordinary_payments ?? [],
        insurance_installment_count: operation.financing?.insurance_installment_count,
        extraordinary_from_signature: operation.financing?.extraordinary_from_signature,
      } : undefined,
      extraordinary_payment_amounts_minor: extras.map(payment => payment.amount ?? 0),
    }), amountsOnly ? "No se pudieron guardar los abonos. Intenta de nuevo." : "No se pudo guardar el plan de pagos. Intenta de nuevo.");
  }

  return <section className={styles.panel} aria-labelledby="payment-plan-editor">
    <h2 id="payment-plan-editor" ref={heading} tabIndex={-1}>{amountsOnly ? "Editar abonos extraordinarios" : "Plan de pagos"}</h2>
    {signature ? <p className={styles.muted}>Fecha de firma · {applicationDateLabel(signature)}</p>
      : <p className={styles.muted}>Guarda la fecha de firma en el detalle del expediente para calcular las cuotas.</p>}
    {!amountsOnly && (capital > 0 ? <dl className={styles.summary}>
      <div><dt>Capital financiado · Solicitud de préstamo</dt><dd>{applicationAmountLabel(capital)}</dd></div>
    </dl> : <div className={styles.stack}>
      <p className={styles.muted}>Guarda el monto de la solicitud de préstamo para calcular las cuotas.</p>
      <Button className={styles.alignStart} type="button" variant="secondary" onClick={onCompleteApplication}>Completar solicitud</Button>
    </div>)}
    <form className={styles.stack} onSubmit={submit} noValidate>
      {!amountsOnly && <fieldset className={`${styles.formFields} ${styles.alignTop}`} aria-label="Datos para calcular las cuotas" disabled={saving}>
        <Input name="installment_amount" label="Monto de la cuota (RD$)" required inputMode="decimal" autoComplete="off"
          value={draft.amount} error={draft.amount && amount <= 0 ? "Indica un monto mayor que cero con hasta dos decimales." : undefined}
          onChange={event => updateDraft({ ...draft, amount: event.target.value, needsCalculation: true })} />
        <Input name="installment_count" label="Cantidad de cuotas" required type="number" min={1} max={maxMonthlyInstallments} step={1}
          description="Incluye la última cuota, a la que se suma el capital financiado."
          value={draft.count} error={draft.count && !validCount ? `Indica entre 1 y ${maxMonthlyInstallments} cuotas.` : undefined}
          onChange={event => updateDraft({ ...draft, count: event.target.value, needsCalculation: true })} />
      </fieldset>}
      {!amountsOnly && <>
        <Button className={styles.alignStart} type="button" variant="secondary" disabled={!canCalculate || calculationOutOfRange || saving}
          aria-describedby={draft.rows.length ? "recalculate-installments-hint" : undefined}
          onClick={() => updateDraft({ ...draft, rows: calculateMonthlyPayments(signature, amount, count, capital).map(installmentDraft), needsCalculation: false })}>
          {draft.rows.length ? "Recalcular cuotas" : "Generar cuotas"}
        </Button>
        {calculationOutOfRange && <p className={styles.failure} role="alert">El calendario o el total supera el rango permitido. Revisa el monto y la cantidad de cuotas.</p>}
        {draft.rows.length > 0 && <>
          <p id="recalculate-installments-hint" className={styles.muted}>Puedes editar cada fecha y monto en la tabla. Si recalculas, se reemplazarán las cuotas de la tabla.</p>
          <fieldset className={styles.paymentTableFieldset} disabled={saving}>
            <div className={styles.paymentTableFrame} role="region" aria-label="Calendario de cuotas" tabIndex={0}>
              <table className={`${styles.paymentTable} ${styles.editablePaymentTable}`}>
                <caption>Calendario de cuotas</caption>
                <thead><tr><th scope="col">Cuota</th><th scope="col">Vencimiento</th><th scope="col">Monto (RD$)</th></tr></thead>
                <tbody>{draft.rows.map((row, index) => <tr key={index}>
                  <th scope="row">{index + 1}{index === draft.rows.length - 1 && " · Cuota final"}</th>
                  <td><Input name={`installment-date-${index}`} label={`Vencimiento de la cuota ${index + 1}`} type="date" required
                    value={row.date} error={errors[index].date} onChange={event => editInstallment(index, { date: event.target.value })} /></td>
                  <td><Input name={`installment-amount-${index}`} label={`Monto de la cuota ${index + 1} (RD$)`} inputMode="decimal" autoComplete="off" required
                    value={row.amount} error={errors[index].amount} onChange={event => editInstallment(index, { amount: event.target.value })} /></td>
                </tr>)}</tbody>
                {plan && <tfoot><tr><th scope="row" colSpan={2}>Total de cuotas</th><td>{applicationAmountLabel(total)}</td></tr></tfoot>}
              </table>
            </div>
          </fieldset>
          {totalError && <p className={styles.failure} role="alert">El total de las cuotas supera el monto permitido.</p>}
        </>}
      </>}
      {extras.length > 0 && <fieldset className={styles.sectionFields} disabled={saving}>
        <legend>Abonos extraordinarios</legend>
        <div className={styles.formFields}>
          {extras.map(({ date, value, amount }, index) => <Input key={date} name={`extraordinary-${date}`}
            ref={index === extras.length - 1 ? newExtraordinary : undefined}
            label={`Monto del abono ${index + 1} (RD$)`} description={applicationDateLabel(date)}
            inputMode="decimal" autoComplete="off" value={value}
            error={amount === undefined ? "Escribe un monto válido con hasta dos decimales." : undefined}
            onChange={event => updateDraft({ ...draft, extraordinary: { ...draft.extraordinary, [date]: event.target.value } })} />)}
        </div>
        {(extras.length > initialCount || extras.length < dates.length) && <div className={styles.actions}>
          {extras.length > initialCount && <Button type="button" variant="secondary" onClick={() => {
            focusNewExtraordinary.current = true;
            updateDraft({ ...draft, extraordinaryCount: extras.length - 1 });
          }}>Quitar último abono</Button>}
          {extras.length < dates.length && <Button type="button" variant="secondary" onClick={() => {
            focusNewExtraordinary.current = true;
            updateDraft({ ...draft, extraordinaryCount: extras.length + 1 });
          }}>Agregar abono</Button>}
        </div>}
      </fieldset>}
      {failure && <p className={styles.failure} role="alert">{failure}</p>}
      <div className={styles.actions}>
        <Button type="button" variant="secondary" disabled={saving} onClick={() => { if (onCancel()) discardDraft(); }}>Atrás</Button>
        <Button type="submit" loading={saving} disabled={!canSave}>{amountsOnly ? "Guardar abonos" : "Guardar plan de pagos"}</Button>
      </div>
    </form>
  </section>;
}
