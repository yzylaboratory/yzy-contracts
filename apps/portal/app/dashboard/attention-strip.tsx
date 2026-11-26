import Link from "next/link";
import { AlertTriangle, FileSignature, RefreshCw, UserPlus, type LucideIcon } from "lucide-react";
import { policiesPath } from "@/app/control-seguros/insurance-paths";
import { money } from "@/app/control-seguros/insurance-ui";
import type { WorkspaceDashboard } from "./dashboard-api";
import { count, plural } from "./dashboard-format";
import styles from "./dashboard.module.css";

type Item = { key: string; label: string; icon: LucideIcon; value: string; context: string; href: string; empty: boolean; alert?: boolean };

const overdueHref = `${policiesPath}?${new URLSearchParams({ overdue: "true" })}`;
const renewalsHref = `${policiesPath}?${new URLSearchParams({ kind: "renovacion", days: "7", overdue: "false" })}`;
// ClientDirectory has no status filter in its UI or URL, so the link opens the plain list.
const casesHref = "/clientes";
const prospectsHref = "/directorio-clientes#prospects-title";

export function AttentionStrip({ stats }: { stats: WorkspaceDashboard }) {
  const { overdue_dues: overdue, renewals_next_7_days: renewals, unsigned_over_5_days: unsigned } = stats.attention;
  const items: Item[] = [
    { key: "overdue", label: "Pagos vencidos", icon: AlertTriangle, value: money(overdue.amount_minor), href: overdueHref,
      context: plural(overdue.count, "vencimiento", "vencimientos"), empty: overdue.count === 0, alert: overdue.count > 0 },
    { key: "renewals", label: "Renovaciones ≤7 días", icon: RefreshCw, value: money(renewals.amount_minor), href: renewalsHref,
      context: plural(renewals.count, "renovación", "renovaciones"), empty: renewals.count === 0 },
    { key: "unsigned", label: "Sin firmar +5 días", icon: FileSignature, value: count(unsigned), href: casesHref,
      context: unsigned === 1 ? "expediente" : "expedientes", empty: unsigned === 0 },
    { key: "prospects", label: "Prospectos por revisar", icon: UserPlus, value: count(stats.prospects_pending), href: prospectsHref,
      context: `${plural(stats.clients_total, "cliente", "clientes")} · ${plural(stats.clients_this_month, "nuevo", "nuevos")} este mes`, empty: stats.prospects_pending === 0 },
  ];
  return <section className={styles.attention} aria-labelledby="attention-strip-title">
    <h2 id="attention-strip-title" className={styles.bentoHeading}>Requiere atención</h2>
    <ul className={styles.attentionList}>
      {items.map(({ key, label, icon: Icon, value, context, href, empty, alert }) => <li key={key}>
        <Link href={href} className={styles.attentionItem} data-empty={empty || undefined} data-alert={alert || undefined}>
          <span className={styles.attentionLabel}><Icon size={15} aria-hidden="true" />{label}</span>
          <strong className={styles.attentionValue}>{value}</strong>
          <span className={styles.attentionContext}>{context}</span>
        </Link>
      </li>)}
    </ul>
  </section>;
}
