"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/arc/button/button";
import { Input } from "@/components/arc/input/input";
import { Select } from "@/components/arc/select/select";
import { PortalShell } from "@/components/portal-shell/portal-shell";
import { downloadBlob } from "@/app/contratos/document-export";
import { ApiError, isActiveAccount } from "@/lib/api";
import { usePortalAccess } from "@/lib/portal-access";
import { billingError, getBilling, prepareRenewal, reportTransfer, type BankAccount, type BillingInvoice, type BillingOverview } from "./billing-api";
import { BillingDialog, billingAmount, billingDate, invoicePeriod, InvoiceBreakdown, InvoiceStatus, lastBillingMonth, prepareInvoicePdf } from "./billing-presentation";
import styles from "./billing.module.css";

type TransferDraft = { reference: string; duration: number };
const emptyTransfer: TransferDraft = { reference: "", duration: 1 };

export function Billing() {
  const { state } = usePortalAccess();
  const identity = state.kind === "ready" ? state.identity : null;
  return (
    <PortalShell currentPage="/facturacion" title="Membresía" description="Consulta tu suscripción a YZY Contracts y el historial de tus pagos.">
      {identity?.can_manage_billing === true && <BillingWorkspace key={identity.id} accountId={identity.id} />}
    </PortalShell>
  );
}

