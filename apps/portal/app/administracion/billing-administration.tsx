"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/arc/button/button";
import { Input } from "@/components/arc/input/input";
import { Select } from "@/components/arc/select/select";
import { billingError, getBillingAccounts, getBillingInvoices, getBillingPricing, saveBillingAccount, verifyTransfer, type BillingAccount, type BillingDecision, type BillingInvoice, type BillingPage, type BillingPricing } from "@/app/facturacion/billing-api";
import { BillingDialog, billingAmount, billingDate, billingUsdAmount, invoicePeriod, InvoiceBreakdown, InvoiceStatus } from "@/app/facturacion/billing-presentation";
import styles from "@/app/facturacion/billing.module.css";
import { billingReviewSection } from "@/lib/admin-navigation";
import { getAdminUsers, type AdminUser } from "./admin-api";
import { AdminPagination } from "./admin-pagination";
import { BillingBankAccount } from "./billing-bank-account";
import { BillingPricingSettings } from "./billing-pricing";

type AdminBillingData = {
  accounts: BillingPage<BillingAccount>;
  reported: BillingPage<BillingInvoice>;
  invoices: BillingPage<BillingInvoice>;
  managers: AdminUser[];
  pricing: BillingPricing;
};
type Dialog = { kind: "account"; account: BillingAccount } | { kind: "invoice"; invoice: BillingInvoice };

const billingPageSize = 10;

export function BillingAdministration({ accountId }: { accountId: string }) {
  return <div className={styles.workspace}>
    <BillingAccountsAndInvoices accountId={accountId} />
    <BillingPricingSettings key={`pricing-${accountId}`} accountId={accountId} />
    <BillingBankAccount key={accountId} accountId={accountId} />
  </div>;
}

