"use client";

import Link from "next/link";
import { AlertTriangle, CalendarClock, RefreshCw, Wallet } from "lucide-react";
import { useCallback, useState, type ReactNode } from "react";
import { insuranceApi, type Due, type Overview, type Policy } from "@/app/control-seguros/insurance-api";
import { WindowFilter } from "@/app/control-seguros/insurance-overview";
import { concept, dateText, DueStatus, InsuranceError, money, policiesPath, policyPath, useInsuranceData } from "@/app/control-seguros/insurance-ui";
import { LoadingContent } from "@/components/loading/loading-ui";
import { Select } from "@/components/arc/select/select";
import { InsuranceAttentionSkeleton, InsuranceCarrierSkeleton, InsuranceTilesSkeleton } from "./insurance-skeletons";
import { MetricTiles } from "./metric-tiles";
import dashboard from "./dashboard.module.css";
import styles from "./dashboard-insurance.module.css";

const allCarriers = "all";
const loadingLabel = "Cargando pólizas…";

type InsuranceFilters = { carrier: string; days: number };
export type InsuranceState = {
  filters: InsuranceFilters;
  setFilters: (next: Partial<InsuranceFilters>) => void;
  data?: Overview;
  error?: string;
  retry: () => void;
};

export function useInsuranceDashboard(account: string, company: string): InsuranceState {
  const [filters, setCurrent] = useState<InsuranceFilters>({ carrier: allCarriers, days: 7 });
  const { days } = filters;
  const load = useCallback((signal: AbortSignal) => insuranceApi({ company, account }).overview(days, true, signal), [company, account, days]);
  const { data, error, retry } = useInsuranceData(load);
  return { filters, setFilters: next => setCurrent(current => ({ ...current, ...next })), data, error, retry };
}

type Row = { due: Due; policy: Policy };
type Metric = { count: number; amount: bigint };

function summarize(data: Overview, carrier: string) {
  const policies = new Map(data.policies
    .filter(policy => carrier === allCarriers || policy.carrier_id === carrier)
    .map(policy => [policy.id, policy]));
  const rows = data.dues.flatMap((due): Row[] => {
    const policy = policies.get(due.policy_id);
    return policy ? [{ due, policy }] : [];
  });
  const overdue: Metric = { count: 0, amount: BigInt(0) };
  const installments: Metric = { count: 0, amount: BigInt(0) };
  const renewals: Metric = { count: 0, amount: BigInt(0) };
  const overduePolicies = new Set<string>();
  const carrierTotals = new Map<string, bigint>();
  for (const { due, policy } of rows) {
    const metric = due.due_on < data.today ? overdue : due.slot > 0 ? installments : renewals;
    if (metric === overdue) overduePolicies.add(policy.id);
    const amount = BigInt(due.amount_minor);
    metric.count += 1;
    metric.amount += amount;
    carrierTotals.set(policy.carrier_id, (carrierTotals.get(policy.carrier_id) ?? BigInt(0)) + amount);
  }
  const total: Metric = {
    count: overdue.count + installments.count + renewals.count,
    amount: overdue.amount + installments.amount + renewals.amount,
  };
  return { rows, overdue, installments, renewals, total, overduePolicies: overduePolicies.size, carrierTotals };
}

const dues = (count: number) => `${count} ${count === 1 ? "vencimiento" : "vencimientos"}`;

// The failure is reported once, by InsuranceSection; the other policy blocks render nothing while it lasts.
function Slot({ state, skeleton, children }: { state: InsuranceState; skeleton: ReactNode; children: (data: Overview) => ReactNode }) {
  if (state.error) return null;
  if (!state.data) return <LoadingContent label={loadingLabel}>{skeleton}</LoadingContent>;
  return children(state.data);
}

