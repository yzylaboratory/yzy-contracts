"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { Banknote, Car, Check, ClipboardCheck, FileBadge, FileCheck, FileLock, FileSignature, FileText, FileType2, FolderOpen, Handshake, KeyRound, Landmark, MapPin, Receipt, Shield, ShieldCheck, Unlock } from "lucide-react";
import { DOCUMENT_TYPES, getDocumentType, type DocumentType } from "@/app/contratos/document-catalog";
import { downloadBlob } from "@/app/contratos/document-export";
import { listGeneratedDocuments } from "@/app/contratos/generated-documents-api";
import { Badge } from "@/components/arc/badge/badge";
import { Button } from "@/components/arc/button/button";
import button from "@/components/arc/button/button.module.css";
import { isActiveAccount } from "@/lib/api";
import { canManageCompanyBilling, usePortalAccess } from "@/lib/portal-access";
import { LoadingBlock, LoadingContent } from "@/components/loading/loading-ui";
import { generateFromOperationHref } from "./client-paths";
import { clientErrorMessage, getClient, getLoanApplicationDocument, loanApplicationFilename, type Operation } from "./clients-api";
import { documentTypeFromName } from "./document-template-match";
import { loanApplicationDocumentState } from "./loan-application-download";
import { listDocumentTemplates, resolveDocumentTemplate } from "./operation-templates";
import styles from "./clients.module.css";

const icons = {
  venta_condicional: Handshake, venta_condicional_seguro: ShieldCheck, pagare_autentico: FileSignature, entrega_voluntaria: KeyRound,
  acto_seguro: Shield, pagare_seguro: FileBadge, declaracion_jurada: ClipboardCheck,
  gps: MapPin, autorizacion_data: FileLock, acuerdo_seguro: ShieldCheck,
  autorizacion_asegurar_vehiculo: FileCheck, autorizacion_desembolso: Banknote, designacion_cuenta: Landmark, levantamiento_oposicion: Unlock,
  entrega_vehiculo: Car, entrega_vehiculo_fines_saldo: Receipt, entrega_documentos: FolderOpen, carta_saldo: FileText,
} satisfies Record<DocumentType, typeof Car>;

const demos: Partial<Record<DocumentType, string>> = {
  carta_saldo: "/plantillas-demo/carta-saldo.docx",
  entrega_documentos: "/plantillas-demo/entrega-documentos.docx",
};

export function DocumentOptionsSkeleton() {
  return <div className={styles.documentGrid}><LoadingBlock height={144} />{DOCUMENT_TYPES.map(({ id }) => <LoadingBlock key={id} height={144} />)}</div>;
}