function BillingAccountsAndInvoices({ accountId }: { accountId: string }) {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ key: string; data: AdminBillingData } | { key: string; error: string } | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [notice, setNotice] = useState("");
  const reviewHeading = useRef<HTMLHeadingElement>(null);
  const [accountsPage, setAccountsPage] = useState(1);
  const [reviewPage, setReviewPage] = useState(1);
  const [invoicesPage, setInvoicesPage] = useState(1);
  const requestKey = `${attempt}:${accountsPage}:${reviewPage}:${invoicesPage}`;
  useEffect(() => {
    const request = new AbortController();
    const { signal } = request;
    Promise.all([
      getBillingAccounts(accountId, signal, accountsPage, billingPageSize),
      getBillingInvoices(accountId, signal, reviewPage, billingPageSize, true),
      getBillingInvoices(accountId, signal, invoicesPage, billingPageSize, false),
      getAdminUsers(accountId, "", "active", signal),
      getBillingPricing(accountId, signal),
    ]).then(([accounts, reported, invoices, managers, pricing]) => {
      if (!signal.aborted) setResult({ key: requestKey, data: { accounts, reported, invoices, managers: managers.items, pricing } });
    }).catch((error: unknown) => {
      if (!signal.aborted) setResult({ key: requestKey, error: billingError(error, "No se pudo cargar la facturación. Intenta de nuevo.") });
    });
    return () => request.abort();
  }, [accountId, accountsPage, reviewPage, invoicesPage, requestKey]);

  const current = result;
  const refreshing = current !== null && current.key !== requestKey;
  if (!current) return <p id={billingReviewSection} className={styles.muted} role="status">Cargando facturación…</p>;
  if ("error" in current) return <div className={styles.retry}>
    {notice && <p className={styles.notice} role="status">{notice}</p>}
    <p className={styles.error} role="alert">{current.error}</p>
    <Button type="button" variant="secondary" loading={refreshing} disabled={refreshing} onClick={() => setAttempt(value => value + 1)}>Reintentar</Button>
  </div>;

  const { accounts, reported, invoices, managers, pricing } = current.data;
  if (!refreshing) {
    const last = (page: BillingPage<unknown>) => Math.max(1, Math.ceil(page.total / page.per_page));
    if (accountsPage > last(accounts)) setAccountsPage(last(accounts));
    if (reviewPage > last(reported)) setReviewPage(last(reported));
    if (invoicesPage > last(invoices)) setInvoicesPage(last(invoices));
  }

  function savedAccount() {
    setAttempt(value => value + 1);
    setDialog(null);
    setNotice("Cuenta de facturación guardada.");
  }

  function verified(decision: BillingDecision) {
    setAttempt(value => value + 1);
    setDialog(null);
    setNotice(decision === "confirm" ? "Pago confirmado." : "Transferencia rechazada. El responsable puede reportar otra.");
    requestAnimationFrame(() => reviewHeading.current?.focus());
  }

  return (
    <div className={styles.workspace}>
      {notice && <p className={styles.notice} role="status">{notice}</p>}
      <section className={`${styles.panel} ${styles.reviewQueue}`} id={billingReviewSection} aria-labelledby="billing-review-title">
        <div className={styles.panelHeader}>
          <h2 id="billing-review-title" ref={reviewHeading} tabIndex={-1}>Transferencias por revisar</h2>
          <Button type="button" variant="secondary" loading={refreshing} disabled={refreshing} onClick={() => setAttempt(value => value + 1)}>Actualizar</Button>
        </div>
        {refreshing && <p className={styles.muted} role="status">Actualizando facturas…</p>}
        {reported.items.length ? <InvoiceTable invoices={reported} onPage={setReviewPage} reviewing refreshing={refreshing}
          onOpen={invoice => { setNotice(""); setDialog({ kind: "invoice", invoice }); }} />
          : <p className={styles.muted}>No hay transferencias pendientes de revisión.</p>}
      </section>

      <section className={styles.panel} aria-labelledby="billing-accounts-title">
        <h2 id="billing-accounts-title">Cuentas de facturación</h2>
        {accounts.items.length ? <div className={styles.tableScroll} role="region" aria-label="Tabla de cuentas de facturación" tabIndex={0}>
          <table className={styles.table}>
            <thead><tr><th scope="col">Cuenta</th><th scope="col">Responsable</th><th scope="col">Empresas</th><th scope="col" className={styles.numeric}>Total mensual</th><th scope="col" className={styles.rowAction}>Acciones</th></tr></thead>
            <tbody>{accounts.items.map(account => <tr key={account.id}>
              <th scope="row">{account.name}<br /><span className={styles.muted}>Sin cobro hasta el {billingDate(account.starts_on)}</span></th>
              <td>{account.manager_user_id === accountId ? "Superadministrador"
                : managers.find(user => user.id === account.manager_user_id)?.name
                  ?? managers.find(user => user.id === account.manager_user_id)?.email ?? "Responsable deshabilitado"}</td>
              <td>{account.companies.map(company => `${company.name} (${billingUsdAmount(company.price_usd_minor ?? pricing.price_usd_minor)})`).join(", ") || "Sin cobros programados"}</td>
              <td className={styles.numeric}>{billingAmount(account.monthly_total_minor)}</td>
              <td className={styles.rowAction}><Button type="button" variant="secondary" aria-haspopup="dialog" disabled={refreshing} aria-label={`Editar cuenta de ${account.name}`}
                onClick={() => { setNotice(""); setDialog({ kind: "account", account }); }}>Editar cuenta</Button></td>
            </tr>)}</tbody>
          </table>
        </div> : <p className={styles.muted}>Las cuentas aparecen aquí al registrar una empresa.</p>}
        <AdminPagination page={accounts.page} perPage={accounts.per_page} total={accounts.total} onPage={setAccountsPage} label="Páginas de cuentas de facturación" disabled={refreshing} />
      </section>

      <section className={styles.panel} aria-labelledby="admin-billing-invoices-title">
        <h2 id="admin-billing-invoices-title">Facturas</h2>
        {invoices.items.length ? <InvoiceTable invoices={invoices} onPage={setInvoicesPage} refreshing={refreshing}
          onOpen={invoice => { setNotice(""); setDialog({ kind: "invoice", invoice }); }} />
          : <p className={styles.muted}>No hay otras facturas.</p>}
      </section>
      {dialog?.kind === "account" && <BillingAccountDialog accountId={accountId} account={dialog.account} managers={managers}
        pricing={pricing} onClose={() => setDialog(null)} onSaved={savedAccount} />}
      {dialog?.kind === "invoice" && <ReviewDialog accountId={accountId} invoice={dialog.invoice}
        onClose={() => setDialog(null)} onVerified={verified} />}
    </div>
  );
}

