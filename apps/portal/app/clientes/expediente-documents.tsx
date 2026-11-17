"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Download, Eye } from "lucide-react";
import { Button } from "@/components/arc/button/button";
import { Tooltip } from "@/components/arc/tooltip/tooltip";
import { LoadingContent } from "@/components/loading/loading-ui";
import { applicationAmountLabel, applicationDateLabel, type CaseApplication } from "@/components/case-application/case-application";
import { DocumentPreviewDialog } from "@/app/contratos/document-preview-dialog";
import { downloadBlob } from "@/app/contratos/document-export";
import { getGeneratedArtifact, getGeneratedDocument, listGeneratedDocuments, renderGeneratedPdf, type GeneratedDocumentMetadata } from "@/app/contratos/generated-documents-api";
import { isActiveAccount } from "@/lib/api";
import { recordPortalActivity } from "@/lib/activity";
import table from "@/app/contratos/contracts.module.css";
import { clientErrorMessage, type Client, type Operation } from "./clients-api";
import { DocumentsRowsSkeleton } from "./clients-skeleton";
import { LoanApplicationDownload, LoanApplicationIncompleteActions } from "./loan-application-download";
import styles from "./clients.module.css";

const pageSize = 20;
const dateFormat = new Intl.DateTimeFormat("es-DO", { dateStyle: "medium", timeZone: "America/Santo_Domingo" });
const formatLabel = { pdf: "PDF", docx: "Word", email: "Correo" } as const;
type DocumentPage = Awaited<ReturnType<typeof listGeneratedDocuments>>;
type Result = { page: number; attempt: number } & ({ data: DocumentPage } | { error: string });
type DocumentAction = "preview" | "download";

export type LoanDocumentRow = {
  client: Client;
  operation: Operation;
  application: CaseApplication;
  onCompleteClient: () => void;
  onCompleteApplication: () => void;
};

