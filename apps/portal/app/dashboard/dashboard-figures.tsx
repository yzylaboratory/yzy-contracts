import { Banknote, FolderOpen, HandCoins, Hourglass, ShieldCheck, Timer, UserCheck, Wallet } from "lucide-react";
import { money } from "@/app/control-seguros/insurance-ui";
import type { WorkspaceDashboard } from "./dashboard-api";
import { count, daysVariation, decimal, percentVariation, plural, rangeLabel } from "./dashboard-format";
import { StatCard, StatGrid } from "./stat-card";
import styles from "./dashboard.module.css";

function reference(stats: WorkspaceDashboard) {
  const { compare_start, compare_end } = stats.period;
  return `vs. ${rangeLabel(compare_start, compare_end)}`;
}

export function ContractsFigures({ stats }: { stats: WorkspaceDashboard }) {
  const { disbursed, in_process: inProcess, cases_created: created, days_to_disbursement: days } = stats.contracts;
  const vs = reference(stats);
  return <section className={styles.group} aria-labelledby="contracts-title">
    <h2 id="contracts-title" className={styles.groupTitle}>Contratos</h2>
    <StatGrid label="Cifras de contratos">
      <StatCard label="Desembolsado" icon={Banknote} value={money(disbursed.amount_minor)}
        variation={percentVariation(disbursed.amount_minor, disbursed.previous_amount_minor, { upIsGood: true, reference: vs })}
        context={`${plural(disbursed.count, "desembolso", "desembolsos")}${disbursed.without_plan > 0 ? ` · ${count(disbursed.without_plan)} sin plan de pagos` : ""}`} />
      <StatCard label="En trámite" icon={Hourglass} value={money(inProcess.amount_minor)}
        context={`${plural(inProcess.count, "expediente", "expedientes")}: ${count(inProcess.solicitud)} en solicitud · ${count(inProcess.en_proceso)} en proceso · ${count(inProcess.firma)} en firma${inProcess.without_amount > 0 ? ` · ${count(inProcess.without_amount)} sin monto` : ""}`} />
      <StatCard label="Expedientes" icon={FolderOpen} value={count(created.count)}
        variation={percentVariation(created.count, created.previous_count, { upIsGood: true, reference: vs })}
        context={`${count(stats.cases_total)} en total`} />
      <StatCard label="Días a desembolso" icon={Timer}
        value={days.average === null ? "—" : `${decimal(days.average)} ${days.average === 1 ? "día" : "días"}`}
        variation={daysVariation(days.average, days.previous_average, { upIsGood: false, reference: vs })}
        context={`de ${plural(days.sample, "desembolso", "desembolsos")}`} />
    </StatGrid>
  </section>;
}

export function InsuranceFigures({ stats }: { stats: WorkspaceDashboard }) {
  const { collected, pending } = stats.insurance;
  const vs = reference(stats);
  const payments = plural(collected.count, "pago", "pagos");
  const collectedContext = collected.due_in_period === 0
    ? `Sin vencimientos en el período · ${payments}`
    : `${count(Math.round((collected.paid_of_due_in_period / collected.due_in_period) * 100))} % de lo que venció en el período · ${payments}`;
  return <section className={styles.group} aria-labelledby="insurance-title">
    <h2 id="insurance-title" className={styles.groupTitle}>Pólizas</h2>
    <StatGrid label="Cifras de pólizas">
      <StatCard label="Cobrado" icon={HandCoins} value={money(collected.amount_minor)}
        variation={percentVariation(collected.amount_minor, collected.previous_amount_minor, { upIsGood: true, reference: vs })}
        context={collectedContext} />
      <StatCard label="Pendiente" icon={Wallet} value={money(pending.amount_minor)}
        context={`${money(pending.overdue_amount_minor)} vencido · ${plural(pending.count, "vencimiento", "vencimientos")}`} />
      <StatCard label="Pólizas" icon={ShieldCheck} value={count(stats.insurance.policies_total)}
        context={stats.insurance.policies_new > 0
          ? <><span aria-hidden="true">▲ </span>{plural(stats.insurance.policies_new, "nueva", "nuevas")} en el período</>
          : "Sin pólizas nuevas en el período"} />
      <StatCard label="Clientes asegurados" icon={UserCheck} value={count(stats.insurance.insured_clients)}
        context="con al menos una póliza" />
    </StatGrid>
  </section>;
}
