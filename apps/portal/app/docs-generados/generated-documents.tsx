"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Download, Eye, Forward } from "lucide-react";
import { Button } from "@/components/arc/button/button";
import { Input } from "@/components/arc/input/input";
import { Select } from "@/components/arc/select/select";
import { useToastStack } from "@/components/arc/toast-stack/toast-stack";
import { Tooltip } from "@/components/arc/tooltip/tooltip";
import { LoadingContent } from "@/components/loading/loading-ui";
import { errorMessage } from "@/app/contratos/contracts-api";
import { documentDateKey, legacyHistoryWarning, syncLegacyGeneratedDocuments } from "@/app/contratos/contracts-store";
import { createDocumentBlob, downloadBlob } from "@/app/contratos/document-export";
import { DocumentPreviewDialog } from "@/app/contratos/document-preview-dialog";
import { getGeneratedArtifact, getGeneratedDocument, listGeneratedDocuments, renderGeneratedPdf, type GeneratedDocument, type GeneratedDocumentMetadata } from "@/app/contratos/generated-documents-api";
import { isActiveAccount } from "@/lib/api";
import { useSession } from "@/lib/session";
import shared from "../contratos/contracts.module.css";
import { EmailDraftDialog } from "./email-draft-dialog";
import { GeneratedDocumentsSkeleton } from "./generated-documents-skeleton";
import styles from "./generated-documents.module.css";

const labels = { pdf: "PDF", docx: "Word", email: "Correo" } as const;
const formatOptions = [
  { value: "all", label: "Todos" },
  ...Object.entries(labels).map(([value, label]) => ({ value, label })),
];
const dateOptions = [
  { value: "any", label: "Cualquiera" },
  { value: "week", label: "Últimos 7 días" },
  { value: "month", label: "Últimos 30 días" },
  { value: "year", label: "Este año" },
];
const defaultFilters = { search: "", format: "all", date: "any" };
const rowOptions = [6, 12, 24];
const monthLabels = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
function formatDate(date: string) {
  const [year, month, day] = date.split("-");
  return `${day} ${monthLabels[Number(month) - 1]} ${year}`;
}

function paginationItems(page: number, count: number) {
  if (count <= 5) return Array.from({ length: count }, (_, index) => index + 1);
  if (page <= 3) return [1, 2, 3, "after", count] as const;
  if (page >= count - 2) return [1, "before", count - 2, count - 1, count] as const;
  return [1, "before", page - 1, page, page + 1, "after", count] as const;
}

export function GeneratedDocuments() {
  const session = useSession();
  const accountId = session?.user.id;
  return accountId ? (
    <GeneratedDocumentsList key={accountId} accountId={accountId} accountEmail={session?.user.email ?? ""} />
  ) : (
    <LoadingContent label="Cargando documentos generados…">
      <GeneratedDocumentsSkeleton />
    </LoadingContent>
  );
}

type Listing = { data: Awaited<ReturnType<typeof listGeneratedDocuments>> } | { failure: string };
type DocumentAction = "preview" | "export";

