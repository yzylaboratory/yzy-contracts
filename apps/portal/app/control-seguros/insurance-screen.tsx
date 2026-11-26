"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, LayoutDashboard, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/arc/button/button";
import { PortalShell } from "@/components/portal-shell/portal-shell";
import { usePortalAccess } from "@/lib/portal-access";
import { insuranceApi, type Due, type PolicyDetail, type Scope } from "./insurance-api";
import { PaymentForm, PolicyEditor } from "./insurance-forms";
import { InsuranceOverview, type Filters } from "./insurance-overview";
import { concept, dateText, DueStatus, InsuranceError, insuranceHome, InsuranceLoadingContent, money, policiesPath, policyPath, useInsuranceData, type SkeletonView } from "./insurance-ui";
import styles from "./insurance.module.css";

export type View = "home" | "dashboard" | "policies" | "detail" | "new" | "edit";
export const titles: Record<View, string> = {
  home: "Control Seguros", dashboard: "Dashboard", policies: "Pólizas",
  detail: "Detalle de póliza", new: "Nueva póliza", edit: "Editar póliza",
};
export const skeletonView = (view: View): SkeletonView => {
  if (view === "new" || view === "edit") return "editor";
  return view;
};

export function InsuranceScreen({ view, id, filters, allPolicies }: { view: View; id?: string; filters: Filters; allPolicies: boolean }) {
  const { activeCompany, state } = usePortalAccess();
  const account = state.kind === "ready" ? state.identity.id : undefined;
  const company = activeCompany?.id;
  const dirty = useRef(false);
  const setDirty = useCallback((value: boolean) => { dirty.current = value; }, []);
  const confirmNavigation = () => !dirty.current || window.confirm("¿Salir sin guardar los cambios?");
  const back = view === "home" ? undefined
    : view === "dashboard" || view === "policies" ? { href: insuranceHome, label: "Control Seguros" }
    : view === "edit" && id ? { href: policyPath(id), label: "Póliza" }
    : { href: policiesPath, label: "Pólizas" };
  return <PortalShell currentPage="/control-seguros" title={titles[view]} backLink={back} confirmNavigation={confirmNavigation} onboardingAvailable={false}
    loadingFallback={<InsuranceLoadingContent view={skeletonView(view)} />}>
    {view === "home" ? <div className={styles.tiles}>
      <Link className={styles.tile} href={`${insuranceHome}/dashboard`}><LayoutDashboard aria-hidden="true" /> Dashboard <ArrowRight aria-hidden="true" /></Link>
      <Link className={styles.tile} href={policiesPath}><ShieldCheck aria-hidden="true" /> Pólizas <ArrowRight aria-hidden="true" /></Link>
    </div> : account && company && <ScopedScreen key={JSON.stringify([account, company, view, id, allPolicies, filters])}
      scope={{ account, company }} view={view} id={id} filters={filters} allPolicies={allPolicies} onDirty={setDirty} />}
  </PortalShell>;
}

function ScopedScreen({ scope, view, id, filters, allPolicies, onDirty }: { scope: Scope; view: View; id?: string; filters: Filters; allPolicies: boolean; onDirty: (value: boolean) => void }) {
  if (view === "dashboard" || view === "policies") return <InsuranceOverview scope={scope} dashboard={view === "dashboard"} initial={filters} allPolicies={allPolicies} />;
  if (view === "detail" && id) return <PolicyRecord scope={scope} id={id} />;
  return <EditorScreen scope={scope} id={id} onDirty={onDirty} />;
}

function EditorScreen({ scope, id, onDirty }: { scope: Scope; id?: string; onDirty: (value: boolean) => void }) {
  const router = useRouter();
  const { account, company } = scope;
  const load = useCallback(async (signal: AbortSignal) => {
    const api = insuranceApi({ company, account });
    const [overview, detail] = await Promise.all([api.overview(7, false, signal), id ? api.detail(id, signal) : undefined]);
    return { carriers: overview.carriers, detail };
  }, [account, company, id]);
  const { data, error, retry } = useInsuranceData(load);
  if (error) return <InsuranceError message={error} retry={retry} />;
  if (!data) return <InsuranceLoadingContent view="editor" />;
  return <PolicyEditor scope={scope} carriers={data.carriers} record={data.detail}
    cancelHref={id ? policyPath(id) : policiesPath} onDirty={onDirty} onSaved={saved => router.replace(policyPath(saved.policy.id))} />;
}

