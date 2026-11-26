import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { operationStatusLabel } from "@/app/clientes/expediente-status";
import { policiesPath, policyPath } from "@/app/control-seguros/insurance-paths";
import { concept, dateText, DueStatus, money } from "@/app/control-seguros/insurance-ui";
import { Tooltip } from "@/components/arc/tooltip/tooltip";
import type { DashboardAgingBucket, WorkspaceDashboard } from "./dashboard-api";
import { count, plural } from "./dashboard-format";
import styles from "./dashboard.module.css";

const agingLabels: Record<DashboardAgingBucket["bucket"], string> = {
  "1-30": "1 a 30 días",
  "31-60": "31 a 60 días",
  "61-90": "61 a 90 días",
  "90+": "Más de 90 días",
};

export function AttentionDuesPanel({ stats }: { stats: WorkspaceDashboard }) {
  const { attention_dues: dues } = stats.insurance;
  return <section className={`${styles.panel} ${styles.wide}`} aria-labelledby="attention-dues-title">
    <div className={styles.panelHeader}>
      <h2 id="attention-dues-title">Pagos que requieren atención</h2>
      <Link className={styles.tableAction} href={policiesPath}>Ver en Control de Pólizas</Link>
    </div>
    {dues.length === 0 ? <p className={styles.dataHint}>No hay pagos que requieran atención.</p> : (
      <div className={styles.tableScroll} role="region" aria-labelledby="attention-dues-title" tabIndex={0}>
        <table className={styles.table}>
          <thead><tr>{["Fecha", "Estado", "Concepto", "Póliza", "Cliente", "Aseguradora", "Monto"].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead>
          <tbody>{dues.map(due => <tr key={due.due_id}>
            <td>{dateText(due.due_on)}</td>
            {/* attention_dues lists pending dues only: not paid and not replaced. */}
            <td><DueStatus due={{ due_on: due.due_on, paid_on: null, replaced: false }} today={stats.period.today} /></td>
            <td>{concept(due)}</td>
            <th scope="row"><Link className={styles.rowLink} href={`${policyPath(due.policy_id)}#due-${due.due_id}`}>{due.policy_number}</Link></th>
            <td>{due.client_name}</td>
            <td>{due.carrier_name}</td>
            <td className={styles.numeric}>{money(due.amount_minor)}</td>
          </tr>)}</tbody>
        </table>
      </div>
    )}
  </section>;
}

export function AgingPanel({ stats }: { stats: WorkspaceDashboard }) {
  const { aging } = stats.insurance;
  const total = aging.reduce((sum, bucket) => sum + bucket.amount_minor, 0);
  const overdueCount = aging.reduce((sum, bucket) => sum + bucket.count, 0);
  return <section className={`${styles.panel} ${styles.narrow}`} aria-labelledby="aging-title">
    <div className={styles.panelHeader}>
      <h2 id="aging-title">Antigüedad de la mora</h2>
    </div>
    {overdueCount === 0 ? <p className={styles.dataHint}>No hay pagos vencidos.</p> : (
      <ul className={styles.agingList}>
        {aging.map(bucket => {
          const share = total > 0 ? (bucket.amount_minor / total) * 100 : 0;
          return <li key={bucket.bucket} className={styles.agingRow}>
            <span className={styles.agingLabel}>{agingLabels[bucket.bucket]}</span>
            <span className={styles.agingAmount}>{money(bucket.amount_minor)}</span>
            <span className={styles.agingCount}>{plural(bucket.count, "pago", "pagos")}</span>
            <span className={styles.agingTrack} aria-hidden="true">
              <span className={styles.agingFill} style={{ inlineSize: `${share}%` }} />
            </span>
          </li>;
        })}
      </ul>
    )}
    {overdueCount > 0 && <div className={styles.agingTotal}><span>Total vencido</span><strong>{money(total)}</strong></div>}
  </section>;
}

export function StalledCasesPanel({ stats }: { stats: WorkspaceDashboard }) {
  const { count: total, items } = stats.stalled_cases;
  return <section className={`${styles.panel} ${styles.wide} ${styles.stalledPanel}`} aria-labelledby="stalled-title">
    <div className={styles.panelHeader}>
      <div>
        <h2 id="stalled-title">Expedientes sin movimiento</h2>
        <p className={styles.panelSubtext}>
          {plural(total, "expediente", "expedientes")}{total > items.length && items.length > 0 ? ` · se muestran ${count(items.length)}` : ""}
        </p>
      </div>
      <Link className={styles.tableAction} href="/clientes">Ver expedientes</Link>
    </div>
    {items.length === 0 ? <p className={styles.dataHint}>No hay expedientes sin movimiento.</p> : (
      <div className={styles.tableScroll} role="region" aria-labelledby="stalled-title" tabIndex={0}>
        <table className={styles.table}>
          <thead><tr>
            <th scope="col">Expediente</th>
            <th scope="col">Cliente</th>
            <th scope="col">Estado</th>
            <th scope="col">Días sin movimiento</th>
            <th scope="col"><span className={styles.srOnly}>Acciones</span></th>
          </tr></thead>
          <tbody>{items.map(item => <tr key={item.id}>
            <th scope="row">{item.reference || "Sin referencia"}</th>
            <td>{item.client_name}</td>
            <td>{operationStatusLabel(item.status)}</td>
            <td className={styles.numericStrong}>{count(item.days_without_activity)}</td>
            <td>
              <Tooltip content="Abrir expediente">
                <Link href={`/clientes/${item.client_id}`} className={styles.tableAction}
                  aria-label={`Abrir expediente de ${item.client_name}`}>
                  <ArrowRight size={18} aria-hidden="true" />
                </Link>
              </Tooltip>
            </td>
          </tr>)}</tbody>
        </table>
      </div>
    )}
  </section>;
}

export function CarrierPanel({ stats }: { stats: WorkspaceDashboard }) {
  const { by_carrier: carriers, pending } = stats.insurance;
  return <section className={`${styles.panel} ${styles.narrow} ${styles.carrierPanel}`} aria-labelledby="carrier-title">
    <div className={styles.panelHeader}>
      <h2 id="carrier-title">Pendiente por aseguradora</h2>
    </div>
    {carriers.length === 0 ? <p className={styles.dataHint}>No hay pagos pendientes.</p> : (
      <dl className={styles.carrierList}>
        {carriers.map(carrier => <div key={carrier.carrier_id}>
          <dt>{carrier.carrier_name}</dt><dd>{money(carrier.amount_minor)}</dd>
        </div>)}
      </dl>
    )}
    <div className={styles.carrierTotal}><span>Total pendiente</span><strong>{money(pending.amount_minor)}</strong></div>
  </section>;
}