function GeneratedDocumentsList({ accountId, accountEmail }: {
  accountId: string;
  accountEmail: string;
}) {
  const { toast } = useToastStack();
  const [draft, setDraft] = useState(defaultFilters);
  const [filters, setFilters] = useState(defaultFilters);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(6);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ key: string; listing: Listing; page: number; pageSize: number } | null>(null);
  const [legacyPending, setLegacyPending] = useState(false);
  const [busyAction, setBusyAction] = useState<{ id: string; action: DocumentAction } | null>(null);
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null);
  const [emailRecord, setEmailRecord] = useState<GeneratedDocument | null>(null);
  const [previewRecord, setPreviewRecord] = useState<{ url: string; contractName: string } | null>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const emailTrigger = useRef<HTMLButtonElement | null>(null);
  const previewTrigger = useRef<HTMLButtonElement | null>(null);
  const actionInProgress = useRef(false);
  const key = JSON.stringify([filters, page, pageSize, attempt]);

  useEffect(() => {
    if (previewRecord) return () => URL.revokeObjectURL(previewRecord.url);
  }, [previewRecord]);

  useEffect(() => {
    const request = new AbortController();
    const { signal } = request;
    async function load() {
      try {
        const synced = await syncLegacyGeneratedDocuments(accountId);
        if (signal.aborted) return;
        const data = await listGeneratedDocuments(accountId, {
          page, perPage: pageSize, search: filters.search.trim(), format: filters.format, period: filters.date,
        }, signal);
        if (!await isActiveAccount(accountId) || signal.aborted) return;
        setLegacyPending(!synced);
        const lastPage = Math.max(1, Math.ceil(data.total / pageSize));
        if (page > lastPage) setPage(lastPage);
        else setResult({ key, listing: { data }, page, pageSize });
      } catch (error) {
        if (!signal.aborted) {
          setResult({ key, listing: { failure: errorMessage(error, "No se pudieron cargar los documentos.") }, page, pageSize });
        }
      }
    }
    void load();
    return () => request.abort();
  }, [accountId, filters, key, page, pageSize]);

  const listing = result?.key === key ? result.listing : null;
  const displayed = listing ?? result?.listing;
  const data = displayed && "data" in displayed ? displayed.data : null;
  const total = data?.total ?? 0;
  const visible = data?.items ?? [];
  const shownPage = result?.page ?? 1;
  const shownPageSize = result?.pageSize ?? pageSize;
  const pageCount = Math.ceil(total / shownPageSize);
  const start = (shownPage - 1) * shownPageSize;
  const range = visible.length ? `${start + 1}–${start + visible.length} de ${total}` : "0 de 0";
  const rangeLabel = `Mostrando ${range} ${total === 1 ? "documento" : "documentos"}`;
  const hasFilters = filters.search.trim() || filters.format !== "all" || filters.date !== "any";

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFilters(draft);
    setPage(1);
    setAttempt(current => current + 1);
    setNotice(null);
  }

  function clearFilters() {
    setDraft(defaultFilters);
    setFilters(defaultFilters);
    setPage(1);
    setNotice(null);
    searchInput.current?.focus();
  }

  function isBusy(id: string, action: DocumentAction) {
    return busyAction?.id === id && busyAction.action === action;
  }

  async function openDocument(record: GeneratedDocumentMetadata, action: DocumentAction, trigger: HTMLButtonElement) {
    if (!listing || actionInProgress.current) return;
    actionInProgress.current = true;
    setBusyAction({ id: record.id, action });
    setNotice(null);
    try {
      if (action === "preview") {
        if (!record.hasArtifact) {
          setNotice({ text: "Esta versión se generó con el método anterior. Genera el contrato de nuevo para ver el diseño del archivo original.", error: true });
          return;
        }
        const format = record.format === "email"
          ? (await getGeneratedDocument(accountId, record.id)).email?.attachmentFormat
          : record.format;
        const pdf = format === "pdf"
          ? await getGeneratedArtifact(accountId, record.id)
          : await renderGeneratedPdf(accountId, record.id);
        if (pdf.type !== "application/pdf" || !pdf.size) throw new Error("Invalid PDF");
        if (!await isActiveAccount(accountId) || !searchInput.current) return;
        previewTrigger.current = trigger;
        setPreviewRecord({ url: URL.createObjectURL(pdf), contractName: record.contractName });
        return;
      }
      if (record.format === "email") {
        const detail = await getGeneratedDocument(accountId, record.id);
        if (!await isActiveAccount(accountId) || !searchInput.current) return;
        emailTrigger.current = trigger;
        setEmailRecord(detail);
        return;
      }
      let blob: Blob;
      if (record.hasArtifact) {
        blob = await getGeneratedArtifact(accountId, record.id);
      } else {
        const detail = await getGeneratedDocument(accountId, record.id);
        blob = await createDocumentBlob(record.format, detail.contractName, detail.markdown);
      }
      if (!await isActiveAccount(accountId) || !searchInput.current) return;
      downloadBlob(blob, record.filename);
      setNotice({ text: record.hasArtifact ? `Se preparó la descarga de ${record.filename}.` : `Se descargó una copia reconstruida de ${record.filename}. Su diseño puede variar.` });
      toast({ type: "success", title: record.hasArtifact ? "Descarga preparada" : "Copia reconstruida descargada", description: record.filename });
    } catch (error) {
      if (searchInput.current) setNotice({ text: errorMessage(error, "No se pudo abrir el documento. Inténtalo de nuevo."), error: true });
    } finally {
      actionInProgress.current = false;
      if (searchInput.current) setBusyAction(null);
    }
  }

  function closeEmail() {
    setEmailRecord(null);
    if (emailTrigger.current?.isConnected && !emailTrigger.current.disabled) emailTrigger.current.focus();
    else searchInput.current?.focus();
  }

  function closePreview() {
    setPreviewRecord(null);
    const trigger = previewTrigger.current;
    previewTrigger.current = null;
    if (trigger?.isConnected && !trigger.disabled) trigger.focus();
    else searchInput.current?.focus();
  }

  return (
    <section className={`${shared.panel} ${styles.panel}`} aria-label="Listado de documentos">
      <form className={shared.filterGrid} onSubmit={search}>
        <Input
          ref={searchInput}
          className={shared.fieldControl}
          label="Contrato o código"
          name="contrato"
          placeholder="Ej. CTR-018 o arrendamiento"
          autoComplete="off"
          maxLength={200}
          value={draft.search}
          onChange={event => setDraft({ ...draft, search: event.target.value })}
        />
        <Select
          className={shared.fieldControl}
          label="Formato"
          options={formatOptions}
          value={draft.format}
          onValueChange={format => setDraft({ ...draft, format })}
        />
        <Select
          className={shared.fieldControl}
          label="Fecha de generación"
          options={dateOptions}
          value={draft.date}
          onValueChange={date => setDraft({ ...draft, date })}
        />
        <Button type="submit" className={shared.primary}>Buscar</Button>
      </form>

      <p className={`${shared.notice} ${notice?.error ? styles.error : ""}`} role={notice?.error ? "alert" : undefined}>{notice?.text}</p>
      {legacyPending && (
        <div className={shared.empty}>
          <p role="status">{legacyHistoryWarning}</p>
          <Button type="button" variant="secondary" onClick={() => setAttempt(current => current + 1)}>Reintentar sincronización</Button>
        </div>
      )}
      {!listing && <p className={shared.notice} role="status">Cargando documentos generados…</p>}
      {listing && "failure" in listing && (
        <div className={shared.empty}>
          <p role="alert">{listing.failure}</p>
          <Button type="button" variant="secondary" onClick={() => setAttempt(current => current + 1)}>Reintentar</Button>
        </div>
      )}
      {data && (
        <>
          <div className={shared.tableScroll} role="region" aria-label="Tabla de documentos generados" aria-busy={!listing} tabIndex={0}>
            <table className={`${shared.table} ${styles.table}`}>
              <thead>
                <tr>
                  <th scope="col">Contrato</th>
                  <th scope="col" className={styles.desktopDetail}>Generado</th>
                  <th scope="col" className={styles.desktopDetail}>Formato</th>
                  <th scope="col"><span className={shared.srOnly}>Acciones</span></th>
                </tr>
              </thead>
              <tbody>
                {visible.map(record => (
                  <tr key={record.id}>
                    <th scope="row">
                      <span className={styles.contractName}>{record.contractName}</span>
                      {record.company && <span className={styles.metadata}>Empresa · {record.company.name}</span>}
                      <span className={styles.metadata}>
                        <span className={styles.contractId}>{record.contractId}</span>
                        { ` · ${record.format === "email" ? "Borrador de correo" : record.filename}` }
                      </span>
                      {!record.hasArtifact && <span className={styles.metadata}>Copia reconstruida · El diseño puede variar</span>}
                      <span className={`${styles.metadata} ${styles.mobileDetail}`}>
                        {labels[record.format]} · <time dateTime={record.createdAt}>{formatDate(documentDateKey(new Date(record.createdAt)))}</time>
                      </span>
                    </th>
                    <td className={styles.desktopDetail}><time dateTime={record.createdAt}>{formatDate(documentDateKey(new Date(record.createdAt)))}</time></td>
                    <td className={styles.desktopDetail}><span className={styles.format} data-format={record.format}>{labels[record.format]}</span></td>
                    <td>
                      <div className={shared.rowActions}>
                        <Tooltip content="Vista previa">
                          <Button
                            type="button"
                            variant="ghost"
                            className={`${shared.rowAction} ${styles.actionIcon}`}
                            aria-label={`Vista previa de ${record.contractName}`}
                            aria-haspopup="dialog"
                            loading={isBusy(record.id, "preview")}
                            disabled={!listing || (Boolean(busyAction) && !isBusy(record.id, "preview"))}
                            onClick={event => void openDocument(record, "preview", event.currentTarget)}
                          >
                            <Eye size={18} aria-hidden="true" />
                          </Button>
                        </Tooltip>
                        {record.format === "email" ? (
                          <Tooltip content="Preparar reenvío">
                            <Button
                              type="button"
                              variant="ghost"
                              className={`${shared.rowAction} ${styles.actionIcon}`}
                              aria-label={`Preparar reenvío de ${record.contractName}`}
                              loading={isBusy(record.id, "export")}
                              disabled={!listing || (Boolean(busyAction) && !isBusy(record.id, "export"))}
                              onClick={event => void openDocument(record, "export", event.currentTarget)}
                            >
                              <Forward size={18} aria-hidden="true" />
                            </Button>
                          </Tooltip>
                        ) : (
                          <Tooltip content={record.hasArtifact ? "Descargar" : "Descargar copia reconstruida"}>
                            <Button
                              type="button"
                              variant="ghost"
                              className={`${shared.rowAction} ${styles.actionIcon}`}
                              aria-label={`${record.hasArtifact ? "Descargar" : "Descargar copia reconstruida de"} ${record.filename}`}
                              loading={isBusy(record.id, "export")}
                              disabled={!listing || (Boolean(busyAction) && !isBusy(record.id, "export"))}
                              onClick={event => void openDocument(record, "export", event.currentTarget)}
                            >
                              <Download size={18} aria-hidden="true" />
                            </Button>
                          </Tooltip>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {listing && visible.length === 0 && (
            <div className={shared.empty}>
              {hasFilters ? (
                <>
                  <p>No se encontraron documentos con estos filtros.</p>
                  <Button type="button" variant="secondary" onClick={clearFilters}>Limpiar filtros</Button>
                </>
              ) : <p>Los documentos que generes con tu cuenta aparecerán aquí.</p>}
            </div>
          )}

          <div className={shared.paginationBar}>
            <div className={shared.paginationSummary}>
              <p className={shared.range} role="status">{rangeLabel}</p>
              <label className={shared.rowPicker}>
                Filas
                <select
                  className={shared.fieldControl}
                  value={pageSize}
                  onChange={event => {
                    setPageSize(Number(event.target.value));
                    setPage(1);
                  }}
                >
                  {rowOptions.map(value => <option key={value} value={value}>{value}</option>)}
                </select>
              </label>
            </div>

            {pageCount > 1 && (
              <nav className={shared.pagination} aria-label="Páginas de documentos">
                <Button type="button" variant="secondary" className={shared.pager} disabled={!listing || shownPage === 1} onClick={() => setPage(shownPage - 1)}>Anterior</Button>
                {paginationItems(shownPage, pageCount).map(item => typeof item === "number" ? (
                  <Button
                    key={item}
                    type="button"
                    variant="secondary"
                    className={`${shared.pager} ${shared.pageNumber}`}
                    aria-current={shownPage === item ? "page" : undefined}
                    aria-label={`Página ${item}`}
                    disabled={!listing}
                    onClick={() => setPage(item)}
                  >
                    {item}
                  </Button>
                ) : <span className={styles.ellipsis} aria-hidden="true" key={item}>…</span>)}
                <Button type="button" variant="secondary" className={shared.pager} disabled={!listing || shownPage === pageCount} onClick={() => setPage(shownPage + 1)}>Siguiente</Button>
              </nav>
            )}
          </div>
        </>
      )}

      {previewRecord && (
        <DocumentPreviewDialog
          pdfUrl={previewRecord.url}
          documentName={previewRecord.contractName}
          onClose={closePreview}
        />
      )}
      {emailRecord && (
        <EmailDraftDialog
          key={emailRecord.id}
          record={emailRecord}
          accountId={accountId}
          accountEmail={accountEmail}
          onClose={closeEmail}
          onDownload={() => {
            setNotice({ text: `Se preparó la descarga de ${emailRecord.filename}.` });
            toast({ type: "success", title: "Borrador de correo preparado", description: emailRecord.filename });
          }}
        />
      )}
    </section>
  );
}