export function OperationDocumentPicker({ accountId, operation }: { accountId: string; operation: Operation }) {
  const router = useRouter();
  const loanFormatSheet = useRef<HTMLDialogElement>(null);
  const loanRequest = useRef<AbortController>(null);
  const loanFormatTitle = useId();
  const [loanBusy, setLoanBusy] = useState(false);
  const [loanFailure, setLoanFailure] = useState("");
  const [loanGeneratedFor, setLoanGeneratedFor] = useState<string>();
  const loanScope = `${accountId}:${operation.id}:${operation.updated_at}`;

  useEffect(() => () => loanRequest.current?.abort(), []);

  useEffect(() => {
    if (!operation.application?.application_date || !(Number(operation.application.requested_amount_minor) > 0)) return;
    const controller = new AbortController();
    // The loan application is rendered from the saved data instead of having a history row.
    void getClient(accountId, operation.client_id, controller.signal).then(client => {
      if (!controller.signal.aborted && !loanApplicationDocumentState(client, operation).blocked) {
        setLoanGeneratedFor(loanScope);
      }
    }).catch(() => {
      // Download remains available and reports its own error if readiness couldn't be checked.
    });
    return () => controller.abort();
  }, [accountId, loanScope, operation]);

  async function generateLoanApplication(format: "docx" | "pdf") {
    if (loanRequest.current) return;
    const controller = new AbortController();
    loanRequest.current = controller;
    loanFormatSheet.current?.close();
    setLoanFailure("");
    setLoanBusy(true);
    try {
      const blob = await getLoanApplicationDocument(accountId, operation.id, format, controller.signal);
      if (await isActiveAccount(accountId) && !controller.signal.aborted) {
        downloadBlob(blob, loanApplicationFilename(operation, format));
        setLoanGeneratedFor(loanScope);
      }
    } catch (error) {
      if (!controller.signal.aborted) setLoanFailure(clientErrorMessage(error, "No se pudo generar la solicitud de préstamo. Intenta de nuevo."));
    } finally {
      if (loanRequest.current === controller) loanRequest.current = null;
      if (!controller.signal.aborted) setLoanBusy(false);
    }
  }

  const [request, setRequest] = useState<{ type: DocumentType }>();
  const [failure, setFailure] = useState<{ request: NonNullable<typeof request>; message: string; kind: "error" | "missing" | "ambiguous" }>();
  const currentFailure = failure?.request === request ? failure : undefined;
  const loading = request && !currentFailure;
  const failureNotice = useRef<HTMLParagraphElement>(null);
  const companyId = operation.company_id;
  const { state: accessState } = usePortalAccess();
  // Only the company's billing admins may upload templates.
  const canUploadTemplates = canManageCompanyBilling(accessState.kind === "ready" ? accessState.identity : null, companyId);
  const [history, setHistory] = useState<{ types: Set<DocumentType>; unavailable: boolean }>();
  const [historyAttempt, setHistoryAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    const types = new Set<DocumentType>();
    const perPage = 100;
    async function loadHistory() {
      for (let page = 1; !signal.aborted; page += 1) {
        const { items, total } = await listGeneratedDocuments(accountId, {
          page, perPage, search: "", format: "all", period: "any", operationId: operation.id,
        }, signal);
        for (const record of items) {
          const type = record.documentType ? getDocumentType(record.documentType) : documentTypeFromName(record.contractName);
          if (type) types.add(type.id);
        }
        if (!items.length || page * perPage >= total || types.size === DOCUMENT_TYPES.length) break;
      }
      if (!signal.aborted) setHistory({ types, unavailable: false });
    }
    void loadHistory().catch(() => {
      if (!signal.aborted) setHistory({ types, unavailable: true });
    });
    return () => controller.abort();
  }, [accountId, historyAttempt, operation.id]);

  useEffect(() => {
    if (!request) return;
    const controller = new AbortController();
    const { type } = request;
    listDocumentTemplates(accountId, companyId, type, controller.signal)
      .then(templates => {
        if (controller.signal.aborted) return;
        const resolved = resolveDocumentTemplate(templates, accountId, companyId, type);
        if (resolved.kind === "ready") {
          router.push(generateFromOperationHref(resolved.contract.id, companyId, operation.client_id, operation.id, type));
          return;
        }
        setFailure({ request, kind: resolved.kind, message: resolved.kind === "missing"
          ? "La empresa necesita una plantilla de Word compatible con este documento."
          : "Hay varias plantillas compatibles. Revisa las plantillas de la empresa para identificar la que corresponde a este documento." });
      })
      .catch(error => {
        if (!controller.signal.aborted) setFailure({ request, kind: "error", message: clientErrorMessage(error, "No se pudo cargar la plantilla de Word.") });
      });
    return () => controller.abort();
  }, [accountId, companyId, operation.client_id, operation.id, request, router]);

  useEffect(() => { if (currentFailure) failureNotice.current?.focus(); }, [currentFailure]);

  if (loading) return <LoadingContent label={`Cargando ${getDocumentType(request.type)?.label ?? "documento"}…`}><DocumentOptionsSkeleton /></LoadingContent>;

  const demo = currentFailure && demos[currentFailure.request.type];
  return <div className={styles.stack}>
    {history?.unavailable && <div className={styles.header}>
      <p className={styles.muted} role="status">No se pudo comprobar todo el historial de este expediente.</p>
      <Button type="button" variant="secondary" onClick={() => { setHistory(undefined); setHistoryAttempt(value => value + 1); }}>Reintentar historial</Button>
    </div>}
    {currentFailure && <div className={styles.stack}>
      <p ref={failureNotice} tabIndex={-1} className={styles.failure} role="alert">{currentFailure.message}</p>
      <div className={styles.actions}>
        {currentFailure.kind === "missing" && canUploadTemplates && <Link href={`/contratos/nuevo?${new URLSearchParams({ company_id: companyId })}`}>Cargar plantilla</Link>}
        {currentFailure.kind === "ambiguous" && <Link href="/contratos">Ver plantillas</Link>}
        {demo && currentFailure.kind === "missing" && <a href={demo} download>Descargar Word de demostración</a>}
        <Button type="button" variant="secondary" onClick={() => setRequest({ type: currentFailure.request.type })}>Reintentar</Button>
      </div>
    </div>}
    {loanFailure && <p className={styles.failure} role="alert">{loanFailure}</p>}
    <span className={styles.loanGenerationStatus} role="status">{loanBusy ? "Generando solicitud de préstamo…" : ""}</span>
    <div className={styles.documentGrid} data-tour="document-type">
      <button className={`${button.button} ${button.secondary} ${styles.documentChoice}`} type="button"
        aria-haspopup="dialog" aria-busy={loanBusy || undefined} aria-disabled={loanBusy || undefined}
        onClick={() => { if (!loanRequest.current) loanFormatSheet.current?.showModal(); }}>
        <span className={styles.documentIcon}><FileText size={22} aria-hidden="true" /></span>
        <span className={styles.documentLabel}>Solicitud de préstamo</span>
        <span className={styles.documentStatus}>
          {loanBusy ? <span aria-hidden="true">Generando…</span> : loanGeneratedFor === loanScope &&
            <Badge tone="success" size="sm" pill icon={<Check size={13} aria-hidden="true" />}>Ya generado</Badge>}
        </span>
      </button>
      {DOCUMENT_TYPES.map(({ id, label }) => {
        const Icon = icons[id];
        const generated = history?.types.has(id);
        return <button key={id} className={`${button.button} ${button.secondary} ${styles.documentChoice}`} type="button" onClick={() => setRequest({ type: id })}>
          <span className={styles.documentIcon}><Icon size={22} aria-hidden="true" /></span>
          <span className={styles.documentLabel}>{label}</span>
          <span className={styles.documentStatus}>
            {generated && <Badge tone="success" size="sm" pill icon={<Check size={13} aria-hidden="true" />}>Ya generado</Badge>}
          </span>
        </button>;
      })}
    </div>
    <dialog ref={loanFormatSheet} className={styles.formatSheet} aria-labelledby={loanFormatTitle}
      onClick={event => { if (event.target === event.currentTarget) event.currentTarget.close(); }}>
      <div className={styles.formatSheetBody}>
        <span className={styles.formatSheetHandle} aria-hidden="true" />
        <h2 id={loanFormatTitle}>Formato de la solicitud de préstamo</h2>
        <div className={styles.formatChoice}>
          <button type="button" className={`${styles.formatButton} ${styles.formatWord}`} onClick={() => void generateLoanApplication("docx")}>
            <FileText size={22} aria-hidden="true" />
            <span><strong>Word</strong><small>.docx editable</small></span>
          </button>
          <button type="button" className={`${styles.formatButton} ${styles.formatPdf}`} onClick={() => void generateLoanApplication("pdf")}>
            <FileType2 size={22} aria-hidden="true" />
            <span><strong>PDF</strong><small>.pdf listo para imprimir</small></span>
          </button>
        </div>
        <Button type="button" variant="secondary" onClick={() => loanFormatSheet.current?.close()}>Cancelar</Button>
      </div>
    </dialog>
  </div>;
}