function BillingWorkspace({ accountId }: { accountId: string }) {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ attempt: number; billing: BillingOverview } | { attempt: number; error: string } | null>(null);
  const [paymentId, setPaymentId] = useState<string | null>(null);
  const [detailsId, setDetailsId] = useState<string | null>(null);
  const [transferBusy, setTransferBusy] = useState(false);
  const [transferDrafts, setTransferDrafts] = useState<Record<string, TransferDraft>>({});
  const [preparing, setPreparing] = useState<string | null>(null);
  const [renewalError, setRenewalError] = useState("");
  const [notice, setNotice] = useState("");
  const transferHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const request = new AbortController();
    getBilling(accountId, request.signal).then(billing => {
      if (!request.signal.aborted) setResult({ attempt, billing });
    }).catch((error: unknown) => {
      if (!request.signal.aborted) setResult({ attempt, error: billingError(error, "No se pudo cargar la membresía. Intenta de nuevo.") });
    });
    return () => request.abort();
  }, [accountId, attempt]);

  const current = result;
  const refreshing = current !== null && current.attempt !== attempt;
  if (!current) return <p className={styles.muted} role="status">Cargando membresía…</p>;
  if ("error" in current) return <div className={styles.retry}>
    <p className={styles.error} role="alert">{current.error}</p>
    <Button type="button" variant="secondary" loading={refreshing} disabled={refreshing} onClick={() => setAttempt(value => value + 1)}>Reintentar</Button>
  </div>;

  const { accounts, invoices, bank_account: bankAccount } = current.billing;
  const payment = invoices.find(invoice => invoice.id === paymentId && invoice.state === "pending")
    ?? invoices.filter(invoice => invoice.state === "pending").sort((a, b) => a.due_on.localeCompare(b.due_on))[0];
  const details = invoices.find(invoice => invoice.id === detailsId);
  const overdue = invoices.some(invoice => invoice.is_overdue && invoice.state !== "paid");

  async function startRenewal(billingAccountId: string) {
    if (preparing || refreshing || transferBusy) return;
    setPreparing(billingAccountId);
    setRenewalError("");
    try {
      const invoice = await prepareRenewal(accountId, billingAccountId);
      setResult(previous => previous && "billing" in previous ? {
        ...previous, billing: {
          ...previous.billing,
          invoices: [invoice, ...previous.billing.invoices.filter(item => item.id !== invoice.id)]
            .sort((a, b) => b.period.localeCompare(a.period)),
        },
      } : previous);
      setPaymentId(invoice.id);
      transferHeading.current?.focus();
    } catch (failure) {
      setRenewalError(billingError(failure, "No se pudo preparar la renovación. Intenta de nuevo."));
    } finally {
      setPreparing(null);
    }
  }

  function transferReported(updated: BillingInvoice) {
    const lastPeriod = lastBillingMonth(updated.period, updated.months ?? 1);
    setResult(previous => previous && "billing" in previous ? {
      ...previous, billing: {
        ...previous.billing,
        invoices: previous.billing.invoices
          .filter(invoice => invoice.account_id !== updated.account_id || invoice.period <= updated.period || invoice.period > lastPeriod)
          .map(invoice => invoice.id === updated.id ? updated : invoice),
      },
    } : previous);
    setTransferDrafts(previous => {
      const next = { ...previous };
      delete next[updated.id];
      return next;
    });
    setPaymentId(null);
    setNotice("Transferencia reportada. Puedes consultar aquí el resultado de la revisión.");
    transferHeading.current?.focus();
  }

  return (
    <div className={styles.workspace}>
      {overdue && <p className={`${styles.notice} ${styles.warning}`}>
        Hay facturas vencidas. Las funciones de trabajo de las empresas bloqueadas se reactivarán al confirmar el pago pendiente.
      </p>}
      {notice && <p className={styles.notice} role="status">{notice}</p>}
      {renewalError && <p className={styles.error} role="alert">{renewalError}</p>}
      <div className={styles.membershipGrid} data-payment={payment ? "pending" : "none"}>
        <section className={`${styles.panel} ${styles.membershipTransfer}`} aria-labelledby="bank-transfer-title">
          <div className={styles.membershipHeader}>
            <h2 id="bank-transfer-title" tabIndex={-1} ref={transferHeading}>Transferencia bancaria</h2>
            <p className={styles.muted}>Registra el pago de tu membresía con la referencia del comprobante bancario.</p>
          </div>
          {payment ? <TransferForm key={payment.id} accountId={accountId} invoice={payment} bankAccount={bankAccount}
            draft={transferDrafts[payment.id] ?? emptyTransfer}
            refreshing={refreshing || Boolean(preparing)} onBusyChange={setTransferBusy} onReported={transferReported}
            onDraftChange={draft => setTransferDrafts(previous => ({ ...previous, [payment.id]: draft }))}
            onRefresh={() => setAttempt(value => value + 1)} />
            : <p className={styles.muted}>No tienes facturas pendientes de pago.</p>}
        </section>
        <div className={styles.membershipSidebar}>
          {accounts.map(account => <section className={styles.panel} key={account.id} aria-labelledby={`billing-account-${account.id}`}>
            <h2 id={`billing-account-${account.id}`}>{account.name}</h2>
            <div>
              <p className={styles.amount}>{billingAmount(account.monthly_total_minor)}</p>
              <p className={styles.muted}>Total mensual · Desde el {billingDate(account.starts_on)}</p>
            </div>
            {account.companies.length > 0 ? <>
              <p className={styles.muted}>{account.companies.length === 1 ? "1 empresa incluida" : `${account.companies.length} empresas incluidas`}
                {` · ${billingAmount(account.monthly_total_minor / account.companies.length)} por empresa`}</p>
              <ul className={styles.companyList} aria-label="Empresas incluidas">
                {account.companies.map(company => <li key={company.id}>{company.name}</li>)}
              </ul>
              {bankAccount && !invoices.some(invoice => invoice.account_id === account.id && invoice.state !== "paid") &&
                <div className={styles.actions}>
                  <Button type="button" variant="secondary" loading={preparing === account.id}
                    disabled={Boolean(preparing) || refreshing || transferBusy}
                    aria-label={`Renovar membresía de ${account.name}`} onClick={() => void startRenewal(account.id)}>Renovar membresía</Button>
                </div>}
            </> : <p className={styles.muted}>Esta cuenta aún no tiene empresas incluidas.</p>}
          </section>)}
          <section className={styles.panel} aria-labelledby="bank-information-title">
            <div className={styles.membershipHeader}>
              <h2 id="bank-information-title">Datos bancarios</h2>
              {bankAccount && <p className={styles.muted}>Usa esta cuenta para pagar tu membresía.</p>}
            </div>
            {bankAccount ? <dl className={styles.bankDetails}>
              <div><dt>Banco</dt><dd>{bankAccount.bank_name}</dd></div>
              <div><dt>Titular</dt><dd>{bankAccount.account_holder}</dd></div>
              <div><dt>Tipo de cuenta</dt><dd>{bankAccount.account_type}</dd></div>
              <div><dt>Número de cuenta</dt><dd translate="no">{bankAccount.account_number}</dd></div>
            </dl> : <p className={styles.muted}>Los datos bancarios aún no están disponibles. Contacta con YZY Labs para coordinar el pago.</p>}
          </section>
        </div>
        <section className={`${styles.panel} ${styles.membershipHistory}`} aria-labelledby="billing-invoices-title">
          <div className={styles.panelHeader}>
            <h2 id="billing-invoices-title">Historial de pagos y facturas</h2>
            <Button type="button" variant="secondary" loading={refreshing} disabled={refreshing || transferBusy || Boolean(preparing)} onClick={() => { setNotice(""); setRenewalError(""); setAttempt(value => value + 1); }}>Actualizar</Button>
          </div>
          {invoices.length ? <div className={styles.tableScroll} role="region" aria-label="Historial de facturas" tabIndex={0}>
            <table className={`${styles.table} ${styles.customerTable}`}>
              <thead><tr>
                <th scope="col">Período</th><th scope="col" className={styles.fullDetail}>Vencimiento</th><th scope="col">Estado</th>
                <th scope="col" className={`${styles.fullDetail} ${styles.numeric}`}>Monto</th><th scope="col" className={styles.rowAction}>Acciones</th>
              </tr></thead>
              <tbody>{invoices.map(invoice => {
                const payable = invoice.state === "pending" && bankAccount !== null;
                const action = payable ? "Pagar factura" : "Ver factura";
                return <tr key={invoice.id}>
                  <th scope="row">{invoicePeriod(invoice)}<br /><span className={styles.muted}>{invoice.account_name}</span>
                    <span className={styles.compactDetail}>{billingAmount(invoice.total_minor)}</span>
                    <span className={`${styles.compactDetail} ${styles.muted}`}>Vence el <time dateTime={invoice.due_on}>{billingDate(invoice.due_on)}</time></span>
                  </th>
                  <td className={styles.fullDetail}><time dateTime={invoice.due_on}>{billingDate(invoice.due_on)}</time></td>
                  <td><InvoiceStatus invoice={invoice} /></td>
                  <td className={`${styles.fullDetail} ${styles.numeric}`}>{billingAmount(invoice.total_minor)}</td>
                  <td className={styles.rowAction}><Button type="button" variant="secondary" aria-haspopup={payable ? undefined : "dialog"} disabled={refreshing || transferBusy}
                    aria-label={`${action} de ${invoice.account_name}, ${invoicePeriod(invoice)}`}
                    onClick={() => {
                      if (payable) {
                        setPaymentId(invoice.id);
                        transferHeading.current?.focus();
                      } else {
                        setDetailsId(invoice.id);
                      }
                    }}>{action}</Button></td>
                </tr>;
              })}</tbody>
            </table>
          </div> : <p className={styles.muted}>Aún no hay facturas emitidas.</p>}
        </section>
      </div>
      {details && <InvoiceDialog key={details.id} accountId={accountId} invoice={details}
        onClose={() => setDetailsId(null)} />}
    </div>
  );
}