export function InsuranceSection({ state }: { state: InsuranceState }) {
  const { filters, setFilters, data } = state;
  return <section className={styles.group} aria-labelledby="insurance-title">
    <h2 id="insurance-title" className={styles.groupTitle}>Pólizas</h2>
    <div className={styles.filters}>
      <Select label="Aseguradora" name="carrier" value={filters.carrier} onValueChange={carrier => setFilters({ carrier })}
        disabled={!data?.carriers.length}
        options={[{ value: allCarriers, label: "Todas" }, ...(data?.carriers ?? []).map(({ id, name }) => ({ value: id, label: name }))]} />
      <WindowFilter days={filters.days} onChange={days => setFilters({ days })} />
    </div>
    {state.error ? <InsuranceError message={state.error} retry={state.retry} /> : <Slot state={state} skeleton={<InsuranceTilesSkeleton />}>{overview => {
      const { overdue, installments, renewals, total, overduePolicies } = summarize(overview, filters.carrier);
      return <MetricTiles label="Resumen de pagos de pólizas" tiles={[
        { key: "overdue", label: "Pagos vencidos", value: money(overdue.amount), icon: AlertTriangle,
          context: `${dues(overdue.count)} · ${overduePolicies} ${overduePolicies === 1 ? "póliza con atraso" : "pólizas con atraso"}` },
        { key: "installments", label: "Cuotas por vencer", value: money(installments.amount), icon: CalendarClock, context: dues(installments.count) },
        { key: "renewals", label: "Renovaciones por vencer", value: money(renewals.amount), icon: RefreshCw, context: dues(renewals.count) },
        { key: "total", label: "Total pendiente", value: money(total.amount), icon: Wallet, context: dues(total.count) },
      ]} />;
    }}</Slot>}
  </section>;
}

export function InsuranceCarrierPanel({ state }: { state: InsuranceState }) {
  if (state.error) return null;
  return <section className={`${dashboard.panel} ${styles.narrow}`} aria-labelledby="carrier-title">
    <div className={dashboard.panelHeader}>
      <h2 id="carrier-title">Pendiente por aseguradora</h2>
    </div>
    <Slot state={state} skeleton={<InsuranceCarrierSkeleton />}>{data => {
      const { carrierTotals, total } = summarize(data, state.filters.carrier);
      const carriers = data.carriers.filter(carrier => carrierTotals.has(carrier.id));
      return <>
        {carriers.length ? <dl className={styles.carrierList}>
          {carriers.map(carrier => <div key={carrier.id}>
            <dt>{carrier.name}</dt><dd>{money(carrierTotals.get(carrier.id) ?? BigInt(0))}</dd>
          </div>)}
        </dl> : <p className={dashboard.dataHint}>No hay pagos pendientes con estos filtros.</p>}
        <div className={styles.carrierTotal}><span>Total pendiente en esta vista</span><strong>{money(total.amount)}</strong></div>
      </>;
    }}</Slot>
  </section>;
}

export function InsuranceAttentionPanel({ state }: { state: InsuranceState }) {
  if (state.error) return null;
  const { carrier, days } = state.filters;
  const href = `${policiesPath}?${new URLSearchParams({ carrier, days: String(days), overdue: "true" })}`;
  return <section className={`${dashboard.panel} ${styles.wide}`} aria-labelledby="attention-title">
    <div className={dashboard.panelHeader}>
      <h2 id="attention-title">Pagos que requieren atención</h2>
      <Link className={dashboard.tableAction} href={href}>Ver en Control de Pólizas</Link>
    </div>
    <Slot state={state} skeleton={<InsuranceAttentionSkeleton />}>{data => {
      const { rows } = summarize(data, carrier);
      const names = new Map(data.carriers.map(item => [item.id, item.name]));
      if (!rows.length) return <p className={dashboard.dataHint}>No hay vencimientos pendientes con estos filtros.</p>;
      return <div className={dashboard.tableScroll} role="region" aria-labelledby="attention-title" tabIndex={0}>
        <table className={`${dashboard.table} ${styles.linkedTable}`}>
          <thead><tr>{["Fecha", "Estado", "Concepto", "Póliza", "Cliente", "Aseguradora", "Monto"].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead>
          <tbody>{rows.map(({ due, policy }) => <tr key={due.id}>
            <td>{dateText(due.due_on)}</td>
            <td><DueStatus due={due} today={data.today} /></td>
            <td>{concept(due)}</td>
            <th scope="row"><Link href={`${policyPath(policy.id)}#due-${due.id}`}>{policy.number}</Link></th>
            <td>{policy.client_name}</td>
            <td>{names.get(policy.carrier_id)}</td>
            <td className={styles.numeric}>{money(due.amount_minor)}</td>
          </tr>)}</tbody>
        </table>
      </div>;
    }}</Slot>
  </section>;
}