function InvoiceTable({ invoices, reviewing = false, refreshing, onOpen, onPage }: {
  invoices: BillingPage<BillingInvoice>; onPage: (page: number) => void; reviewing?: boolean; refreshing: boolean; onOpen: (invoice: BillingInvoice) => void;
}) {
  const action = reviewing ? "Revisar transferencia" : "Ver factura";
  return <>
    <div className={styles.tableScroll} role="region" aria-label={reviewing ? "Transferencias reportadas" : "Tabla de facturas"} aria-busy={refreshing} tabIndex={0}>
      <table className={styles.table}>
        <thead><tr>
          <th scope="col">Cuenta y período</th>
          <th scope="col">{reviewing ? "Fecha del reporte" : "Estado"}</th>
          <th scope="col">Referencia bancaria</th>
          <th scope="col" className={styles.numeric}>Monto</th>
          <th scope="col" className={styles.rowAction}>Acciones</th>
        </tr></thead>
        <tbody>{invoices.items.map(invoice => (
          <tr key={invoice.id}>
            <th scope="row">{invoice.account_name}<br /><span className={styles.muted}>{invoicePeriod(invoice)}</span></th>
            <td>{reviewing ? (invoice.transfer_reported_at ? billingDate(invoice.transfer_reported_at) : "—") : <InvoiceStatus invoice={invoice} />}</td>
            <td translate="no">{invoice.transfer_reference ?? "—"}</td>
            <td className={styles.numeric}>{billingAmount(invoice.total_minor)}</td>
            <td className={styles.rowAction}>
              <Button type="button" variant={reviewing ? "primary" : "secondary"} aria-haspopup="dialog" disabled={refreshing}
                aria-label={`${action} de ${invoice.account_name}, ${invoicePeriod(invoice)}`} onClick={() => onOpen(invoice)}>
                {action}
              </Button>
            </td>
          </tr>
        ))}</tbody>
      </table>
    </div>
    <AdminPagination page={invoices.page} perPage={invoices.per_page} total={invoices.total} onPage={onPage} label={reviewing ? "Páginas de transferencias por revisar" : "Páginas de facturas"} disabled={refreshing} />
  </>;
}

