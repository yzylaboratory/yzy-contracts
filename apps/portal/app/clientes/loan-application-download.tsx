"use client";

import { useRef, useState } from "react";
import { downloadBlob } from "@/app/contratos/document-export";
import { Button } from "@/components/arc/button/button";
import { isActiveAccount } from "@/lib/api";
import { getLoanApplicationPdf, type Client, type Operation } from "./clients-api";
import { missingLoanClientFields, missingLoanVehicleFields } from "./loan-application-fields";
import styles from "./clients.module.css";

export function LoanApplicationDownload({ accountId, client, operation, onCompleteClient, onCompleteApplication }: {
  accountId: string; client: Client; operation: Operation; onCompleteClient: () => void; onCompleteApplication: () => void;
}) {
  const button = useRef<HTMLButtonElement>(null);
  const [downloading, setDownloading] = useState(false);
  const [failure, setFailure] = useState(false);
  const clientIncomplete = missingLoanClientFields(client).length > 0;
  const applicationIncomplete = missingLoanVehicleFields(operation.vehicle).length > 0 ||
    !operation.application?.application_date || !(Number(operation.application.requested_amount_minor) > 0);

  async function download() {
    setFailure(false);
    setDownloading(true);
    try {
      const blob = await getLoanApplicationPdf(accountId, operation.id);
      if (await isActiveAccount(accountId) && button.current) {
        const reference = operation.reference?.replace(/[^a-z0-9-]/gi, "-") || operation.id;
        downloadBlob(blob, `solicitud-de-prestamo-${reference}.pdf`);
      }
    } catch {
      setFailure(true);
    } finally {
      setDownloading(false);
    }
  }

  return <>
    {clientIncomplete || applicationIncomplete ? <p className={styles.muted}>Completa los datos pendientes para descargar la solicitud en PDF.</p> : null}
    <div className={styles.actions}>
      {clientIncomplete && <Button type="button" variant="secondary" onClick={onCompleteClient}>Completar datos del cliente</Button>}
      {applicationIncomplete && <Button type="button" variant="secondary" onClick={onCompleteApplication}>Completar solicitud</Button>}
      <Button ref={button} type="button" variant="secondary" disabled={clientIncomplete || applicationIncomplete} loading={downloading} onClick={() => void download()}>
        Descargar solicitud en PDF
      </Button>
    </div>
    {failure && <p className={styles.failure} role="alert">No se pudo preparar la solicitud. Intenta de nuevo.</p>}
  </>;
}