function PolicyRecord({ scope, id }: { scope: Scope; id: string }) {
  const { account, company } = scope;
  const load = useCallback((signal: AbortSignal) => insuranceApi({ account, company }).detail(id, signal), [account, company, id]);
  const { data, error, retry } = useInsuranceData(load);
  const [paying, setPaying] = useState<Due>();
  const [payments, setPayments] = useState<Record<string, Due>>({});
  const [status, setStatus] = useState("");
  const statusRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!data || !window.location.hash.startsWith("#due-")) return;
    document.getElementById(window.location.hash.slice(1))?.scrollIntoView({ block: "center" });
  }, [data]);

  useEffect(() => {
    if (status) statusRef.current?.focus();
  }, [status]);

  if (error) return <InsuranceError message={error} retry={retry} />;
  if (!data) return <InsuranceLoadingContent view="detail" />;
  const dues = data.dues.map(due => payments[due.id] ?? due);
  const active = dues.filter(due => !due.replaced);
  return <div className={styles.stack}>
    <div className={styles.heading}>
      <h2>Póliza {data.policy.number}</h2><Link href={`${policyPath(id)}/editar`}>Editar</Link>
    </div>
    <dl className={styles.facts}>
      <div><dt>Cliente</dt><dd>{data.policy.client_name}</dd></div>
      <div><dt>Aseguradora</dt><dd>{data.carrier_name}</dd></div>
    </dl>
    <div ref={statusRef} role="status" tabIndex={-1}>{status}</div>
    <DueTable label="Cuotas mensuales" dues={active.filter(due => due.slot > 0)} detail={data} onPay={setPaying} />
    <DueTable label="Renovación" dues={active.filter(due => due.slot === 0)} detail={data} onPay={setPaying} />
    {dues.some(due => due.replaced) && <details>
      <summary>Historial de vencimientos reemplazados</summary>
      <DueTable label="Vencimientos reemplazados" dues={dues.filter(due => due.replaced)} detail={data} />
    </details>}
    {paying && <PaymentForm scope={scope} detail={data} due={paying} onCancel={() => setPaying(undefined)} onSaved={due => {
      setPayments(current => ({ ...current, [due.id]: due }));
      setPaying(undefined);
      setStatus(`Pago registrado para ${concept(due).toLocaleLowerCase("es-DO")}.`);
    }} />}
  </div>;
}

function DueTable({ label, dues, detail, onPay }: { label: string; dues: Due[]; detail: PolicyDetail; onPay?: (due: Due) => void }) {
  return <section className={styles.stack}>
    <h3>{label}</h3>
    <div className={styles.tableWrap}>
      <table className={styles.table} aria-label={label}>
        <thead><tr>{["Concepto", "Fecha límite", "Monto", "Estado", "Fecha de pago", ...(onPay ? ["Acción"] : [])]
          .map(column => <th key={column} scope="col">{column}</th>)}</tr></thead>
        <tbody>{dues.map(due => <tr key={due.id} id={`due-${due.id}`}>
          <th scope="row">{concept(due)}</th><td>{dateText(due.due_on)}</td><td className={styles.numeric}>{money(due.amount_minor)}</td>
          <td><DueStatus due={due} today={detail.today} /></td><td>{due.paid_on ? dateText(due.paid_on) : "—"}</td>
          {onPay && <td>{!due.paid_on && <Button type="button" variant="secondary" size="sm" aria-label={`Registrar pago de ${concept(due)}`}
            onClick={() => onPay(due)}>Registrar pago</Button>}</td>}
        </tr>)}</tbody>
      </table>
    </div>
  </section>;
}
