"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/arc/button/button";
import { LoadingContent } from "@/components/loading/loading-ui";
import { getGeneratedArtifact, getGeneratedDocument, listGeneratedDocuments, type GeneratedDocumentMetadata } from "@/app/contratos/generated-documents-api";
import { downloadBlob } from "@/app/contratos/document-export";
import { isActiveAccount } from "@/lib/api";
import { clientErrorMessage } from "./clients-api";
import { DocumentsRowsSkeleton } from "./clients-skeleton";
import styles from "./clients.module.css";

const pageSize = 20;
const dateFormat = new Intl.DateTimeFormat("es-DO", { dateStyle: "medium", timeZone: "America/Santo_Domingo" });
const formatLabel = { pdf: "PDF", docx: "Word", email: "Correo" };
type DocumentPage = Awaited<ReturnType<typeof listGeneratedDocuments>>;
type Result = { page: number; attempt: number } & ({ data: DocumentPage } | { error: string });

export function ExpedienteDocuments({ accountId, operationId, action, loanApplication }: {
  accountId: string;
  operationId: string;
  action: ReactNode;
  loanApplication?: ReactNode;
}) {
  const [page, setPage] = useState(1);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<Result>();
  const [downloading, setDownloading] = useState<string>();
  const [downloadError, setDownloadError] = useState("");
  const section = useRef<HTMLElement>(null);
  const pendingDownload = useRef(false);
  const current = result?.page === page && result.attempt === attempt ? result : undefined;
  const lastPage = result && "data" in result ? Math.max(1, Math.ceil(result.data.total / pageSize)) : 1;
  const showLoan = page === 1 && Boolean(loanApplication);
  const items = current && "data" in current ? current.data.items : [];

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

  async function download(record: GeneratedDocumentMetadata) {
    if (pendingDownload.current) return;
    pendingDownload.current = true;
    setDownloading(record.id);
    setDownloadError("");
    try {
      let filename = record.filename;
      if (record.format === "email") {
        const { email } = await getGeneratedDocument(accountId, record.id);
        if (!email) throw new Error("Missing attachment format");
        filename = filename.replace(/\.eml$/i, `.${email.attachmentFormat}`);
      }
      const blob = await getGeneratedArtifact(accountId, record.id);
      if (await isActiveAccount(accountId) && section.current) downloadBlob(blob, filename);
    } catch (error) {
      if (section.current) setDownloadError(clientErrorMessage(error, "No se pudo descargar el documento. Intenta de nuevo."));
    } finally {
      pendingDownload.current = false;
      if (section.current) setDownloading(undefined);
    }
  }

  return <section ref={section} className={styles.panel} aria-labelledby="expediente-documents-title">
    <div className={styles.header}>
      <h2 id="expediente-documents-title">Documentos y contratos</h2>
      {action}
    </div>
    {(showLoan || items.length > 0) && <ul className={styles.rows}>
        {showLoan && <li className={`${styles.operation} ${styles.stack}`}>{loanApplication}</li>}
        {items.map(record => <li key={record.id} className={`${styles.operation} ${styles.header}`}>
          <div className={styles.rowTitle}>
            <h3>{record.contractName}</h3>
            <p className={styles.muted}>{formatLabel[record.format]} · <time dateTime={record.createdAt}>{dateFormat.format(new Date(record.createdAt))}</time></p>
          </div>
          {record.hasArtifact && <Button type="button" variant="secondary" loading={downloading === record.id} disabled={downloading !== undefined && downloading !== record.id}
            aria-label={`Descargar ${record.contractName}`} onClick={() => void download(record)}>
            {record.format === "email" ? "Descargar adjunto" : "Descargar"}
          </Button>}
        </li>)}
    </ul>}
    {!current ? <LoadingContent label="Cargando documentos…"><DocumentsRowsSkeleton /></LoadingContent> : "error" in current ? (
      <div className={styles.header}>
        <p className={styles.failure} role="alert">{current.error}</p>
        <Button type="button" variant="secondary" onClick={() => setAttempt(value => value + 1)}>Reintentar</Button>
      </div>
    ) : !showLoan && items.length === 0 && <p className={styles.muted}>Aún no hay documentos generados en este expediente.</p>}
    {downloadError && <p className={styles.failure} role="alert">{downloadError}</p>}
    {lastPage > 1 && <nav className={styles.pagination} aria-label="Páginas de documentos del expediente">
      <Button type="button" variant="secondary" aria-disabled={!current || page <= 1} onClick={() => { if (current && page > 1) setPage(page - 1); }}>Anterior</Button>
      <span className={styles.muted} role="status">Página {page} de {lastPage}</span>
      <Button type="button" variant="secondary" aria-disabled={!current || page >= lastPage} onClick={() => { if (current && page < lastPage) setPage(page + 1); }}>Siguiente</Button>
    </nav>}
  </section>;
}
