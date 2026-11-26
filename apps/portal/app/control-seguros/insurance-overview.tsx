"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { Button } from "@/components/arc/button/button";
import { Input } from "@/components/arc/input/input";
import { Select } from "@/components/arc/select/select";
import { insuranceApi, type Overview, type Scope } from "./insurance-api";
import { concept, dateText, DueStatus, InsuranceError, InsuranceLoadingContent, money, policiesPath, policyPath, useInsuranceData } from "./insurance-ui";
import styles from "./insurance.module.css";

export type Filters = { days: number; carrier: string; overdue: boolean; kind: string; query: string };
const all = "all";
const normalize = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("es-DO");

export function InsuranceOverview({ scope, allPolicies, initial }: {
  scope: Scope; allPolicies: boolean; initial: Filters;
}) {
  const [filters, setFilters] = useState(initial);
  const { days, overdue } = filters;
  const { company, account } = scope;
  const load = useCallback((signal: AbortSignal) => insuranceApi({ company, account }).overview(
    days, overdue, signal,
  ), [company, account, days, overdue]);
  const { data, error, retry } = useInsuranceData(load);
  const patch = (next: Partial<Filters>) => setFilters(current => ({ ...current, ...next }));
  const search = new URLSearchParams({ days: String(days), carrier: filters.carrier, overdue: String(overdue),
    kind: filters.kind, q: filters.query });
  const listHref = `${policiesPath}?${search}`;

  return <div className={styles.stack}>
    <div className={styles.actions}>
      <Link className={styles.actionLink} href={`${policiesPath}/nueva`}>Nueva póliza</Link>
    </div>
    <nav className={styles.tabs} aria-label="Vistas de pólizas">
      <Link href={listHref} aria-current={!allPolicies ? "page" : undefined}>Vencimientos</Link>
      <Link href={`${listHref}&vista=todas`} aria-current={allPolicies ? "page" : undefined}>Todas las pólizas</Link>
    </nav>
    <div className={styles.filters}>
      <Select label="Aseguradora" name="carrier" value={filters.carrier} onValueChange={carrier => patch({ carrier })}
        disabled={!data?.carriers.length}
        options={[{ value: all, label: "Todas" }, ...(data?.carriers ?? []).map(({ id, name }) => ({ value: id, label: name }))]} />
      {!allPolicies && <Select label="Tipo" name="kind" value={filters.kind} onValueChange={kind => patch({ kind })}
        options={[{ value: all, label: "Todos" }, { value: "cuota", label: "Cuotas" }, { value: "renovacion", label: "Renovaciones" }]} />}
      <Input label="Buscar cliente o número de póliza" name="q" type="search" autoComplete="off" value={filters.query}
        onChange={event => patch({ query: event.target.value })} />
      {!allPolicies && <WindowFilter days={days} onChange={value => patch({ days: value })} />}
      {!allPolicies && <label className={styles.check}>
        <input name="overdue" type="checkbox" checked={overdue} onChange={event => patch({ overdue: event.target.checked })} />
        Incluir vencidos
      </label>}
    </div>
    {error ? <InsuranceError message={error} retry={retry} /> : data
      ? <OverviewContent data={data} allPolicies={allPolicies} filters={filters} />
      : <InsuranceLoadingContent view="policies" />}
  </div>;
}

export function WindowFilter({ days, onChange }: { days: number; onChange: (value: number) => void }) {
  const [draft, setDraft] = useState(String(days));
  return <form className={styles.window} onSubmit={event => {
    event.preventDefault();
    const value = Number(draft);
    if (Number.isInteger(value) && value >= 1 && value <= 365) onChange(value);
  }}>
    <Input name="days" label="Próximos días" type="number" inputMode="numeric" min={1} max={365} required
      autoComplete="off" value={draft} onChange={event => setDraft(event.target.value)} />
    <Button type="submit" variant="secondary">Aplicar</Button>
  </form>;
}

function OverviewContent({ data, allPolicies, filters }: {
  data: Overview; allPolicies: boolean; filters: Filters;
}) {
  const names = new Map(data.carriers.map(carrier => [carrier.id, carrier.name]));
  const query = normalize(filters.query.trim());
  const policies = data.policies.filter(policy =>
    (filters.carrier === all || policy.carrier_id === filters.carrier)
      && (!query || normalize(policy.number).includes(query) || normalize(policy.client_name).includes(query)));
  const policyIndex = new Map(policies.map(policy => [policy.id, policy]));
  const dueRows = data.dues.flatMap(due => {
    const policy = policyIndex.get(due.policy_id);
    if (!policy || (filters.kind !== all && (due.slot === 0) !== (filters.kind === "renovacion"))) return [];
    return [{ due, policy }];
  });

  if (allPolicies) return policies.length ? <div className={styles.tableWrap}>
    <table className={styles.table} aria-label="Todas las pólizas">
      <thead><tr><th scope="col">Póliza</th><th scope="col">Cliente</th><th scope="col">Aseguradora</th></tr></thead>
      <tbody>{policies.map(policy => <tr key={policy.id}>
        <th scope="row"><Link href={policyPath(policy.id)}>{policy.number}</Link></th>
        <td>{policy.client_name}</td><td>{names.get(policy.carrier_id)}</td>
      </tr>)}</tbody>
    </table>
  </div> : <p className={styles.empty}>No hay pólizas que coincidan con la búsqueda.</p>;

  return <section className={styles.stack} aria-labelledby="insurance-attention">
    <div className={styles.heading}>
      <h2 id="insurance-attention">Vencimientos pendientes</h2>
    </div>
    {dueRows.length ? <div className={styles.tableWrap}>
      <table className={styles.table} aria-labelledby="insurance-attention">
        <thead><tr>{["Fecha", "Estado", "Concepto", "Póliza", "Cliente", "Aseguradora", "Monto"].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead>
        <tbody>{dueRows.map(({ due, policy }) => <tr key={due.id}>
          <td>{dateText(due.due_on)}</td><td><DueStatus due={due} today={data.today} /></td><td>{concept(due)}</td>
          <th scope="row"><Link href={`${policyPath(policy.id)}#due-${due.id}`}>{policy.number}</Link></th>
          <td>{policy.client_name}</td><td>{names.get(policy.carrier_id)}</td><td className={styles.numeric}>{money(due.amount_minor)}</td>
        </tr>)}</tbody>
      </table>
    </div> : <p className={styles.empty}>No hay vencimientos pendientes con estos filtros.</p>}
  </section>;
}
