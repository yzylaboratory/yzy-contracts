"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Button } from "@/components/arc/button/button";
import { Input } from "@/components/arc/input/input";
import { MoneyInput } from "@/components/arc/money-input/money-input";
import { LoadingBlock, LoadingContent } from "@/components/loading/loading-ui";
import { Select } from "@/components/arc/select/select";
import { listClients, type Client } from "../clientes/clients-api";
import { insuranceApi, insuranceMessage, type Carrier, type Due, type PolicyDetail, type PolicyWrite, type Scope } from "./insurance-api";
import { concept, dateText, InsuranceError, money } from "./insurance-ui";
import styles from "./insurance.module.css";

const maxMinor = 99_999_999_999;
const maxAmountMessage = "El monto máximo es $999,999,999.99.";
const amountError = (value: number | null) => value !== null && value > maxMinor ? maxAmountMessage : undefined;

function Modal({ title, onClose, busy, children }: { title: string; onClose: () => void; busy: boolean; children: ReactNode }) {
  const id = useId();
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    const trigger = document.activeElement;
    dialog?.showModal();
    return () => {
      dialog?.close();
      if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus();
    };
  }, []);
  return <dialog ref={ref} className={styles.dialog} aria-labelledby={id} onCancel={event => {
    event.preventDefault();
    if (!busy) onClose();
  }}>
    <h2 id={id}>{title}</h2>
    {children}
  </dialog>;
}

export function PaymentForm({ scope, due, detail, onSaved, onCancel }: {
  scope: Scope; due: Due; detail: PolicyDetail; onSaved: (due: Due) => void; onCancel: () => void;
}) {
  const [date, setDate] = useState(detail.today);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      onSaved(await insuranceApi(scope).pay(detail.policy.id, due.id, date));
    } catch (error) {
      setError(insuranceMessage(error));
    } finally {
      setBusy(false);
    }
  }
  return <Modal title="Registrar pago" onClose={onCancel} busy={busy}>
    <p>{detail.policy.number} · {detail.policy.client_name} · {detail.carrier_name}</p>
    <p>{concept(due)} · {dateText(due.due_on)} · {money(due.amount_minor)}</p>
    <form className={styles.stack} onSubmit={submit}>
      <Input label="Fecha real de pago" name="paid_on" type="date" autoComplete="off" required min="0001-01-01" max={detail.today}
        value={date} onChange={event => setDate(event.target.value)} />
      {error && <InsuranceError message={error} />}
      <div className={styles.actions}>
        <Button type="submit" loading={busy}>Confirmar pago</Button>
        <Button type="button" variant="secondary" disabled={busy} onClick={onCancel}>Cancelar</Button>
      </div>
    </form>
  </Modal>;
}

function ClientPicker({ account, value, onChange, disabled }: {
  account: string; value?: { id: string; name: string }; onChange: (client: { id: string; name: string }) => void; disabled: boolean;
}) {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<{ query: string; items: Client[]; total: number }>();
  const [error, setError] = useState<{ query: string; message: string }>();
  const [attempt, setAttempt] = useState(0);
  const search = query.trim();
  useEffect(() => {
    if (disabled) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      listClients(account, { search, page: 1, perPage: 20 }, controller.signal).then(page => {
        if (!controller.signal.aborted) setResult({ query: search, items: page.items, total: page.total });
      }, error => {
        if (!controller.signal.aborted) setError({ query: search, message: insuranceMessage(error) });
      });
    }, search ? 250 : 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [account, attempt, disabled, search]);
  const current = result?.query === search ? result : undefined;
  const clients = new Map(current?.items.map(client => [client.id, client]));
  const status = error?.query === search && !current ? <div className={styles.fieldNote}><InsuranceError message={error.message} retry={() => {
    setError(undefined);
    setAttempt(value => value + 1);
  }} /></div> : !disabled && !current ? <div className={styles.fieldNote}><ClientSearchLoading /></div>
    : current && current.total > current.items.length ? <p className={styles.fieldNote} role="status">Afina la búsqueda para ver otros clientes.</p>
    : current && current.items.length === 0 ? <p className={styles.fieldNote} role="status">No se encontraron clientes con esa búsqueda.</p> : null;
  const options = Array.from(clients.values(), client => ({ value: client.id, label: client.identity ? `${client.name} · ${client.identity}` : client.name }));
  if (value && !clients.has(value.id)) options.unshift({ value: value.id, label: value.name });
  return <>
    {!disabled && <Input label="Buscar cliente" name="client_search" type="search" autoComplete="off" value={query}
      onChange={event => setQuery(event.target.value)} />}
    <Select name="client_id" label="Cliente" value={value?.id ?? ""} required disabled={disabled || !options.length}
      placeholder="Selecciona un cliente" options={options} onValueChange={id => {
        const client = clients.get(id);
        if (client) onChange(client);
      }} />
    {status}
  </>;
}

function ClientSearchLoading() {
  return <LoadingContent label="Buscando clientes…"><LoadingBlock height={22} /></LoadingContent>;
}

