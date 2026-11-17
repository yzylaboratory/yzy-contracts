"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Badge } from "@/components/arc/badge/badge";
import { Button } from "@/components/arc/button/button";
import { Input } from "@/components/arc/input/input";
import { Select } from "@/components/arc/select/select";
import { PortalShell } from "@/components/portal-shell/portal-shell";
import { downloadBlob } from "@/app/contratos/document-export";
import { ApiError, isActiveAccount } from "@/lib/api";
import { usePortalAccess } from "@/lib/portal-access";
import {
  billingError,
  getBilling,
  prepareRenewal,
  reportTransfer,
  type BankAccount,
  type BillingAccount,
  type BillingInvoice,
  type BillingOverview,
  type BillingPricing,
} from "./billing-api";
import {
  accountMembershipStatus,
  BillingDialog,
  billingAmount,
  billingDate,
  billingOverviewStatus,
  billingShortDate,
  billingUsdAmount,
  invoicePeriod,
  InvoiceBreakdown,
  InvoiceStatus,
  lastBillingMonth,
  prepareInvoicePdf,
} from "./billing-presentation";
import styles from "./billing.module.css";

type TransferDraft = { reference: string; duration: number };
type HistoryFilter = "all" | "pending" | "in_review" | "paid";
type PaymentStep = "invoice" | "transfer" | "confirmation";

const emptyTransfer: TransferDraft = { reference: "", duration: 1 };
const historyFilters: { value: HistoryFilter; label: string }[] = [
  { value: "all", label: "Todas" },
  { value: "pending", label: "Pendientes" },
  { value: "in_review", label: "En revisión" },
  { value: "paid", label: "Pagadas" },
];

export function Billing() {
  const { state } = usePortalAccess();
  const identity = state.kind === "ready" ? state.identity : null;
  return (
    <PortalShell
      currentPage="/facturacion"
      title="Membresías"
      description="Gestiona tus empresas, pagos y renovaciones."
    >
      {identity?.can_manage_billing === true && <BillingWorkspace key={identity.id} accountId={identity.id} />}
    </PortalShell>
  );
}