function BillingAccountDialog({ accountId, account, managers, pricing, onClose, onSaved }: {
  accountId: string; account: BillingAccount; managers: AdminUser[]; pricing: BillingPricing;
  onClose: () => void; onSaved: (account: BillingAccount) => void;
}) {
  const [name, setName] = useState(account.name);
  const [managerId, setManagerId] = useState(account.manager_user_id);
  const [companyPrices, setCompanyPrices] = useState<Record<string, string>>(() => Object.fromEntries(
    account.companies.map(company => [
      company.id,
      ((company.price_usd_minor ?? pricing.price_usd_minor) / 100).toFixed(2),
    ]),
  ));
  const [managerPortal, setManagerPortal] = useState<HTMLDialogElement | null>(null);
  const formRef = useCallback((form: HTMLFormElement | null) => {
    setManagerPortal(form?.closest("dialog") ?? null);
  }, []);
  const managerOptions = [
    { value: accountId, label: "Superadministrador" },
    ...managers.flatMap(user => user.id && user.id !== accountId ? [{ value: user.id, label: user.name ? `${user.name} (${user.email})` : user.email }] : []),
  ];
  const managerAvailable = managerOptions.some(option => option.value === managerId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const sending = useRef(false);
  const nameInput = useRef<HTMLInputElement>(null);
  const managerInput = useRef<HTMLButtonElement>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending.current) return;
    if (!managerAvailable) {
      setError("Selecciona un responsable habilitado.");
      managerInput.current?.focus();
      return;
    }
    if (!name.trim()) {
      setError("Escribe el nombre de la cuenta.");
      nameInput.current?.focus();
      return;
    }
    const prices: { company_id: string; price_usd_minor: number | null }[] = [];
    for (const company of account.companies) {
      const raw = companyPrices[company.id]?.replace(",", ".") ?? "";
      const parsed = Number(raw);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        setError("Indica un precio en USD mayor que cero para cada empresa.");
        return;
      }
      const priceUsdMinor = Math.round(parsed * 100);
      prices.push({
        company_id: company.id,
        price_usd_minor: priceUsdMinor === pricing.price_usd_minor ? null : priceUsdMinor,
      });
    }
    sending.current = true;
    setBusy(true);
    setError("");
    try {
      onSaved(await saveBillingAccount(accountId, account.id, {
        name: name.trim(),
        manager_user_id: managerId,
        company_ids: account.companies.map(company => company.id),
        company_prices: prices,
      }));
    } catch (failure) {
      setError(billingError(failure, "No se pudo guardar la cuenta. Intenta de nuevo."));
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  return (
    <BillingDialog title="Editar cuenta de facturación" busy={busy} onClose={onClose}>
      <form ref={formRef} className={styles.form} onSubmit={event => void submit(event)} noValidate>
        {account.company_id ? <p className={styles.muted}>{account.name}</p> : (
          <Input ref={nameInput} name="nombre" label="Nombre de la cuenta" autoComplete="off" maxLength={200} required disabled={busy} value={name}
            onChange={event => { setName(event.target.value); setError(""); }} />
        )}
        <Select ref={managerInput} name="manager_user_id" label="Responsable de facturación" required disabled={busy}
          value={managerAvailable ? managerId : ""} placeholder="Selecciona un usuario habilitado…"
          options={managerOptions} portalContainer={managerPortal} onValueChange={id => { setManagerId(id); setError(""); }} />
        {account.companies.length > 0 && (
          <fieldset className={styles.priceFields}>
            <legend>Precio por empresa (USD / mes)</legend>
            <p className={styles.muted}>
              Precio global actual: {billingUsdAmount(pricing.price_usd_minor)}. Si dejas el mismo valor, se usa el global.
            </p>
            {account.companies.map(company => (
              <Input
                key={company.id}
                name={`price-${company.id}`}
                label={company.name}
                inputMode="decimal"
                autoComplete="off"
                required
                disabled={busy}
                value={companyPrices[company.id] ?? ""}
                onChange={event => {
                  setCompanyPrices(previous => ({ ...previous, [company.id]: event.target.value }));
                  setError("");
                }}
              />
            ))}
          </fieldset>
        )}
        {error && <p className={styles.error} role="alert">{error}</p>}
        <div className={styles.actions}>
          <Button type="button" variant="secondary" disabled={busy} onClick={onClose}>Cancelar</Button>
          <Button type="submit" loading={busy} disabled={busy}>Guardar cuenta</Button>
        </div>
      </form>
    </BillingDialog>
  );
}

