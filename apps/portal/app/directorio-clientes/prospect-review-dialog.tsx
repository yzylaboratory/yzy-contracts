"use client";

import { useEffect, useId, useRef, useState } from "react";
import { loanApplicationSections } from "@/components/case-application/case-application";
import { Button } from "@/components/arc/button/button";
import { displayClientIdentity, displayClientPhone } from "../clientes/client-masks";
import { missingLoanClientFields } from "../clientes/loan-application-fields";
import { convertProspect, formatProspectDate, prospectErrorMessage, prospectReviewProfile, type Prospect } from "./prospects-api";
import styles from "./prospects.module.css";

/** Shows every submitted field and converts only after the reviewer checks the confirmation box. */
export function ProspectReviewDialog({ accountId, companyId, prospect, onConverted, onClose }: {
  accountId: string;
  companyId: string;
  prospect: Prospect;
  onConverted: (clientId: string) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const confirmId = useId();
  const [confirmed, setConfirmed] = useState(false);
  const [converting, setConverting] = useState(false);
  const [failure, setFailure] = useState<string>();

  useEffect(() => {
    const element = dialog.current;
    if (!element || element.open) return;
    element.showModal();
  }, []);

  function close() {
    dialog.current?.close();
    onClose();
  }

  async function convert() {
    if (!confirmed || converting) return;
    setConverting(true);
    setFailure(undefined);
    try {
      const { client_id } = await convertProspect(accountId, companyId, prospect.id);
      onConverted(client_id);
    } catch (error) {
      setFailure(prospectErrorMessage(error, "No se pudo convertir el prospecto. Vuelve a intentarlo."));
      setConverting(false);
    }
  }

  const profile = prospectReviewProfile(prospect);
  const sections = loanApplicationSections(profile);
  const incomplete = missingLoanClientFields({ ...prospect, profile }).length > 0;
  const general: [string, string | null | undefined][] = [
    ["Nombre", prospect.name],
    ["Identificación", displayClientIdentity(prospect.identity)],
    ["Teléfono", displayClientPhone(prospect.phone)],
    ["Dirección", prospect.address],
    ["Correo", prospect.email],
    ["Origen de los ingresos", prospect.income_source],
    ["Tratamiento", profile.treatment],
    ["Nacionalidad", profile.nationality],
    ["Estado civil", profile.marital_status],
    ["Enviado", formatProspectDate(prospect.submitted_at)],
  ];

  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      aria-labelledby={titleId}
      onCancel={event => {
        event.preventDefault();
        if (!converting) close();
      }}
    >
      <div className={styles.dialogHeader}>
        <h2 id={titleId}>Revisar prospecto</h2>
        <p>Revisa todos los datos antes de crear el cliente.</p>
      </div>
      <div className={styles.dialogBody}>
        {incomplete && (
          <p className={styles.reviewNote}>Faltan datos para la solicitud de préstamo. Puedes convertir este prospecto y completarlos en la ficha del cliente.</p>
        )}
        <section className={styles.reviewSection} aria-labelledby={`${titleId}-general`}>
          <h3 id={`${titleId}-general`}>Datos generales</h3>
          <ReviewFields fields={general} />
        </section>
        <section className={styles.reviewSection} aria-labelledby={`${titleId}-applicant`}>
          <h3 id={`${titleId}-applicant`}>Vivienda, empleo e ingresos</h3>
          <ReviewFields fields={sections.applicant} />
        </section>
        <section className={styles.reviewSection} aria-labelledby={`${titleId}-spouse`}>
          <h3 id={`${titleId}-spouse`}>Cónyuge</h3>
          <ReviewFields fields={sections.spouse} />
        </section>
        {sections.references.map(group => {
          const entries = group.rows
            .map((row, index) => ({ index, fields: group.labels.map((label, column): [string, string | null | undefined] => [label, row[column]]) }))
            .filter(entry => entry.fields.some(([, value]) => value?.trim()));
          return (
            <section key={group.title} className={styles.reviewSection} aria-label={group.title}>
              <h3>{group.title}</h3>
              {entries.length === 0 ? <p className={styles.reviewNote}>Sin referencias.</p> : (
                <ol className={styles.referenceList}>
                  {entries.map(entry => <li key={entry.index} value={entry.index + 1}>
                    <ReviewFields fields={entry.fields} />
                  </li>)}
                </ol>
              )}
            </section>
          );
        })}
        <label className={styles.confirmLabel} htmlFor={confirmId}>
          <input id={confirmId} type="checkbox" checked={confirmed} disabled={converting}
            onChange={event => setConfirmed(event.currentTarget.checked)} />
          <span>Confirmo que revisé estos datos y quiero crear un cliente con ellos. El cliente existente con la misma identificación no se modifica.</span>
        </label>
        {failure && <p className={styles.failure} role="alert">{failure}</p>}
      </div>
      <div className={styles.dialogActions}>
        <Button type="button" variant="secondary" disabled={converting} onClick={close}>Cancelar</Button>
        <Button type="button" disabled={!confirmed || converting} loading={converting} onClick={() => void convert()}>
          Convertir en cliente
        </Button>
      </div>
    </dialog>
  );
}

function ReviewFields({ fields }: { fields: (string | null | undefined)[][] }) {
  return (
    <dl className={styles.dataList} translate="no">
      {fields.map(([label, value]) => (
        <div key={label} className={styles.dataGroup}>
          <dt>{label}</dt>
          <dd data-empty={value?.trim() ? undefined : "true"}>{value?.trim() || "Sin dato"}</dd>
        </div>
      ))}
    </dl>
  );
}
