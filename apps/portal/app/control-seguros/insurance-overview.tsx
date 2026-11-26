"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { Button } from "@/components/arc/button/button";
import { Input } from "@/components/arc/input/input";
import { Select } from "@/components/arc/select/select";
import { insuranceApi, type Overview, type Scope } from "./insurance-api";
import { concept, dateText, DueStatus, InsuranceError, InsuranceLoadingContent, insuranceHome, money, policiesPath, policyPath, useInsuranceData } from "./insurance-ui";
import styles from "./insurance.module.css";

export type Filters = { days: number; carrier: string; overdue: boolean; kind: string; query: string };
const all = "all";
const normalize = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("es-DO");

export function InsuranceOverview({ scope, dashboard, allPolicies, initial }: {
  scope: Scope; dashboard: boolean; allPolicies: boolean; initial: Filters;
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
    {!dashboard && <>
      <div className={styles.actions}>
        <Link className={styles.actionLink} href={`${policiesPath}/nueva`}>Nueva póliza</Link>
        <Link href={`${insuranceHome}/aseguradoras/nueva`}>Nueva aseguradora</Link>
      </div>
      <nav className={styles.tabs} aria-label="Vistas de pólizas">
        <Link href={listHref} aria-current={!allPolicies ? "page" : undefined}>Vencimientos</Link>
        <Link href={`${listHref}&vista=todas`} aria-current={allPolicies ? "page" : undefined}>Todas las pólizas</Link>
      </nav>
    </>}
    <div className={styles.filters}>
      <Select label="Aseguradora" name="carrier" value={filters.carrier} onValueChange={carrier => patch({ carrier })}
        disabled={!data?.carriers.length}
        options={[{ value: all, label: "Todas" }, ...(data?.carriers ?? []).map(({ id, name }) => ({ value: id, label: name }))]} />
      {!dashboard && !allPolicies && <Select label="Tipo" name="kind" value={filters.kind} onValueChange={kind => patch({ kind })}
        options={[{ value: all, label: "Todos" }, { value: "cuota", label: "Cuotas" }, { value: "renovacion", label: "Renovaciones" }]} />}
      {!dashboard && <Input label="Buscar cliente o número de póliza" name="q" type="search" autoComplete="off" value={filters.query}
        onChange={event => patch({ query: event.target.value })} />}
      {!allPolicies && <WindowFilter days={days} onChange={value => patch({ days: value })} />}
      {!dashboard && !allPolicies && <label className={styles.check}>
        <input name="overdue" type="checkbox" checked={overdue} onChange={event => patch({ overdue: event.target.checked })} />
        Incluir vencidos
      </label>}
    </div>
    {error ? <InsuranceError message={error} retry={retry} /> : data
      ? <OverviewContent data={data} dashboard={dashboard} allPolicies={allPolicies} filters={filters} listHref={listHref} />
      : <InsuranceLoadingContent view={dashboard ? "dashboard" : "policies"} />}
  </div>;
}


function WindowFilter({ days, onChange }: { days: number; onChange: (value: number) => void }) {
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

function OverviewContent({ data, dashboard, allPolicies, filters, listHref }: {
  data: Overview; dashboard: boolean; allPolicies: boolean; filters: Filters; listHref: string;
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
  const carrierTotals = new Map<string, bigint>();
  const metrics = [
    { label: "Pagos vencidos", count: 0, amount: BigInt(0) },
    { label: "Cuotas por vencer", count: 0, amount: BigInt(0) },
    { label: "Renovaciones por vencer", count: 0, amount: BigInt(0) },
  ];
  for (const { due, policy } of dueRows) {
    const metric = metrics[due.due_on < data.today ? 0 : due.slot > 0 ? 1 : 2];
    metric.count += 1;
    const amount = BigInt(due.amount_minor);
    metric.amount += amount;
    carrierTotals.set(policy.carrier_id, (carrierTotals.get(policy.carrier_id) ?? BigInt(0)) + amount);
  }

  if (allPolicies) return policies.length ? <div className={styles.tableWrap}>
    <table className={styles.table} aria-label="Todas las pólizas">
      <thead><tr><th scope="col">Póliza</th><th scope="col">Cliente</th><th scope="col">Aseguradora</th></tr></thead>
      <tbody>{policies.map(policy => <tr key={policy.id}>
        <th scope="row"><Link href={policyPath(policy.id)}>{policy.number}</Link></th>
        <td>{policy.client_name}</td><td>{names.get(policy.carrier_id)}</td>
      </tr>)}</tbody>
    </table>
  </div> : <p className={styles.empty}>No hay pólizas que coincidan con la búsqueda.</p>;

  return <>
    {dashboard && <div className={styles.metrics}>{metrics.map(metric => <section key={metric.label} className={styles.panel}>
      <h2>{metric.label}</h2><strong className={styles.amount}>{money(metric.amount)}</strong>
      <span>{metric.count} {metric.count === 1 ? "vencimiento" : "vencimientos"}</span>
    </section>)}</div>}
    <section className={styles.stack} aria-labelledby="insurance-attention">
      <div className={styles.heading}>
        <h2 id="insurance-attention">{dashboard ? "Pagos que requieren atención" : "Vencimientos pendientes"}</h2>
        {dashboard && <Link href={listHref}>Ver en Pólizas</Link>}
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
    </section>
    {dashboard && <section className={styles.panel}>
      <h2>Pendiente por aseguradora</h2>
      {carrierTotals.size > 0 && <dl className={styles.totals}>
        {data.carriers.filter(carrier => carrierTotals.has(carrier.id)).map(carrier => <div key={carrier.id}>
          <dt>{carrier.name}</dt><dd>{money(carrierTotals.get(carrier.id) ?? 0)}</dd>
        </div>)}
      </dl>}
      <div className={styles.heading}><span>Total pendiente en esta vista</span>
        <strong>{money(metrics.reduce((sum, metric) => sum + metric.amount, BigInt(0)))}</strong></div>
    </section>}
  </>;
}
