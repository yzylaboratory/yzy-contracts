"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/arc/button/button";
import { displayClientIdentity, displayClientPhone } from "../clientes/client-masks";
import { convertProspect, formatProspectDate, prospectErrorMessage, type Prospect } from "./prospects-api";
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

  const rows: Array<[string, string | null]> = [
    ["Nombre", prospect.name],
    ["Identificación", displayClientIdentity(prospect.identity)],
    ["Teléfono", displayClientPhone(prospect.phone)],
    ["Dirección", prospect.address],
    ["Correo", prospect.email],
    ["Nacionalidad", prospect.nationality],
    ["Estado civil", prospect.marital_status],
    ["Puesto", prospect.position],
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
        <dl className={styles.dataList} translate="no">
          {rows.map(([label, value]) => (
            <div key={label} className={styles.dataGroup}>
              <dt>{label}</dt>
              <dd data-empty={value ? undefined : "true"}>{value || "Sin dato"}</dd>
            </div>
          ))}
        </dl>
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
