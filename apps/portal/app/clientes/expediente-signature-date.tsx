import { type FormEvent } from "react";
import { Button } from "@/components/arc/button/button";
import { Input } from "@/components/arc/input/input";
import { clientScope, useClientDraft, useClientSave } from "./client-navigation";
import { saveOperation, type Operation } from "./clients-api";
import styles from "./clients.module.css";

export function ExpedienteSignatureDate({ accountId, operation, disabled, onDirty, onSaved }: {
  accountId: string;
  operation: Operation;
  disabled: boolean;
  onDirty: (dirty: boolean) => void;
  onSaved: (operation: Operation) => void;
}) {
  const key = `${clientScope(accountId, operation.client_id)}:signature:${operation.id}`;
  const savedDate = operation.signature_date ?? "";
  const { draft, updateDraft, discardDraft } = useClientDraft(key, () => savedDate, onDirty);
  const { save, saving, failure } = useClientSave(key, onDirty, onSaved);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || disabled || draft === savedDate) return;
    void save(() => saveOperation(accountId, operation.company_id, operation.client_id, operation.id, {
      signature_date: draft || null,
    }), "No se pudo guardar la fecha de firma. Intenta de nuevo.");
  }

  return <form className={styles.stack} onSubmit={submit}>
    <div className={styles.inlineField}>
      <Input id="fecha-firma" name="signature_date" label="Fecha de firma" type="date" min="0001-01-01" max="9999-12-31"
        required={Boolean(operation.financing?.monthly_plan)} aria-describedby={operation.financing?.monthly_plan ? "fecha-firma-hint" : undefined}
        value={draft} disabled={saving || disabled} onChange={event => {
          updateDraft(event.target.value);
          if (event.target.value === savedDate) discardDraft();
        }} />
      <Button type="submit" variant="secondary" loading={saving} disabled={disabled || draft === savedDate}>Guardar fecha</Button>
    </div>
    {operation.financing?.monthly_plan && <p id="fecha-firma-hint" className={styles.muted}>Si cambias la fecha de firma, se recalculan los vencimientos del plan de pagos.</p>}
    {failure && <p className={styles.failure} role="alert">{failure}</p>}
  </form>;
}
