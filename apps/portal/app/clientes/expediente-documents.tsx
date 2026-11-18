"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Download, Eye } from "lucide-react";
import { ExpedienteDocumentAccordion } from "./expediente-document-accordion";
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
import { ExpedienteDocumentRegeneration } from "./expediente-document-regeneration";
import { expedienteDocumentGroups, expedienteDocumentPosition } from "./expediente-document-groups";
import { documentTypeFromName } from "./document-template-match";
import { expedienteDocumentLabel } from "./expediente-document-label";
import { DocumentsRowsSkeleton } from "./clients-skeleton";
import { LoanApplicationDownload, LoanApplicationIncompleteActions } from "./loan-application-download";
import styles from "./clients.module.css";

const pageSize = 20;
const dateFormat = new Intl.DateTimeFormat("es-DO", { dateStyle: "medium", timeZone: "America/Santo_Domingo" });
const formatLabel = { pdf: "PDF", docx: "Word", email: "Correo" } as const;
type Result = { attempt: number } & ({ items: GeneratedDocumentMetadata[] } | { error: string });

function position(record: GeneratedDocumentMetadata) {
  return expedienteDocumentPosition(record.documentType ?? documentTypeFromName(record.contractName)?.id);
}
type DocumentAction = "preview" | "download";

export type LoanDocumentRow = {
  client: Client;
  operation: Operation;
  application: CaseApplication;
  onCompleteClient: () => void;
  onCompleteApplication: () => void;
};

export function ExpedienteDocuments({ accountId, clientId, operationId, action, loan, onRegenerated }: {
  accountId: string;
  clientId: string;
  operationId: string;
  action: ReactNode;
  loan?: LoanDocumentRow;
  onRegenerated: () => void;
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
  const current = result?.attempt === attempt ? result : undefined;
  const loaded = current && "items" in current ? current.items : undefined;
  const lastPage = Math.max(1, Math.ceil((loaded?.length ?? 0) / pageSize));
  const showLoan = page === 1 && Boolean(loan);
  const items = loaded?.slice((page - 1) * pageSize, page * pageSize) ?? [];
  const hasRows = showLoan || items.length > 0;
  const groups = expedienteDocumentGroups.map((group, index) => ({
    title: group.title,
    showLoan: index === 0 && showLoan,
    items: items.filter(record => group.types.some(type => expedienteDocumentPosition(type) === position(record))),
  }));
  const otherItems = items.filter(record => position(record) === expedienteDocumentPosition(undefined));
  if (otherItems.length) groups.push({ title: "Otros documentos", showLoan: false, items: otherItems });

  useEffect(() => {
    const controller = new AbortController();
    async function loadDocuments() {
      const documents: GeneratedDocumentMetadata[] = [];
      const perPage = 100;
      for (let nextPage = 1; !controller.signal.aborted; nextPage++) {
        const { items, total } = await listGeneratedDocuments(accountId,
          { page: nextPage, perPage, search: "", format: "all", period: "any", operationId }, controller.signal);
        documents.push(...items);
        if (!items.length || nextPage * perPage >= total) break;
      }
      if (!controller.signal.aborted) {
        documents.sort((left, right) => position(left) - position(right));
        setResult({ attempt, items: documents });
      }
    }
    void loadDocuments().catch(error => {
      if (!controller.signal.aborted) {
        setResult({ attempt, error: clientErrorMessage(error, "No se pudieron cargar los documentos del expediente.") });
      }
    });
    return () => controller.abort();
  }, [accountId, operationId, attempt]);

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
        setPreview({ url: URL.createObjectURL(pdf), name: expedienteDocumentLabel(record.contractName) });
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
  // La solicitud se descarga en Word como los demás documentos del expediente; la vista previa sigue en PDF.
  const loanFormat = "docx";

  return <section ref={section} className={styles.panel} aria-labelledby="expediente-documents-title">
    <div className={styles.header}>
      <h2 id="expediente-documents-title">Documentos y contratos</h2>
      <div className={styles.actions}>
        <ExpedienteDocumentRegeneration accountId={accountId} clientId={clientId} operationId={operationId}
          hasLoan={Boolean(loan)} disabled={loaded?.length === 0 && !loan}
          onRefreshed={() => {
            setPage(1);
            setAttempt(value => value + 1);
            onRegenerated();
          }} />
        {action}
      </div>
    </div>
    {loan && <LoanApplicationIncompleteActions client={loan.client} operation={loan.operation}
      onCompleteClient={loan.onCompleteClient} onCompleteApplication={loan.onCompleteApplication} />}
    {hasRows && <ExpedienteDocumentAccordion tour={items.length > 0 ? "expediente-documents-ready" : undefined}
      items={groups.filter(group => group.showLoan || group.items.length > 0).map(group => ({
          title: group.title,
          count: group.items.length + Number(group.showLoan),
          content: <ul className={styles.documentStageList}>
            {group.showLoan && loan && <li className={styles.documentStageEntry}>
              <div>
                <span className={styles.documentName}>Solicitud de préstamo</span>
                {loanAmount != null && loanAmount > 0 && <span className={styles.documentMeta}>Monto · {applicationAmountLabel(loanAmount)}</span>}
                <div className={styles.documentStageMeta}>
                  <span className={styles.documentFormat} data-format={loanFormat}>{formatLabel[loanFormat]}</span>
                  {loanDate && <time dateTime={loanDate}>{applicationDateLabel(loanDate)}</time>}
                </div>
              </div>
              <div><LoanApplicationDownload accountId={accountId} client={loan.client} operation={loan.operation} format={loanFormat} /></div>
            </li>}
            {group.items.map(record => <li key={record.id} className={styles.documentStageEntry}>
              <div>
                <span className={styles.documentName}>{expedienteDocumentLabel(record.contractName)}</span>
                <span className={styles.documentMeta}>{expedienteDocumentLabel(record.filename, true)}</span>
                <div className={styles.documentStageMeta}>
                  <span className={styles.documentFormat} data-format={record.format}>{formatLabel[record.format]}</span>
                  <time dateTime={record.createdAt}>{dateFormat.format(new Date(record.createdAt))}</time>
                </div>
              </div>
              <div className={table.rowActions}>
                {record.hasArtifact && <>
                  <Tooltip content="Vista previa">
                    <Button type="button" variant="ghost" className={`${table.rowAction} ${styles.documentAction}`}
                      aria-label={`Vista previa de ${expedienteDocumentLabel(record.contractName)}`} aria-haspopup="dialog"
                      loading={isBusy(record.id, "preview")}
                      disabled={Boolean(busy) && !isBusy(record.id, "preview")}
                      onClick={event => void openDocument(record, "preview", event.currentTarget)}>
                      <Eye size={18} aria-hidden="true" />
                    </Button>
                  </Tooltip>
                  <Tooltip content={record.format === "email" ? "Descargar adjunto" : "Descargar"}>
                    <Button type="button" variant="ghost" className={`${table.rowAction} ${styles.documentAction}`}
                      aria-label={`${record.format === "email" ? "Descargar adjunto de" : "Descargar"} ${expedienteDocumentLabel(record.contractName)}`}
                      loading={isBusy(record.id, "download")}
                      disabled={Boolean(busy) && !isBusy(record.id, "download")}
                      onClick={event => void openDocument(record, "download", event.currentTarget)}>
                      <Download size={18} aria-hidden="true" />
                    </Button>
                  </Tooltip>
                </>}
              </div>
            </li>)}
          </ul>,
      }))} />}
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