const durations = Array.from({ length: 12 }, (_, index) => ({
  value: String(index + 1),
  label: index === 0 ? "1 mes" : `${index + 1} meses`,
}));

function TransferForm({ accountId, invoice, bankAccount, draft, refreshing, onDraftChange, onBusyChange, onReported, onRefresh }: {
  accountId: string; invoice: BillingInvoice; bankAccount: BankAccount | null;
  draft: TransferDraft; onDraftChange: (draft: TransferDraft) => void; onRefresh: () => void;
  refreshing: boolean; onBusyChange: (busy: boolean) => void; onReported: (invoice: BillingInvoice) => void;
}) {
  const { reference, duration } = draft;
  const [referenceError, setReferenceError] = useState("");
  const [problem, setProblem] = useState<{ message: string; requiresRefresh: boolean }>();
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const monthLimit = bankAccount ? invoice.renewal_month_limit ?? 1 : 1;
  const months = Math.min(duration, monthLimit);
  const subtotal = invoice.total_minor * months;
  const discount = months > 1 ? Math.floor(subtotal / 10) : 0;
  const preview = { ...invoice, months, discount_minor: discount, total_minor: subtotal - discount };

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!bankAccount || refreshing || sending.current || problem?.requiresRefresh) return;
    if (!reference.trim()) {
      setReferenceError("Ingresa la referencia que aparece en tu comprobante bancario.");
      input.current?.focus();
      return;
    }
    sending.current = true;
    setBusy(true);
    onBusyChange(true);
    setReferenceError("");
    setProblem(undefined);
    try {
      onReported(await reportTransfer(accountId, invoice.id, reference.trim(), months, preview.total_minor));
    } catch (failure) {
      setProblem({
        message: billingError(failure, "No se pudo reportar la transferencia. Intenta de nuevo."),
        requiresRefresh: failure instanceof ApiError && (failure.code === "BILLING_CONFLICT" || failure.status === 404),
      });
    } finally {
      sending.current = false;
      setBusy(false);
      onBusyChange(false);
    }
  }

  return (
    <form className={styles.form} onSubmit={event => void submit(event)} noValidate>
      <div className={styles.paymentSection}>
        <h3>{monthLimit > 1 ? "Renovar membresía" : "Datos de la membresía"}</h3>
        <div className={styles.paymentMeta}>
          <strong>{invoice.account_name}</strong>
          <span className={styles.muted}>Vencimiento de la primera cuota: <time dateTime={invoice.due_on}>{billingDate(invoice.due_on)}</time></span>
        </div>
        {monthLimit > 1 && <Select label="Duración" value={String(months)}
          options={durations.map((option, index) => ({ ...option, disabled: index >= monthLimit }))}
          disabled={busy || refreshing} description="Ahorra un 10 % al pagar de 2 a 12 meses por adelantado."
          onValueChange={value => onDraftChange({ ...draft, duration: Number(value) })} />}
        <div aria-live="polite">
          <p className={styles.muted}>Período: {invoicePeriod(preview)}</p>
          <InvoiceBreakdown invoice={preview} totalLabel="Total a transferir" />
        </div>
      </div>
      {bankAccount && <div className={styles.paymentSection}>
        <h3>Datos de la transferencia</h3>
        <p className={styles.transferMemo}>Concepto de pago <strong translate="no">{invoice.transfer_memo}</strong></p>
        <Input ref={input} label="Número de referencia" name="referencia" required maxLength={100} autoComplete="off"
          spellCheck={false} disabled={busy || refreshing} value={reference} error={referenceError}
          description="Escribe la referencia que aparece en tu comprobante después de hacer la transferencia."
          onChange={event => { onDraftChange({ ...draft, reference: event.target.value }); setReferenceError(""); }} />
      </div>}
      {problem && <div className={styles.retry}>
        <p className={styles.error} role="alert">{problem.message}</p>
        {problem.requiresRefresh && <Button type="button" variant="secondary" disabled={refreshing} onClick={() => {
          setProblem(undefined);
          onRefresh();
        }}>Actualizar factura</Button>}
      </div>}
      <div className={styles.actions}>
        <InvoiceDownload accountId={accountId} invoice={preview} summary={months > 1} disabled={busy || refreshing || problem?.requiresRefresh} />
        {bankAccount && <Button type="submit" loading={busy} disabled={busy || refreshing || problem?.requiresRefresh}>Reportar transferencia</Button>}
      </div>
    </form>
  );
}

