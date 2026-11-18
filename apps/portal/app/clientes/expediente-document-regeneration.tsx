"use client";

import { useEffect, useId, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { AlertCircle, CheckCircle2, Files } from "lucide-react";
import { Button } from "@/components/arc/button/button";
import { Input } from "@/components/arc/input/input";
import { Textarea } from "@/components/arc/textarea/textarea";
import { generateInitialExpedienteDocuments, type BatchProgress } from "@/app/contratos/batch-document-generation";
import { downloadBlob } from "@/app/contratos/document-export";
import { listGeneratedDocuments, type GeneratedDocumentMetadata } from "@/app/contratos/generated-documents-api";
import { parseAmountMinor } from "./amount-input";
import { clientErrorMessage, getClient, getExpediente, getLoanApplicationDocument, loanApplicationFilename } from "./clients-api";
import { ExpedienteGenerationStage } from "./expediente-generation-stage";
import styles from "./clients.module.css";

type ManualData = { distribution: string; balance: string; balanceDate: string };
type Pending = { documents: readonly GeneratedDocumentMetadata[]; loan: boolean };
type Preparation = { blob: Blob; filename: string };
type Report = {
  generated: number;
  failures: { label: string; message: string }[];
  pending: Pending;
  loan?: Preparation;
};
type Prompt = { field: "distribution" | "balance"; resolve: (data: ManualData) => void };
const noManualData = { distribution: "", balance: "", balanceDate: "" };

async function issuedDocuments(accountId: string, operationId: string, signal: AbortSignal) {
  const documents = new Map<string, GeneratedDocumentMetadata>();
  for (let page = 1; ; page++) {
    const perPage = 100;
    const { items, total } = await listGeneratedDocuments(accountId, {
      page, perPage, search: "", format: "all", period: "any", operationId,
    }, signal);
    for (const item of items) {
      const key = `${item.contractId}:${item.format}`;
      if (!documents.has(key)) documents.set(key, item);
    }
    if (!items.length || page * perPage >= total) return [...documents.values()];
  }
}

export function ExpedienteDocumentRegeneration({ accountId, clientId, operationId, hasLoan, disabled, onRefreshed }: {
  accountId: string;
  clientId: string;
  operationId: string;
  hasLoan: boolean;
  disabled: boolean;
  onRefreshed: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const active = useRef<AbortController | null>(null);
  const manualData = useRef<ManualData>(noManualData);
  const title = useId();
  const description = useId();
  const reducedMotion = useReducedMotion();
  const [preparingLoan, setPreparingLoan] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<BatchProgress | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [notice, setNotice] = useState("");
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [draft, setDraft] = useState<ManualData>(noManualData);
  const [fatal, setFatal] = useState("");

  useEffect(() => () => active.current?.abort(), []);

  function requestManualData(field: Prompt["field"], signal: AbortSignal) {
    signal.throwIfAborted();
    return new Promise<ManualData>((resolve, reject) => {
      const abort = () => reject(signal.reason);
      signal.addEventListener("abort", abort, { once: true });
      setDraft(manualData.current);
      setPrompt({ field, resolve(data) {
        signal.removeEventListener("abort", abort);
        manualData.current = data;
        setPrompt(null);
        resolve(data);
      } });
    });
  }

  async function regenerate(only?: Pending) {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    const { signal } = controller;
    const prior = only ? report : null;
    if (!only) manualData.current = noManualData;
    setBusy(true);
    setReport(null);
    setNotice("");
    setFatal("");
    setProgress(null);
    try {
      const [client, operation, documents] = await Promise.all([
        getClient(accountId, clientId, signal),
        getExpediente(accountId, operationId, signal),
        only?.documents ?? issuedDocuments(accountId, operationId, signal),
      ]);
      signal.throwIfAborted();
      if (operation.client_id !== client.id) throw new Error("El expediente no está disponible.");

      const outcome = documents.length ? await generateInitialExpedienteDocuments({
        accountId, client, operation, preferredFormat: "docx", signal,
        regenerationDocuments: documents,
        requestDisbursementDistribution: async signal =>
          manualData.current.distribution || (await requestManualData("distribution", signal)).distribution,
        requestConfirmedBalance: async signal => {
          const data = manualData.current.balanceDate ? manualData.current : await requestManualData("balance", signal);
          return { confirmedBalanceMinor: parseAmountMinor(data.balance)!, balanceDate: data.balanceDate };
        },
        onProgress: setProgress,
      }) : null;
      signal.throwIfAborted();

      const failures = outcome?.failed.map(({ label, message }) => ({ label, message })) ?? [];
      const failedIds = new Set(outcome?.failed.map(item => item.savedDocumentId));
      const pending = { documents: documents.filter(document => failedIds.has(document.id)), loan: false };
      let loan = prior?.loan;
      if (only?.loan ?? hasLoan) {
        setPreparingLoan(true);
        try {
          const blob = await getLoanApplicationDocument(accountId, operationId, "docx", signal);
          loan = { blob, filename: loanApplicationFilename(operation, "docx") };
        } catch (error) {
          signal.throwIfAborted();
          pending.loan = true;
          failures.push({ label: "Solicitud de préstamo", message: clientErrorMessage(error, "No se pudo preparar la solicitud.") });
        }
      }
      signal.throwIfAborted();
      setReport({ generated: (prior?.generated ?? 0) + (outcome?.generated.length ?? 0), failures, pending, loan });
    } catch (error) {
      if (signal.aborted) {
        if (dialog.current?.open) setNotice("Regeneración cancelada.");
      } else {
        setReport(prior);
        setFatal(clientErrorMessage(error, "No se pudieron regenerar los documentos."));
      }
    } finally {
      if (active.current === controller) active.current = null;
      if (dialog.current) {
        setBusy(false);
        setPreparingLoan(false);
        setPrompt(null);
        onRefreshed();
      }
    }
  }

  const balance = parseAmountMinor(draft.balance);
  const validPrompt = prompt?.field === "distribution"
    ? Boolean(draft.distribution.trim())
    : balance !== undefined && Boolean(draft.balanceDate);
  const canRetry = report && (report.pending.documents.length > 0 || report.pending.loan);

  return <>
    <Button type="button" variant="secondary" disabled={disabled || busy} aria-haspopup="dialog"
      onClick={() => {
        setReport(null);
        setFatal("");
        setNotice("");
        dialog.current?.showModal();
      }}>Regenerar todos</Button>
    <dialog ref={dialog} className={`${styles.formatSheet} ${styles.regenerationDialog}`} aria-labelledby={title} aria-describedby={description}
      onCancel={event => { if (busy) event.preventDefault(); }}>
      <div className={styles.formatSheetBody}>
        <header className={styles.regenerationHeading}>
          <span aria-hidden="true"><Files size={22} /></span>
          <div>
            <h2 id={title}>Regenerar documentos</h2>
            <p id={description} className={styles.muted}>
              Genera nuevas versiones con los datos guardados en el expediente.
            </p>
          </div>
        </header>
        {prompt ? <form className={styles.stack} onSubmit={event => {
          event.preventDefault();
          if (validPrompt) prompt.resolve({ ...draft, distribution: draft.distribution.trim() });
        }}>
          {prompt.field === "distribution" ? <Textarea label="Distribución del desembolso" rows={3} required
            description="Indica los destinatarios y los montos."
            value={draft.distribution} onChange={event => setDraft({ ...draft, distribution: event.target.value })} /> : <>
            <Input label="Saldo confirmado (RD$)" inputMode="decimal" required autoComplete="off"
              value={draft.balance} onChange={event => setDraft({ ...draft, balance: event.target.value })} />
            <Input label="Fecha del saldo confirmado" type="date" required value={draft.balanceDate}
              onChange={event => setDraft({ ...draft, balanceDate: event.target.value })} />
          </>}
          <div className={styles.actions}>
            <Button type="button" variant="secondary" onClick={() => active.current?.abort()}>Cancelar</Button>
            <Button type="submit" disabled={!validPrompt}>Continuar</Button>
          </div>
        </form> : busy ? <ExpedienteGenerationStage
          phase={!preparingLoan && progress && progress.phase !== "preparing" ? "generating" : "preparing"}
          preferredFormat="docx" progress={progress} clientName=""
          regenerating preparingLoan={preparingLoan}
        /> : <>
          {notice && <p role="status">{notice}</p>}
          {fatal && <p className={styles.failure} role="alert">{fatal}</p>}
          {report && <motion.div className={styles.regenerationResult}
            initial={reducedMotion ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }} transition={{ duration: reducedMotion ? 0 : 0.22 }}>
            <p role="status" className={styles.regenerationSummary}>
              {report.failures.length ? <AlertCircle size={22} aria-hidden="true" />
                : report.generated || report.loan ? <CheckCircle2 size={22} aria-hidden="true" /> : <Files size={22} aria-hidden="true" />}
              <span>
                {report.generated > 0 ? `${report.generated} ${report.generated === 1 ? "documento regenerado" : "documentos regenerados"}.` : report.failures.length
                  ? "Revisa los documentos pendientes."
                  : report.loan ? "Solicitud de préstamo lista." : "Aún no hay documentos emitidos."}
              </span>
            </p>
            {report.failures.length > 0 && <ul className={styles.regenerationFailures} aria-label="Documentos pendientes">
              {report.failures.map((item, index) => <li key={index}><strong>{item.label}</strong><br />{item.message}</li>)}
            </ul>}
          </motion.div>}
          <div className={styles.actions}>
            <Button type="button" variant="secondary" onClick={() => dialog.current?.close()}>{report || fatal ? "Cerrar" : "Cancelar"}</Button>
            {report?.loan && <Button type="button" variant="secondary"
              onClick={() => { if (report.loan) downloadBlob(report.loan.blob, report.loan.filename); }}>
              Descargar solicitud en Word
            </Button>}
            {(!report || canRetry) && <Button type="button" onClick={() => void regenerate(report?.pending)}>
              {canRetry ? "Reintentar pendientes" : "Regenerar todos"}
            </Button>}
          </div>
        </>}
      </div>
    </dialog>
  </>;
}