export function PolicyEditor({ scope, carriers, record, cancelHref, onDirty, onSaved }: {
  scope: Scope; carriers: Carrier[]; record?: PolicyDetail; cancelHref: string; onDirty: (value: boolean) => void; onSaved: (detail: PolicyDetail) => void;
}) {
  const previous = record?.policy;
  const [carrier, setCarrier] = useState(previous?.carrier_id ?? "");
  const [client, setClient] = useState(previous && { id: previous.client_id, name: previous.client_name });
  const [number, setNumber] = useState(previous?.number ?? "");
  const [firstDate, setFirstDate] = useState(previous?.first_due_on ?? "");
  const [count, setCount] = useState(previous ? String(previous.installment_count) : "");
  const [installment, setInstallment] = useState<number | null>(previous?.installment_minor ?? null);
  const [renewalDate, setRenewalDate] = useState(previous?.renewal_on ?? "");
  const [renewal, setRenewal] = useState<number | null>(previous?.renewal_minor ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dirty, setDirty] = useState(false);
  const paid = record?.dues.filter(due => due.paid_on) ?? [];
  const hasPayment = paid.length > 0;
  const renewalPaid = paid.some(due => due.slot === 0);
  const minimumCount = paid.reduce((max, due) => Math.max(max, due.slot), 1);
  useEffect(() => {
    if (!dirty) return;
    onDirty(true);
    function warn(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = true;
    }
    window.addEventListener("beforeunload", warn);
    return () => {
      onDirty(false);
      window.removeEventListener("beforeunload", warn);
    };
  }, [dirty, onDirty]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (!client || !carrier || !installment || !renewal) {
      setError("Selecciona el cliente y la aseguradora e ingresa ambos montos.");
      return;
    }
    if (amountError(installment) || amountError(renewal)) {
      setError(maxAmountMessage);
      return;
    }
    setBusy(true);
    setError("");
    const body: PolicyWrite = {
      carrier_id: carrier, client_id: client.id, number, first_due_on: firstDate,
      installment_count: Number(count), installment_minor: installment, renewal_on: renewalDate, renewal_minor: renewal,
    };
    try {
      const detail = await insuranceApi(scope).save(body, previous);
      setDirty(false);
      onSaved(detail);
    } catch (error) {
      setError(insuranceMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return <form className={styles.stack} onSubmit={submit} onChange={() => setDirty(true)}>
    <fieldset className={styles.panel} disabled={busy}>
      <legend>Datos de la póliza</legend>
      <div className={styles.fields}>
        <Select name="carrier_id" label="Aseguradora" value={carrier} required disabled={hasPayment || !carriers.length}
          placeholder="Selecciona una aseguradora" options={carriers.map(item => ({ value: item.id, label: item.name }))}
          description={carriers.length ? undefined : "Aún no hay aseguradoras registradas. Solo el superadministrador puede agregarlas."}
          onValueChange={value => { setCarrier(value); setDirty(true); }} />
        <ClientPicker account={scope.account} value={client} disabled={hasPayment} onChange={value => { setClient(value); setDirty(true); }} />
        <Input label="Número de póliza" name="number" autoComplete="off" spellCheck={false} required maxLength={120} value={number}
          onChange={event => setNumber(event.target.value)} />
      </div>
    </fieldset>
    <fieldset className={styles.panel} disabled={busy}>
      <legend>Cuotas mensuales</legend>
      {hasPayment && <p>Las cuotas y renovaciones pagadas conservan su fecha y su monto.</p>}
      <div className={styles.fields}>
        <Input label="Primera fecha de pago" name="first_due_on" type="date" autoComplete="off" required min="0001-01-01" max="9999-12-31"
          value={firstDate} onChange={event => setFirstDate(event.target.value)} />
        <Input label="Cantidad de cuotas" name="installment_count" type="number" inputMode="numeric" autoComplete="off" required min={minimumCount} max={120}
          value={count} onChange={event => setCount(event.target.value)} />
        <MoneyInput className={styles.moneyField} label="Monto por cuota" name="installment_minor" currency="DOP" currencies={["DOP"]} locale="es-DO" quickAdd={[]}
          error={amountError(installment)} value={installment} onValueChange={value => { setInstallment(value); setDirty(true); }} />
      </div>
    </fieldset>
    <fieldset className={styles.panel} disabled={busy || renewalPaid}>
      <legend>Renovación</legend>
      <div className={styles.fields}>
        <Input label="Fecha límite de pago" name="renewal_on" type="date" autoComplete="off" required min="0001-01-01" max="9999-12-31"
          value={renewalDate} onChange={event => setRenewalDate(event.target.value)} />
        <MoneyInput className={styles.moneyField} label="Monto de renovación" name="renewal_minor" currency="DOP" currencies={["DOP"]} locale="es-DO" quickAdd={[]}
          disabled={renewalPaid} error={amountError(renewal)} value={renewal} onValueChange={value => { setRenewal(value); setDirty(true); }} />
      </div>
    </fieldset>
    {error && <InsuranceError message={error} />}
    <div className={styles.actions}>
      <Button type="submit" loading={busy}>Guardar póliza</Button>
      <Link href={cancelHref} onNavigate={event => {
        if (busy || (dirty && !window.confirm("¿Salir sin guardar los cambios?"))) event.preventDefault();
      }}>Cancelar</Link>
    </div>
  </form>;
}