function ReviewDialog({ accountId, invoice, onClose, onVerified }: {
  accountId: string; invoice: BillingInvoice; onClose: () => void; onVerified: (decision: BillingDecision, invoice: BillingInvoice) => void;
}) {
  const [busy, setBusy] = useState<BillingDecision | null>(null);
  const [pendingDecision, setPendingDecision] = useState<BillingDecision | null>(null);
  const [error, setError] = useState("");
  const confirmation = useRef<HTMLHeadingElement>(null);
  const confirmButton = useRef<HTMLButtonElement>(null);
  const rejectButton = useRef<HTMLButtonElement>(null);
  const sending = useRef(false);
  const reportId = invoice.transfer_report_id;

  useEffect(() => {
    if (pendingDecision) confirmation.current?.focus();
  }, [pendingDecision]);

  function cancelDecision() {
    const button = pendingDecision === "confirm" ? confirmButton : rejectButton;
    setPendingDecision(null);
    setError("");
    requestAnimationFrame(() => button.current?.focus());
  }

  async function verify(decision: BillingDecision) {
    if (!reportId || sending.current) return;
    sending.current = true;
    setBusy(decision);
    setError("");
    try {
      const verifiedInvoice = await verifyTransfer(accountId, invoice.id, reportId, decision);
      onVerified(decision, verifiedInvoice);
    } catch (failure) {
      setError(billingError(failure, "No se pudo registrar la revisión. Intenta de nuevo."));
    } finally {
      sending.current = false;
      setBusy(null);
    }
  }

  return (
    <BillingDialog title={invoice.state === "in_review" ? "Revisar transferencia" : "Detalle de factura"} busy={busy !== null} onClose={pendingDecision ? cancelDecision : onClose}>
      <div className={styles.form}>
        <div className={styles.statusGroup}>
          <InvoiceStatus invoice={invoice} />
          <span className={styles.muted}>{invoice.account_name} · {invoicePeriod(invoice)}</span>
        </div>
        <InvoiceBreakdown invoice={invoice} />
        <dl className={styles.details}>
          <div><dt>Concepto de pago</dt><dd translate="no">{invoice.transfer_memo}</dd></div>
          {invoice.transfer_reference && <div><dt>Referencia bancaria</dt><dd translate="no">{invoice.transfer_reference}</dd></div>}
          {invoice.transfer_reported_at && <div><dt>Fecha del reporte</dt><dd>{billingDate(invoice.transfer_reported_at)}</dd></div>}
          {invoice.paid_at && <div><dt>Pago confirmado</dt><dd>{billingDate(invoice.paid_at)}</dd></div>}
        </dl>
        {pendingDecision ? <div>
          <h3 ref={confirmation} tabIndex={-1}>{pendingDecision === "confirm" ? "Confirmar esta transferencia" : "Rechazar esta transferencia"}</h3>
          <p className={styles.muted}>{billingAmount(invoice.total_minor)} para {invoice.account_name}, período {invoicePeriod(invoice)}.</p>
          <p className={styles.muted}>{pendingDecision === "confirm"
            ? "La confirmación registrará el pago de los períodos indicados."
            : "El responsable de facturación podrá reportar una nueva transferencia."}</p>
        </div> : invoice.state === "in_review" && <p className={styles.muted}>Comprueba la referencia y el monto en tu cuenta bancaria antes de confirmar.</p>}
        {error && <p className={styles.error} role="alert">{error}</p>}
        <div className={styles.actions}>
          {pendingDecision ? <>
            <Button type="button" variant="secondary" disabled={busy !== null} onClick={cancelDecision}>Volver a revisión</Button>
            <Button type="button" variant={pendingDecision === "reject" ? "danger" : "primary"} loading={busy !== null} disabled={busy !== null}
              onClick={() => void verify(pendingDecision)}>{pendingDecision === "confirm" ? "Registrar confirmación" : "Registrar rechazo"}</Button>
          </> : <>
            <Button type="button" variant="secondary" onClick={onClose}>Cerrar</Button>
            {invoice.state === "in_review" && reportId && <>
              <Button type="button" ref={rejectButton} variant="danger" onClick={() => setPendingDecision("reject")}>Rechazar transferencia</Button>
              <Button type="button" ref={confirmButton} onClick={() => setPendingDecision("confirm")}>Confirmar pago</Button>
            </>}
          </>}
        </div>
      </div>
    </BillingDialog>
  );
}