function BillingWorkspace({ accountId }: { accountId: string }) {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ attempt: number; billing: BillingOverview } | { attempt: number; error: string } | null>(null);
  const [paymentId, setPaymentId] = useState<string | null>(null);
  const [detailsId, setDetailsId] = useState<string | null>(null);
  const [accountDetailsId, setAccountDetailsId] = useState<string | null>(null);
  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>("all");
  const [transferBusy, setTransferBusy] = useState(false);
  const [transferDrafts, setTransferDrafts] = useState<Record<string, TransferDraft>>({});
  const [preparing, setPreparing] = useState<string | null>(null);
  const [renewalError, setRenewalError] = useState("");
  const [notice, setNotice] = useState("");

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

  const { accounts, invoices, bank_account: bankAccount, pricing } = current.billing;
  const payment = invoices.find(invoice => invoice.id === paymentId) ?? null;
  const details = invoices.find(invoice => invoice.id === detailsId) ?? null;
  const accountDetails = accounts.find(account => account.id === accountDetailsId) ?? null;
  const overdue = invoices.some(invoice => invoice.is_overdue && invoice.state !== "paid");
  const overview = billingOverviewStatus(invoices);
  const companyCount = accounts.reduce((total, account) => total + account.companies.length, 0);
  const monthlyTotal = accounts.reduce((total, account) => total + account.monthly_total_minor, 0);
  const pendingInvoices = invoices
    .filter(invoice => invoice.state === "pending")
    .sort((left, right) => left.due_on.localeCompare(right.due_on));
  const pendingTotal = pendingInvoices.reduce((total, invoice) => total + invoice.total_minor, 0);
  const filteredInvoices = historyFilter === "all"
    ? invoices
    : invoices.filter(invoice => invoice.state === historyFilter);

  async function startRenewal(billingAccountId: string) {
    if (preparing || refreshing || transferBusy) return;
    setPreparing(billingAccountId);
    setRenewalError("");
    try {
      const invoice = await prepareRenewal(accountId, billingAccountId);
      setResult(previous => previous && "billing" in previous ? {
        ...previous,
        billing: {
          ...previous.billing,
          invoices: [invoice, ...previous.billing.invoices.filter(item => item.id !== invoice.id)]
            .sort((left, right) => right.period.localeCompare(left.period)),
        },
      } : previous);
      setAccountDetailsId(null);
      setPaymentId(invoice.id);
    } catch (failure) {
      setRenewalError(billingError(failure, "No se pudo preparar la renovación. Intenta de nuevo."));
    } finally {
      setPreparing(null);
    }
  }

  function transferReported(updated: BillingInvoice) {
    const lastPeriod = lastBillingMonth(updated.period, updated.months ?? 1);
    setResult(previous => previous && "billing" in previous ? {
      ...previous,
      billing: {
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
    setNotice("Transferencia reportada. Puedes consultar aquí el resultado de la revisión.");
  }

  return (
    <div className={styles.workspace}>
      {overdue && <p className={`${styles.notice} ${styles.warning}`}>
        Hay facturas vencidas. Las funciones de trabajo de las empresas bloqueadas se reactivarán al confirmar el pago pendiente.
      </p>}
      {notice && <p className={styles.notice} role="status">{notice}</p>}
      {renewalError && <p className={styles.error} role="alert">{renewalError}</p>}

      <section className={styles.panel} aria-labelledby="billing-summary-title">
        <div className={styles.summaryHeader}>
          <div>
            <h2 id="billing-summary-title">Membresías</h2>
            <p className={styles.muted}>Gestiona tus empresas, pagos y renovaciones.</p>
          </div>
          <Badge tone={overview.tone} dot>{overview.label}</Badge>
        </div>
        <div className={styles.summaryGrid}>
          <div>
            <p className={styles.summaryLabel}>Empresas</p>
            <p className={styles.summaryValue}>{companyCount} {companyCount === 1 ? "Registrada" : "Registradas"}</p>
          </div>
          <div>
            <p className={styles.summaryLabel}>Total mensual</p>
            <p className={styles.summaryValue}>{billingAmount(monthlyTotal)}</p>
            <p className={styles.muted}>{accounts.length === 1 ? "1 membresía" : `${accounts.length} membresías`}</p>
          </div>
          <div>
            <p className={styles.summaryLabel}>Pendiente</p>
            <p className={styles.summaryValue}>{billingAmount(pendingTotal)}</p>
            <p className={styles.muted}>
              {pendingInvoices.length === 0
                ? "Sin facturas"
                : pendingInvoices.length === 1
                  ? "1 factura"
                  : `${pendingInvoices.length} facturas`}
            </p>
          </div>
        </div>
      </section>

      <section className={styles.panel} aria-labelledby="billing-memberships-title">
        <div className={styles.panelHeader}>
          <h2 id="billing-memberships-title">Tus membresías</h2>
        </div>
        {accounts.length ? (
          <ul className={styles.membershipList}>
            {accounts.map(account => {
              const status = accountMembershipStatus(account, invoices);
              const companyLabel = account.companies.length === 1
                ? "1 empresa"
                : `${account.companies.length} empresas`;
              return (
                <li key={account.id} className={styles.membershipRow}>
                  <div className={styles.membershipIcon} aria-hidden="true">
                    <BuildingIcon />
                  </div>
                  <div className={styles.membershipBody}>
                    <div className={styles.membershipTitleRow}>
                      <strong>{account.name}</strong>
                      <Badge tone={status.tone} size="sm" dot>{status.label}</Badge>
                    </div>
                    <p className={styles.muted}>
                      {companyLabel}
                      {status.relevantOn
                        ? ` · ${status.relevantLabel} ${billingShortDate(status.relevantOn)}`
                        : ` · Desde ${billingShortDate(account.starts_on)}`}
                    </p>
                    {status.label === "Beneficio de entrada" && (
                      <p className={styles.offerNote}>
                        Incluye acceso hasta esa fecha. Luego {billingUsdAmount(
                          account.companies.reduce((total, company) => total + (company.price_usd_minor ?? pricing.price_usd_minor), 0),
                        )} /mes
                        {" "}({billingAmount(account.monthly_total_minor)} al tipo de cambio actual).
                      </p>
                    )}
                  </div>
                  <div className={styles.membershipMeta}>
                    <p className={styles.membershipPrice}>
                      {status.label === "Beneficio de entrada"
                        ? <>{billingUsdAmount(account.companies.reduce((total, company) => total + (company.price_usd_minor ?? pricing.price_usd_minor), 0))} <span>/mes después</span></>
                        : <>{billingAmount(account.monthly_total_minor)} <span>/mes</span></>}
                    </p>
                    <Button
                      type="button"
                      variant="secondary"
                      aria-haspopup="dialog"
                      disabled={refreshing || transferBusy || Boolean(preparing)}
                      onClick={() => setAccountDetailsId(account.id)}
                    >
                      Ver detalles
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className={styles.muted}>Todavía no tienes cuentas de facturación.</p>
        )}
      </section>

      <section className={styles.panel} aria-labelledby="billing-invoices-title">
        <div className={styles.panelHeader}>
          <div>
            <h2 id="billing-invoices-title">Facturación y pagos</h2>
            <p className={styles.muted}>Facturas pendientes, historial y comprobantes.</p>
          </div>
          <div className={styles.historyTools}>
            <Select
              label="Filtrar"
              value={historyFilter}
              options={historyFilters}
              disabled={refreshing || transferBusy}
              onValueChange={value => setHistoryFilter(value as HistoryFilter)}
            />
            <Button
              type="button"
              variant="secondary"
              loading={refreshing}
              disabled={refreshing || transferBusy || Boolean(preparing)}
              onClick={() => {
                setNotice("");
                setRenewalError("");
                setAttempt(value => value + 1);
              }}
            >
              Actualizar
            </Button>
          </div>
        </div>

        {pendingInvoices.length > 0 && (
          <div className={styles.pendingList} aria-label="Facturas pendientes">
            {pendingInvoices.map(invoice => (
              <div key={invoice.id} className={styles.pendingRow}>
                <div>
                  <strong>{invoice.account_name}</strong>
                  <p className={styles.muted}>{invoicePeriod(invoice)} · Vence el {billingShortDate(invoice.due_on)}</p>
                </div>
                <div className={styles.pendingMeta}>
                  <InvoiceStatus invoice={invoice} />
                  <p className={styles.membershipPrice}>{billingAmount(invoice.total_minor)}</p>
                  {bankAccount && (
                    <Button
                      type="button"
                      disabled={refreshing || transferBusy}
                      aria-label={`Pagar factura de ${invoice.account_name}, ${invoicePeriod(invoice)}`}
                      onClick={() => setPaymentId(invoice.id)}
                    >
                      Pagar factura
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {filteredInvoices.length ? (
          <div className={styles.tableScroll} role="region" aria-label="Historial de facturas" tabIndex={0}>
            <table className={`${styles.table} ${styles.customerTable}`}>
              <thead>
                <tr>
                  <th scope="col">Factura</th>
                  <th scope="col">Cuenta</th>
                  <th scope="col" className={styles.fullDetail}>Vencimiento</th>
                  <th scope="col" className={`${styles.fullDetail} ${styles.numeric}`}>Importe</th>
                  <th scope="col">Estado</th>
                  <th scope="col" className={styles.rowAction}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {filteredInvoices.map(invoice => {
                  const payable = invoice.state === "pending" && bankAccount !== null;
                  const action = payable ? "Pagar factura" : "Ver factura";
                  return (
                    <tr key={invoice.id}>
                      <th scope="row">
                        {invoicePeriod(invoice)}
                        <span className={styles.compactDetail}>{invoice.account_name}</span>
                        <span className={styles.compactDetail}>{billingAmount(invoice.total_minor)}</span>
                        <span className={`${styles.compactDetail} ${styles.muted}`}>
                          Vence el <time dateTime={invoice.due_on}>{billingShortDate(invoice.due_on)}</time>
                        </span>
                      </th>
                      <td>{invoice.account_name}</td>
                      <td className={styles.fullDetail}>
                        <time dateTime={invoice.due_on}>{billingDate(invoice.due_on)}</time>
                      </td>
                      <td className={`${styles.fullDetail} ${styles.numeric}`}>{billingAmount(invoice.total_minor)}</td>
                      <td><InvoiceStatus invoice={invoice} /></td>
                      <td className={styles.rowAction}>
                        <Button
                          type="button"
                          variant="secondary"
                          aria-haspopup="dialog"
                          disabled={refreshing || transferBusy}
                          aria-label={`${action} de ${invoice.account_name}, ${invoicePeriod(invoice)}`}
                          onClick={() => {
                            if (payable) setPaymentId(invoice.id);
                            else setDetailsId(invoice.id);
                          }}
                        >
                          {action}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className={styles.emptyState}>
            <ReceiptIcon />
            <p><strong>Todavía no hay facturas</strong></p>
            <p className={styles.muted}>
              {historyFilter === "all"
                ? "Cuando se emitan facturas, aparecerán aquí junto con sus estados y comprobantes."
                : "No hay facturas con este filtro."}
            </p>
          </div>
        )}
      </section>

      {payment && (
        <PaymentDialog
          key={payment.id}
          accountId={accountId}
          invoice={payment}
          bankAccount={bankAccount}
          draft={transferDrafts[payment.id] ?? emptyTransfer}
          refreshing={refreshing || Boolean(preparing)}
          onBusyChange={setTransferBusy}
          onDraftChange={draft => setTransferDrafts(previous => ({ ...previous, [payment.id]: draft }))}
          onReported={transferReported}
          onRefresh={() => setAttempt(value => value + 1)}
          onClose={() => setPaymentId(null)}
        />
      )}
      {details && (
        <InvoiceDialog
          key={details.id}
          accountId={accountId}
          invoice={details}
          onClose={() => setDetailsId(null)}
        />
      )}
      {accountDetails && (
        <AccountDetailsDialog
          key={accountDetails.id}
          account={accountDetails}
          invoices={invoices}
          pricing={pricing}
          bankAccount={bankAccount}
          preparing={preparing === accountDetails.id}
          busy={Boolean(preparing) || refreshing || transferBusy}
          onClose={() => setAccountDetailsId(null)}
          onRenew={() => void startRenewal(accountDetails.id)}
          onPay={invoiceId => {
            setAccountDetailsId(null);
            setPaymentId(invoiceId);
          }}
          onView={invoiceId => {
            setAccountDetailsId(null);
            setDetailsId(invoiceId);
          }}
        />
      )}
    </div>
  );
}

const durations = Array.from({ length: 12 }, (_, index) => ({
  value: String(index + 1),
  label: index === 0 ? "1 mes" : `${index + 1} meses`,
}));

function PaymentDialog({
  accountId,
  invoice,
  bankAccount,
  draft,
  refreshing,
  onDraftChange,
  onBusyChange,
  onReported,
  onRefresh,
  onClose,
}: {
  accountId: string;
  invoice: BillingInvoice;
  bankAccount: BankAccount | null;
  draft: TransferDraft;
  refreshing: boolean;
  onDraftChange: (draft: TransferDraft) => void;
  onBusyChange: (busy: boolean) => void;
  onReported: (invoice: BillingInvoice) => void;
  onRefresh: () => void;
  onClose: () => void;
}) {
  const [step, setStep] = useState<PaymentStep>("invoice");
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
      const updated = await reportTransfer(accountId, invoice.id, reference.trim(), months, preview.total_minor);
      setStep("confirmation");
      onReported(updated);
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
    <BillingDialog title="Pago de membresía" busy={busy} onClose={onClose}>
      <div className={styles.paymentFlow}>
        <nav className={styles.stepper} aria-label="Pasos del pago">
          <StepLabel active={step === "invoice"} done={step !== "invoice"} label="Factura" />
          <StepLabel active={step === "transfer"} done={step === "confirmation"} label="Transferencia" />
          <StepLabel active={step === "confirmation"} done={false} label="Confirmación" />
        </nav>

        {step === "invoice" && (
          <div className={styles.form}>
            <p className={styles.muted}>Revisa el importe antes de continuar con la transferencia.</p>
            <div className={styles.paymentMeta}>
              <div className={styles.membershipTitleRow}>
                <strong>Membresía mensual</strong>
                <InvoiceStatus invoice={invoice} />
              </div>
              <span className={styles.muted}>{invoice.account_name} · {invoicePeriod(invoice)}</span>
            </div>
            <div className={styles.payTotal}>
              <span>Total a pagar</span>
              <strong>{billingAmount(invoice.total_minor)}</strong>
            </div>
            <div className={styles.actions}>
              <Button type="button" variant="secondary" onClick={onClose}>Cerrar</Button>
              <Button
                type="button"
                disabled={!bankAccount || refreshing}
                onClick={() => setStep("transfer")}
              >
                Pagar por transferencia
              </Button>
            </div>
            {!bankAccount && (
              <p className={styles.muted}>Los datos bancarios aún no están disponibles. Contacta con YZY Labs para coordinar el pago.</p>
            )}
          </div>
        )}

        {step === "transfer" && (
          <form className={styles.form} onSubmit={event => void submit(event)} noValidate>
            <div className={styles.paymentSection}>
              <h3>{monthLimit > 1 ? "Renovar membresía" : "Datos de la membresía"}</h3>
              <div className={styles.paymentMeta}>
                <strong>{invoice.account_name}</strong>
                <span className={styles.muted}>
                  Vencimiento de la primera cuota: <time dateTime={invoice.due_on}>{billingDate(invoice.due_on)}</time>
                </span>
              </div>
              {monthLimit > 1 && (
                <Select
                  label="Duración"
                  value={String(months)}
                  options={durations.map((option, index) => ({ ...option, disabled: index >= monthLimit }))}
                  disabled={busy || refreshing}
                  description="Ahorra un 10 % al pagar de 2 a 12 meses por adelantado."
                  onValueChange={value => onDraftChange({ ...draft, duration: Number(value) })}
                />
              )}
              <div aria-live="polite">
                <p className={styles.muted}>Período: {invoicePeriod(preview)}</p>
                <InvoiceBreakdown invoice={preview} totalLabel="Total a transferir" />
              </div>
            </div>

            {bankAccount && (
              <div className={styles.paymentSection}>
                <h3>Datos de la transferencia</h3>
                <BankDetails bankAccount={bankAccount} memo={invoice.transfer_memo} />
                <Input
                  ref={input}
                  label="Número de referencia"
                  name="referencia"
                  required
                  maxLength={100}
                  autoComplete="off"
                  spellCheck={false}
                  disabled={busy || refreshing}
                  value={reference}
                  error={referenceError}
                  description="Escribe la referencia que aparece en tu comprobante después de hacer la transferencia."
                  onChange={event => {
                    onDraftChange({ ...draft, reference: event.target.value });
                    setReferenceError("");
                  }}
                />
              </div>
            )}

            {problem && (
              <div className={styles.retry}>
                <p className={styles.error} role="alert">{problem.message}</p>
                {problem.requiresRefresh && (
                  <Button type="button" variant="secondary" disabled={refreshing} onClick={() => {
                    setProblem(undefined);
                    onRefresh();
                  }}>
                    Actualizar factura
                  </Button>
                )}
              </div>
            )}

            <div className={styles.actions}>
              <Button type="button" variant="secondary" disabled={busy} onClick={() => setStep("invoice")}>
                Atrás
              </Button>
              <InvoiceDownload accountId={accountId} invoice={preview} summary={months > 1} disabled={busy || refreshing || problem?.requiresRefresh} />
              {bankAccount && (
                <Button type="submit" loading={busy} disabled={busy || refreshing || problem?.requiresRefresh}>
                  Reportar transferencia
                </Button>
              )}
            </div>
          </form>
        )}

        {step === "confirmation" && (
          <div className={styles.form}>
            <div className={styles.emptyState}>
              <Badge tone="info" dot>En revisión</Badge>
              <p><strong>Transferencia reportada</strong></p>
              <p className={styles.muted}>
                Revisaremos la referencia y te confirmaremos el pago. Puedes seguir el estado en el historial.
              </p>
            </div>
            <div className={styles.actions}>
              <Button type="button" onClick={onClose}>Listo</Button>
            </div>
          </div>
        )}
      </div>
    </BillingDialog>
  );
}

function AccountDetailsDialog({
  account,
  invoices,
  pricing,
  bankAccount,
  preparing,
  busy,
  onClose,
  onRenew,
  onPay,
  onView,
}: {
  account: BillingAccount;
  invoices: BillingInvoice[];
  pricing: BillingPricing;
  bankAccount: BankAccount | null;
  preparing: boolean;
  busy: boolean;
  onClose: () => void;
  onRenew: () => void;
  onPay: (invoiceId: string) => void;
  onView: (invoiceId: string) => void;
}) {
  const status = accountMembershipStatus(account, invoices);
  const related = invoices.filter(invoice => invoice.account_id === account.id);
  const canRenew = status.canRenew && bankAccount !== null && account.companies.length > 0;
  const entryBenefit = status.label === "Beneficio de entrada";
  const usdTotal = account.companies.reduce(
    (total, company) => total + (company.price_usd_minor ?? pricing.price_usd_minor),
    0,
  );

  return (
    <BillingDialog title={account.name} busy={busy} onClose={onClose}>
      <div className={styles.form}>
        <div className={styles.statusGroup}>
          <Badge tone={status.tone} dot>{status.label}</Badge>
          {status.relevantOn && (
            <span className={styles.muted}>{status.relevantLabel} {billingDate(status.relevantOn)}</span>
          )}
        </div>
        <p className={styles.amount}>
          {entryBenefit ? billingUsdAmount(usdTotal) : billingAmount(account.monthly_total_minor)}
        </p>
        <p className={styles.muted}>
          {entryBenefit
            ? `Beneficio de entrada · luego ${billingAmount(account.monthly_total_minor)}/mes`
            : `Total mensual · ${billingAmount(account.monthly_total_minor)}`}
          {" · "}
          {account.companies.length === 1 ? "1 empresa" : `${account.companies.length} empresas`}
        </p>
        {account.companies.length > 0 ? (
          <ul className={styles.companyList} aria-label="Empresas incluidas">
            {account.companies.map(company => (
              <li key={company.id}>
                {company.name}
                <span className={styles.muted}>
                  {" · "}
                  {billingUsdAmount(company.price_usd_minor ?? pricing.price_usd_minor)}
                  {" / "}
                  {billingAmount(company.unit_price_minor)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.muted}>Esta cuenta aún no tiene empresas incluidas.</p>
        )}

        {related.length > 0 && (
          <div className={styles.paymentSection}>
            <h3>Facturas de esta cuenta</h3>
            <ul className={styles.accountInvoiceList}>
              {related.slice(0, 5).map(invoice => {
                const payable = invoice.state === "pending" && bankAccount !== null;
                return (
                  <li key={invoice.id} className={styles.accountInvoiceRow}>
                    <div>
                      <strong>{invoicePeriod(invoice)}</strong>
                      <p className={styles.muted}>{billingAmount(invoice.total_minor)}</p>
                    </div>
                    <div className={styles.pendingMeta}>
                      <InvoiceStatus invoice={invoice} />
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={busy}
                        onClick={() => payable ? onPay(invoice.id) : onView(invoice.id)}
                      >
                        {payable ? "Pagar" : "Ver"}
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        <div className={styles.actions}>
          <Button type="button" variant="secondary" disabled={busy} onClick={onClose}>Cerrar</Button>
          {canRenew && (
            <Button
              type="button"
              loading={preparing}
              disabled={busy}
              aria-label={`Renovar membresía de ${account.name}`}
              onClick={onRenew}
            >
              Renovar membresía
            </Button>
          )}
        </div>
      </div>
    </BillingDialog>
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

function BankDetails({ bankAccount, memo }: { bankAccount: BankAccount; memo: string }) {
  return (
    <div className={styles.transferDetails}>
      <CopyRow label="Banco" value={bankAccount.bank_name} />
      <CopyRow label="Titular" value={bankAccount.account_holder} />
      <CopyRow label="Tipo de cuenta" value={bankAccount.account_type} />
      <CopyRow label="Número de cuenta" value={bankAccount.account_number} mono />
      <CopyRow label="Concepto de pago" value={memo} mono />
    </div>
  );
}

function CopyRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
  }, []);

  async function copy() {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <div className={styles.copyRow}>
      <div>
        <p className={styles.summaryLabel}>{label}</p>
        <p className={mono ? styles.monoValue : undefined} translate={mono ? "no" : undefined}>{value}</p>
      </div>
      <Button type="button" variant="secondary" onClick={() => void copy()}>
        {copied ? "Copiado" : "Copiar"}
      </Button>
    </div>
  );
}

function StepLabel({ active, done, label }: { active: boolean; done: boolean; label: string }) {
  const id = useId();
  return (
    <span
      id={id}
      className={styles.stepLabel}
      data-active={active ? "true" : "false"}
      data-done={done ? "true" : "false"}
      aria-current={active ? "step" : undefined}
    >
      {label}
    </span>
  );
}

function BuildingIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 21h16M6 21V7l6-3 6 3v14M10 21v-4h4v4M9 10h1M14 10h1M9 14h1M14 14h1" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ReceiptIcon() {
  return (
    <svg className={styles.emptyIcon} width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M7 3h10v18l-2-1.5L13 21l-2-1.5L9 21l-2-1.5L5 21V5a2 2 0 0 1 2-2Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M9 8h6M9 12h6M9 16h3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