export function ExpedienteDocuments({ accountId, operationId, action, loan }: {
  accountId: string;
  operationId: string;
  action: ReactNode;
  loan?: LoanDocumentRow;
}) {
  const [page, setPage] = useState(1);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<Result>();
  const [busy, setBusy] = useState<{ id: string; action: DocumentAction } | null>(null);
  const [actionError, setActionError] = useState("");
  const [preview, setPreview] = useState<{ url: string; name: string } | null>(null);
  const section = useRef<HTMLElement>(null);
  const previewTrigger = useRef<HTMLButtonElement | null>(null);
  const pending = useRef(false);
  const current = result?.page === page && result.attempt === attempt ? result : undefined;
  const lastPage = result && "data" in result ? Math.max(1, Math.ceil(result.data.total / pageSize)) : 1;
  const showLoan = page === 1 && Boolean(loan);
  const items = current && "data" in current ? current.data.items : [];
  const hasRows = showLoan || items.length > 0;

  useEffect(() => {
    const controller = new AbortController();
    listGeneratedDocuments(accountId, { page, perPage: pageSize, search: "", format: "all", period: "any", operationId }, controller.signal)
      .then(data => {
        if (controller.signal.aborted) return;
        const finalPage = Math.max(1, Math.ceil(data.total / pageSize));
        if (page > finalPage) setPage(finalPage);
        else setResult({ page, attempt, data });
      })
      .catch(error => {
        if (!controller.signal.aborted) {
          setResult({ page, attempt, error: clientErrorMessage(error, "No se pudieron cargar los documentos del expediente.") });
        }
      });
    return () => controller.abort();
  }, [accountId, operationId, page, attempt]);

  useEffect(() => {
    if (!preview) return;
    return () => URL.revokeObjectURL(preview.url);
  }, [preview]);

  function isBusy(id: string, action: DocumentAction) {
    return busy?.id === id && busy.action === action;
  }

  async function openDocument(record: GeneratedDocumentMetadata, action: DocumentAction, trigger: HTMLButtonElement) {
    if (pending.current) return;
    pending.current = true;
    setBusy({ id: record.id, action });
    setActionError("");
    try {
      if (action === "preview") {
        if (!record.hasArtifact) {
          setActionError("Esta versión se generó con el método anterior. Genera el contrato de nuevo para ver el diseño del archivo original.");
          return;
        }
        const format = record.format === "email"
          ? (await getGeneratedDocument(accountId, record.id)).email?.attachmentFormat
          : record.format;
        const pdf = format === "pdf"
          ? await getGeneratedArtifact(accountId, record.id)
          : await renderGeneratedPdf(accountId, record.id);
        if (pdf.type !== "application/pdf" || !pdf.size) throw new Error("Invalid PDF");
        if (!(await isActiveAccount(accountId)) || !section.current) return;
        previewTrigger.current = trigger;
        setPreview({ url: URL.createObjectURL(pdf), name: record.contractName });
        return;
      }
      let filename = record.filename;
      if (record.format === "email") {
        const { email } = await getGeneratedDocument(accountId, record.id);
        if (!email) throw new Error("Missing attachment format");
        filename = filename.replace(/\.eml$/i, `.${email.attachmentFormat}`);
      }
      const blob = await getGeneratedArtifact(accountId, record.id);
      if (await isActiveAccount(accountId) && section.current) downloadBlob(blob, filename);
    } catch (error) {
      if (section.current) setActionError(clientErrorMessage(error, action === "preview"
        ? "No se pudo abrir la vista previa. Intenta de nuevo."
        : "No se pudo descargar el documento. Intenta de nuevo."));
    } finally {
      pending.current = false;
      if (section.current) setBusy(null);
    }
  }

  const loanDate = loan?.application.application_date;
  const loanAmount = loan?.application.requested_amount_minor;
  // The loan application follows the format chosen for the case documents.
  const loanFormat = items.some(record => record.format === "docx") ? "docx" : "pdf";

  return <section ref={section} className={styles.panel} aria-labelledby="expediente-documents-title">
    <div className={styles.header}>
      <h2 id="expediente-documents-title">Documentos y contratos</h2>
      {action}
    </div>
    {loan && <LoanApplicationIncompleteActions client={loan.client} operation={loan.operation}
      onCompleteClient={loan.onCompleteClient} onCompleteApplication={loan.onCompleteApplication} />}
    {hasRows && <div className={table.tableScroll} role="region" aria-label="Documentos del expediente" aria-busy={!current} tabIndex={0}
      data-tour={items.length > 0 ? "expediente-documents-ready" : undefined}>
      <table className={`${table.table} ${styles.documentsTable}`}>
        <thead>
          <tr>
            <th scope="col">Documento</th>
            <th scope="col" className={styles.documentsDetail}>Generado</th>
            <th scope="col" className={styles.documentsDetail}>Formato</th>
            <th scope="col"><span className={table.srOnly}>Acciones</span></th>
          </tr>
        </thead>
        <tbody>
          {showLoan && loan && <tr>
            <th scope="row">
              <span className={styles.documentName}>Solicitud de préstamo</span>
              {loanDate && <span className={styles.documentMeta}>Fecha · {applicationDateLabel(loanDate)}</span>}
              {loanAmount != null && loanAmount > 0 && <span className={styles.documentMeta}>Monto · {applicationAmountLabel(loanAmount)}</span>}
              <span className={`${styles.documentMeta} ${styles.documentsMobile}`}>
                {formatLabel[loanFormat]}{loanDate ? <> · <time dateTime={loanDate}>{applicationDateLabel(loanDate)}</time></> : null}
              </span>
            </th>
            <td className={styles.documentsDetail}>
              {loanDate ? <time dateTime={loanDate}>{applicationDateLabel(loanDate)}</time> : "—"}
            </td>
            <td className={styles.documentsDetail}><span className={styles.documentFormat} data-format={loanFormat}>{formatLabel[loanFormat]}</span></td>
            <td><LoanApplicationDownload accountId={accountId} client={loan.client} operation={loan.operation} format={loanFormat} /></td>
          </tr>}
          {items.map(record => <tr key={record.id}>
            <th scope="row">
              <span className={styles.documentName}>{record.contractName}</span>
              <span className={styles.documentMeta}>{record.filename}</span>
              <span className={`${styles.documentMeta} ${styles.documentsMobile}`}>
                {formatLabel[record.format]} · <time dateTime={record.createdAt}>{dateFormat.format(new Date(record.createdAt))}</time>
              </span>
            </th>
            <td className={styles.documentsDetail}>
              <time dateTime={record.createdAt}>{dateFormat.format(new Date(record.createdAt))}</time>
            </td>
            <td className={styles.documentsDetail}>
              <span className={styles.documentFormat} data-format={record.format}>{formatLabel[record.format]}</span>
            </td>
            <td>
              <div className={table.rowActions}>
                {record.hasArtifact && <>
                  <Tooltip content="Vista previa">
                    <Button type="button" variant="ghost" className={`${table.rowAction} ${styles.documentAction}`}
                      aria-label={`Vista previa de ${record.contractName}`} aria-haspopup="dialog"
                      loading={isBusy(record.id, "preview")}
                      disabled={Boolean(busy) && !isBusy(record.id, "preview")}
                      onClick={event => void openDocument(record, "preview", event.currentTarget)}>
                      <Eye size={18} aria-hidden="true" />
                    </Button>
                  </Tooltip>
                  <Tooltip content={record.format === "email" ? "Descargar adjunto" : "Descargar"}>
                    <Button type="button" variant="ghost" className={`${table.rowAction} ${styles.documentAction}`}
                      aria-label={`${record.format === "email" ? "Descargar adjunto de" : "Descargar"} ${record.contractName}`}
                      loading={isBusy(record.id, "download")}
                      disabled={Boolean(busy) && !isBusy(record.id, "download")}
                      onClick={event => void openDocument(record, "download", event.currentTarget)}>
                      <Download size={18} aria-hidden="true" />
                    </Button>
                  </Tooltip>
                </>}
              </div>
            </td>
          </tr>)}
        </tbody>
      </table>
    </div>}
    {!current ? <LoadingContent label="Cargando documentos…"><DocumentsRowsSkeleton /></LoadingContent> : "error" in current ? (
      <div className={styles.header}>
        <p className={styles.failure} role="alert">{current.error}</p>
        <Button type="button" variant="secondary" onClick={() => setAttempt(value => value + 1)}>Reintentar</Button>
      </div>
    ) : !hasRows && <p className={styles.muted}>Aún no hay documentos generados en este expediente.</p>}
    {actionError && <p className={styles.failure} role="alert">{actionError}</p>}
    {lastPage > 1 && <nav className={styles.pagination} aria-label="Páginas de documentos del expediente">
      <Button type="button" variant="secondary" aria-disabled={!current || page <= 1} onClick={() => { if (current && page > 1) setPage(page - 1); }}>Anterior</Button>
      <span className={styles.muted} role="status">Página {page} de {lastPage}</span>
      <Button type="button" variant="secondary" aria-disabled={!current || page >= lastPage} onClick={() => { if (current && page < lastPage) setPage(page + 1); }}>Siguiente</Button>
    </nav>}
    {preview && (
      <DocumentPreviewDialog
        pdfUrl={preview.url}
        documentName={preview.name}
        onOpen={() => recordPortalActivity(accountId, "document_previewed", "client_record")}
        onClose={() => {
          setPreview(null);
          previewTrigger.current?.focus();
          previewTrigger.current = null;
        }}
      />
    )}
  </section>;
}