function InvoiceDialog({ accountId, invoice, onClose }: {
  accountId: string; invoice: BillingInvoice; onClose: () => void;
}) {
  return (
    <BillingDialog title={`Factura de ${invoicePeriod(invoice)}`} busy={false} onClose={onClose}>
      <div className={styles.form}>
        <div className={styles.statusGroup}>
          <InvoiceStatus invoice={invoice} />
          <span className={styles.muted}>Vencimiento: {billingDate(invoice.due_on)}</span>
        </div>
        <InvoiceBreakdown invoice={invoice} />
        {invoice.state === "paid" && invoice.paid_at && <p className={styles.muted}>Pago confirmado el {billingDate(invoice.paid_at)}.</p>}
        {invoice.state === "in_review" && <p className={styles.muted}>Estamos revisando la transferencia {invoice.transfer_reference}.</p>}
        <div className={styles.actions}>
          <Button type="button" variant="secondary" onClick={onClose}>Cerrar</Button>
          <InvoiceDownload accountId={accountId} invoice={invoice} />
        </div>
      </div>
    </BillingDialog>
  );
}

function InvoiceDownload({ accountId, invoice, disabled = false, summary = false }: {
  accountId: string; invoice: BillingInvoice; disabled?: boolean; summary?: boolean;
}) {
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState("");

  async function download() {
    setDownloading(true);
    setDownloadError("");
    try {
      const file = await prepareInvoicePdf(invoice, summary);
      const prefix = summary ? "resumen-renovacion" : "factura";
      if (await isActiveAccount(accountId)) downloadBlob(file, `${prefix}-${invoice.period.slice(0, 7)}-${invoice.id}.pdf`);
    } catch {
      setDownloadError(summary ? "No se pudo descargar el resumen. Intenta de nuevo." : "No se pudo descargar la factura. Intenta de nuevo.");
    } finally {
      setDownloading(false);
    }
  }

  return <>
    <Button type="button" variant="secondary" loading={downloading} disabled={disabled || downloading} onClick={() => void download()}>
      {summary ? "Descargar resumen PDF" : "Descargar PDF"}
    </Button>
    {downloadError && <p className={`${styles.error} ${styles.actionError}`} role="alert">{downloadError}</p>}
  </>;
}
