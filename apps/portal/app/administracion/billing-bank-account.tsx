"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/arc/button/button";
import { Input } from "@/components/arc/input/input";
import { ApiError } from "@/lib/api";
import { billingError, getBankAccountSettings, saveBankAccountSettings, type BankAccount, type BankAccountSettings } from "@/app/facturacion/billing-api";
import { BillingDialog } from "@/app/facturacion/billing-presentation";
import styles from "@/app/facturacion/billing.module.css";

const emptyAccount: BankAccount = { bank_name: "", account_holder: "", account_type: "", account_number: "" };
const fields = [
  { name: "bank_name", label: "Banco", maxLength: 120 },
  { name: "account_holder", label: "Titular de la cuenta", maxLength: 200 },
  { name: "account_type", label: "Tipo de cuenta", maxLength: 60 },
  { name: "account_number", label: "Número de cuenta", maxLength: 64 },
] as const;

function accountNumberSummary(number: string) {
  const digits = /^[0-9 -]+$/.test(number) ? number.replace(/[^0-9]/g, "") : "";
  return digits.length > 4 ? `Termina en ${digits.slice(-4)}` : "Oculto";
}

export function BillingBankAccount({ accountId }: { accountId: string }) {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ settings: BankAccountSettings } | { error: string } | null>(null);
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const request = new AbortController();
    const { signal } = request;
    getBankAccountSettings(accountId, signal).then(settings => {
      if (!signal.aborted) setResult({ settings });
    }).catch(failure => {
      if (!signal.aborted) setResult({ error: billingError(failure, "No se pudo cargar la cuenta bancaria. Intenta de nuevo.") });
    });
    return () => request.abort();
  }, [accountId, attempt]);

  const settings = result && "settings" in result ? result.settings : null;
  const bank = settings?.bank_account;

  return <section className={styles.panel} aria-labelledby="billing-bank-title">
    <div className={styles.panelHeader}>
      <h2 id="billing-bank-title">Cuenta bancaria</h2>
      {settings && <Button type="button" variant="secondary" aria-haspopup="dialog" onClick={() => { setNotice(""); setEditing(true); }}>
        {bank ? "Editar cuenta bancaria" : "Configurar cuenta bancaria"}
      </Button>}
    </div>
    {!result && <p className={styles.muted} role="status">Cargando cuenta bancaria…</p>}
    {result && "error" in result && <div className={styles.retry}>
      <p className={styles.error} role="alert">{result.error}</p>
      <Button type="button" variant="secondary" onClick={() => { setResult(null); setAttempt(value => value + 1); }}>Reintentar</Button>
    </div>}
    {settings && !bank && <p className={styles.muted}>Configura la cuenta donde recibirás las transferencias de todos tus clientes.</p>}
    {bank && <dl className={styles.details}>
      <div><dt>Banco</dt><dd>{bank.bank_name}</dd></div>
      <div><dt>Titular</dt><dd>{bank.account_holder}</dd></div>
      <div><dt>Tipo de cuenta</dt><dd>{bank.account_type}</dd></div>
      <div><dt>Número de cuenta</dt><dd>{accountNumberSummary(bank.account_number)}</dd></div>
    </dl>}
    {notice && <p className={styles.notice} role="status">{notice}</p>}
    {settings && editing && <BankAccountDialog accountId={accountId} initial={settings} onClose={() => setEditing(false)}
      onReloaded={latest => setResult({ settings: latest })}
      onSaved={saved => { setResult({ settings: saved }); setEditing(false); setNotice("Cuenta bancaria guardada."); }} />}
  </section>;
}

function BankAccountDialog({ accountId, initial, onClose, onReloaded, onSaved }: {
  accountId: string;
  initial: BankAccountSettings;
  onClose: () => void;
  onReloaded: (settings: BankAccountSettings) => void;
  onSaved: (settings: BankAccountSettings) => void;
}) {
  const [values, setValues] = useState(initial.bank_account ?? emptyAccount);
  const [invalid, setInvalid] = useState<keyof BankAccount | null>(null);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const firstInput = useRef<HTMLInputElement>(null);
  const primaryButton = useRef<HTMLButtonElement>(null);
  const previousConflict = useRef(false);

  useEffect(() => {
    if (busy) return;
    if (conflict) primaryButton.current?.focus();
    else if (previousConflict.current) firstInput.current?.focus();
    previousConflict.current = conflict;
  }, [conflict, busy]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current || conflict) return;
    const missing = fields.find(({ name }) => !values[name].trim());
    if (missing) {
      setInvalid(missing.name);
      setError("");
      const input = event.currentTarget.elements.namedItem(missing.name);
      if (input instanceof HTMLInputElement) input.focus();
      return;
    }
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      onSaved(await saveBankAccountSettings(accountId, values, initial.revision));
    } catch (failure) {
      if (failure instanceof ApiError && failure.code === "BILLING_BANK_CONFLICT") setConflict(true);
      else setError(billingError(failure, "No se pudo guardar la cuenta bancaria. Intenta de nuevo."));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  async function reload() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      const latest = await getBankAccountSettings(accountId);
      setValues(latest.bank_account ?? emptyAccount);
      onReloaded(latest);
      setConflict(false);
    } catch (failure) {
      setError(billingError(failure, "No se pudo recargar la cuenta bancaria. Intenta de nuevo."));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return <BillingDialog title={initial.bank_account ? "Editar cuenta bancaria" : "Configurar cuenta bancaria"} busy={busy} onClose={onClose}>
    <form className={styles.form} onSubmit={event => void submit(event)} noValidate>
      <p className={styles.muted}>Los responsables de facturación verán esta cuenta en las instrucciones de transferencia de todas las empresas que factures.</p>
      {fields.map(({ name, label, maxLength }, index) => <Input key={name} ref={index === 0 ? firstInput : undefined}
        name={name} label={label} value={values[name]} maxLength={maxLength} required autoComplete="off" spellCheck={false}
        readOnly={busy || conflict} error={invalid === name ? "Completa este campo." : undefined}
        onChange={event => { setValues(previous => ({ ...previous, [name]: event.target.value })); setInvalid(null); setError(""); }} />)}
      {conflict && <p className={styles.error} role="alert">La cuenta bancaria cambió mientras la editabas. Recarga los datos para revisar la cuenta actual.</p>}
      {error && <p className={styles.error} role="alert">{error}</p>}
      <div className={styles.actions}>
        <Button type="button" variant="secondary" disabled={busy} onClick={onClose}>Cancelar</Button>
        <Button ref={primaryButton} type={conflict ? "button" : "submit"} loading={busy} onClick={conflict ? () => void reload() : undefined}>
          {conflict ? "Recargar datos" : "Guardar cuenta bancaria"}
        </Button>
      </div>
    </form>
  </BillingDialog>;
}
