"use client";

import { useEffect, useRef, useState } from "react";
import { Download, Eye } from "lucide-react";
import { DocumentPreviewDialog } from "@/app/contratos/document-preview-dialog";
import { downloadBlob } from "@/app/contratos/document-export";
import { Button } from "@/components/arc/button/button";
import { Tooltip } from "@/components/arc/tooltip/tooltip";
import { isActiveAccount } from "@/lib/api";
import { recordPortalActivity } from "@/lib/activity";
import { getLoanApplicationDocument, loanApplicationFilename, type Client, type Operation } from "./clients-api";
import { missingLoanClientFields } from "./loan-application-fields";
import { missingLoanVehicleFields } from "./vehicle-fields";
import table from "@/app/contratos/contracts.module.css";
import styles from "./clients.module.css";

export function loanApplicationDocumentState(client: Client, operation: Operation) {
  const clientIncomplete = missingLoanClientFields(client).length > 0;
  const applicationIncomplete = missingLoanVehicleFields(operation.vehicle).length > 0 ||
    !operation.application?.application_date || !(Number(operation.application.requested_amount_minor) > 0);
  return { clientIncomplete, applicationIncomplete, blocked: clientIncomplete || applicationIncomplete };
}

export function LoanApplicationIncompleteActions({ client, operation, onCompleteClient, onCompleteApplication }: {
  client: Client; operation: Operation; onCompleteClient: () => void; onCompleteApplication: () => void;
}) {
  const { clientIncomplete, applicationIncomplete, blocked } = loanApplicationDocumentState(client, operation);
  if (!blocked) return null;
  return <div className={styles.stack}>
    <p className={styles.muted}>Completa los datos pendientes para ver o descargar la solicitud.</p>
    <div className={styles.actions}>
      {clientIncomplete && <Button type="button" variant="secondary" onClick={onCompleteClient}>Completar datos del cliente</Button>}
      {applicationIncomplete && <Button type="button" variant="secondary" onClick={onCompleteApplication}>Completar solicitud</Button>}
    </div>
  </div>;
}

/** Icon actions for the documents table row. */
export function LoanApplicationDownload({ accountId, client, operation, format }: {
  accountId: string; client: Client; operation: Operation; format: "pdf" | "docx";
}) {
  const downloadButton = useRef<HTMLButtonElement>(null);
  const previewButton = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState<"download" | "preview" | null>(null);
  const [failure, setFailure] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const { blocked } = loanApplicationDocumentState(client, operation);
  const filename = loanApplicationFilename(operation, format);

  useEffect(() => {
    if (!previewUrl) return;
    return () => URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  async function load(requested: "pdf" | "docx") {
    const blob = await getLoanApplicationDocument(accountId, operation.id, requested);
    if (!(await isActiveAccount(accountId))) return null;
    return blob;
  }

  async function download() {
    setFailure(false);
    setBusy("download");
    try {
      const blob = await load(format);
      if (blob && downloadButton.current) downloadBlob(blob, filename);
    } catch {
      setFailure(true);
    } finally {
      setBusy(null);
    }
  }

  async function preview() {
    setFailure(false);
    setBusy("preview");
    try {
      const blob = await load("pdf");
      if (!blob || !previewButton.current) return;
      setPreviewUrl(URL.createObjectURL(blob));
    } catch {
      setFailure(true);
    } finally {
      setBusy(null);
    }
  }

  return <>
    <div className={table.rowActions}>
      <Tooltip content="Vista previa">
        <Button ref={previewButton} type="button" variant="ghost" className={`${table.rowAction} ${styles.documentAction}`}
          aria-label="Vista previa de la solicitud de préstamo" aria-haspopup="dialog"
          disabled={blocked || busy === "download"} loading={busy === "preview"} onClick={() => void preview()}>
          <Eye size={18} aria-hidden="true" />
        </Button>
      </Tooltip>
      <Tooltip content={format === "docx" ? "Descargar Word" : "Descargar PDF"}>
        <Button ref={downloadButton} type="button" variant="ghost" className={`${table.rowAction} ${styles.documentAction}`}
          aria-label={`Descargar solicitud de préstamo en ${format === "docx" ? "Word" : "PDF"}`}
          disabled={blocked || busy === "preview"} loading={busy === "download"} onClick={() => void download()}>
          <Download size={18} aria-hidden="true" />
        </Button>
      </Tooltip>
    </div>
    {failure && <p className={styles.failure} role="alert">No se pudo preparar la solicitud. Intenta de nuevo.</p>}
    {previewUrl && (
      <DocumentPreviewDialog
        pdfUrl={previewUrl}
        documentName={loanApplicationFilename(operation, "pdf")}
        onOpen={() => recordPortalActivity(accountId, "document_previewed", "client_record")}
        onClose={() => {
          setPreviewUrl(null);
          previewButton.current?.focus();
        }}
      />
    )}
  </>;
}
