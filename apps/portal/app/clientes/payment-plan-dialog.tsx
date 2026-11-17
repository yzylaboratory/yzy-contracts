"use client";

import { useEffect, useId, useRef } from "react";
import { applicationAmountLabel, applicationDateLabel } from "@/components/case-application/case-application";
import { Button } from "@/components/arc/button/button";
import { expedienteExtraordinaryPayments } from "@/app/contratos/expediente-fields";
import type { Operation } from "./clients-api";
import { MonthlyPaymentTable } from "./monthly-payment-table";
import dialogStyles from "@/app/contratos/document-preview-dialog.module.css";
import styles from "./clients.module.css";

export function PaymentPlanDialog({ operation, onClose, onEdit }: {
  operation: Operation;
  onClose: () => void;
  onEdit: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const plan = operation.financing;
  const extras = expedienteExtraordinaryPayments(operation);

  useEffect(() => {
    const element = dialog.current;
    if (!element || element.open) return;
    element.showModal();
  }, []);

  function close() {
    dialog.current?.close();
    onClose();
  }

  if (!plan) return null;

  return (
    <dialog
      ref={dialog}
      id="plan-de-pagos"
      className={dialogStyles.dialog}
      aria-labelledby={titleId}
      onCancel={event => {
        event.preventDefault();
        close();
      }}
      onKeyDown={event => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        close();
      }}
    >
      <div className={dialogStyles.header}>
        <div>
          <h2 id={titleId}>Plan de pagos</h2>
          {operation.reference && <p>{operation.reference}</p>}
        </div>
        <div className={styles.actions}>
          <Button id="edit-payment-plan" type="button" variant="secondary" onClick={onEdit}>Editar plan de pagos</Button>
          <Button type="button" variant="secondary" onClick={close}>Cerrar</Button>
        </div>
      </div>
      <div className={`${dialogStyles.content} ${styles.stack}`}>
        <MonthlyPaymentTable plan={plan} calculated={Boolean(plan.monthly_plan)} />
        {extras && extras.length > 0 && <div className={styles.stack}>
          <h3>Abonos extraordinarios</h3>
          <dl className={styles.summary}>
            {extras.map(({ date, amount_minor }) => <div key={date}>
              <dt><time dateTime={date}>{applicationDateLabel(date)}</time></dt>
              <dd>{amount_minor > 0 ? applicationAmountLabel(amount_minor) : "Monto pendiente"}</dd>
            </div>)}
          </dl>
        </div>}
      </div>
    </dialog>
  );
}
