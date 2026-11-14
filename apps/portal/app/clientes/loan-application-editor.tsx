"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/arc/button/button";
import { Input } from "@/components/arc/input/input";
import { amountInputValue, parseAmountMinor } from "./amount-input";
import { CaseIntakeSteps } from "./case-intake-steps";
import { saveOperation, type Client, type Operation, type OperationPatch, type Vehicle } from "./clients-api";
import { clientScope, useClientDraft, useClientSave } from "./client-navigation";
import { loanApplicationDetails, missingLoanClientFields, missingLoanVehicleFields, vehicleFields } from "./loan-application-fields";
import { VehicleFormFields } from "./vehicle-form-fields";
import styles from "./clients.module.css";

type LoanDraft = { date: string; amount: string; vehicle: Vehicle };

const localDate = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Santo_Domingo", year: "numeric", month: "2-digit", day: "2-digit" });

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
  const key = `${clientScope(accountId, client.id)}:loan:${operation?.id ?? companyId}`;
  const { save, saving, failure } = useClientSave(key, onDirty, onSaved, clientScope(accountId));
  const { draft, updateDraft, discardDraft } = useClientDraft<LoanDraft>(key, () => ({
    date: operation?.application?.application_date ?? (operation ? "" : localDate.format(new Date())),
    amount: operation?.application?.requested_amount_minor == null ? "" : amountInputValue(operation.application.requested_amount_minor),
    vehicle: operation?.vehicle ?? {},
  }), onDirty);
  const [review, setReview] = useState<OperationPatch>();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, [review]);

  const requestedAmount = parseAmountMinor(draft.amount);
  const hasDate = /^\d{4}-\d{2}-\d{2}$/.test(draft.date) && !draft.date.startsWith("0000");
  const hasAmount = requestedAmount !== undefined && requestedAmount > 0;
  const clientMissing = missingLoanClientFields(client);
  const vehicleMissing = missingLoanVehicleFields(draft.vehicle);
  const canContinue = hasDate && hasAmount && clientMissing.length === 0 && vehicleMissing.length === 0;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canContinue || saving) return;
    const vehicle: Vehicle = {};
    for (const [field] of vehicleFields) {
      const value = draft.vehicle[field]?.trim();
      if (value) vehicle[field] = value;
    }
    const body = {
      application: { ...operation?.application, application_date: draft.date, requested_amount_minor: requestedAmount },
      vehicle,
    };
    if (operation) persist(body);
    else setReview(body);
  }

  function persist(body: OperationPatch) {
    if (!canContinue) return;
    void save(() => saveOperation(accountId, companyId, client.id, operation?.id, body), "No se pudo guardar el expediente. Intenta de nuevo.");
  }

  const content = review && review.application && review.vehicle ? <section className={styles.panel} aria-labelledby="loan-application-title" data-tour="operation-form">
    <h2 id="loan-application-title" ref={heading} tabIndex={-1}>Revisión y confirmación</h2>
    <LoanReview client={client} application={review.application} vehicle={review.vehicle} />
    {failure && <p className={styles.failure} role="alert">{failure}</p>}
    <div className={styles.actions}>
      <Button type="button" variant="secondary" disabled={saving} onClick={() => setReview(undefined)}>
        <ArrowLeft size={16} aria-hidden="true" /> Atrás
      </Button>
      <Button type="button" loading={saving} onClick={() => persist(review)}>{saving ? "Guardando…" : "Confirmar y guardar expediente"}</Button>
    </div>
  </section> : <section className={styles.panel} aria-labelledby="loan-application-title" data-tour={!operation ? "operation-form" : undefined}>
    <h2 id="loan-application-title" ref={heading} tabIndex={-1}>{operation ? "Editar solicitud de préstamo" : "Solicitud de préstamo"}</h2>
    <p className={styles.muted}>{client.name}</p>
    <form className={styles.stack} onSubmit={submit}>
      <fieldset className={styles.formFields} aria-label="Datos de la solicitud" disabled={saving}>
        <Input name="application_date" label="Fecha de la solicitud" type="date" min="0001-01-01" max="9999-12-31" required value={draft.date}
          onChange={event => updateDraft({ ...draft, date: event.target.value })} />
        <Input name="requested_amount" label="Monto solicitado (RD$)" inputMode="decimal" autoComplete="off" required value={draft.amount}
          error={draft.amount.trim() && !hasAmount ? "Indica un monto mayor que cero con hasta dos decimales." : undefined}
          onChange={event => updateDraft({ ...draft, amount: event.target.value })} />
      </fieldset>
      <VehicleFormFields value={draft.vehicle} disabled={saving} required onChange={vehicle => updateDraft({ ...draft, vehicle })} />
      {vehicleMissing.length > 0 && <p className={styles.muted}>Completa todos los datos del vehículo.</p>}
      {clientMissing.length > 0 && <div className={styles.stack}>
        <p className={styles.muted}>El cliente tiene {clientMissing.length} datos pendientes para la solicitud.</p>
        <Button className={styles.alignStart} variant="secondary" type="button" onClick={onCompleteClient}>Completar datos del cliente</Button>
      </div>}
      {operation && failure && <p className={styles.failure} role="alert">{failure}</p>}
      <div className={styles.actions}>
        {operation ? <Button type="button" variant="secondary" disabled={saving} onClick={() => { if (onCancel()) discardDraft(); }}>Cancelar</Button>
          : <Button type="button" variant="secondary" disabled={saving} onClick={onSelectClient}>
            <ArrowLeft size={16} aria-hidden="true" /> Atrás
          </Button>}
        <Button type="submit" loading={saving} disabled={!canContinue}>{operation ? "Guardar cambios" : "Continuar a revisión"}</Button>
      </div>
    </form>
  </section>;

  if (operation) return content;
  return <CaseIntakeSteps current={review ? 2 : 1} onStepSelect={saving ? undefined : index => {
    if (index === 0) onSelectClient?.();
    if (index === 1) setReview(undefined);
  }}>{content}</CaseIntakeSteps>;
}

function LoanReview({ client, application, vehicle }: { client: Client; application: NonNullable<Operation["application"]>; vehicle: Vehicle }) {
  const details = loanApplicationDetails(client, application, vehicle);
  return <div className={styles.stack}>
    <ReviewSection title="Datos del solicitante" fields={[["Fecha de la solicitud", details.date], ...details.applicant]} />
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
