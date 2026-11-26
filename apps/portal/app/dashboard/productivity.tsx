import { Clock } from "lucide-react";
import type { WorkspaceDashboard } from "./dashboard-api";
import { count, formatMinutes, rangeLabel } from "./dashboard-format";
import { FormatChart } from "./format-chart";
import { StatCard, StatGrid } from "./stat-card";
import styles from "./dashboard.module.css";

const formatLabels = { pdf: "PDF", docx: "Word", email: "Correo" } as const;
const hiddenUser = "admin@yzylabs.com";

export function ProductivitySection({ stats }: { stats: WorkspaceDashboard }) {
  const { productivity, period } = stats;
  const formats = (Object.keys(formatLabels) as Array<keyof typeof formatLabels>).map(format => ({
    name: formatLabels[format],
    total: productivity.documents[format],
  }));
  const members = stats.user_stats.filter(member => member.user_name.trim().toLowerCase() !== hiddenUser);
  return <section className={styles.group} aria-labelledby="productivity-title">
    <h2 id="productivity-title" className={styles.groupTitle}>Productividad</h2>
    <div className={styles.productivity}>
      <StatGrid label="Tiempo ahorrado">
        <StatCard label="Tiempo ahorrado" icon={Clock} value={formatMinutes(productivity.time_saved_minutes)}
          context={`del ${rangeLabel(period.start, period.end)}`} />
      </StatGrid>
      <section className={styles.panel} aria-labelledby="documents-title">
        <div className={styles.panelHeader}>
          <div>
            <h3 id="documents-title" className={styles.panelTitle}>Documentos generados</h3>
            <p className={styles.panelSubtext}>{count(productivity.documents.total)} en el período</p>
          </div>
        </div>
        <FormatChart formats={formats} />
      </section>
    </div>
    <section className={styles.panel} aria-labelledby="team-title">
      <div className={styles.panelHeader}>
        <div>
          <h3 id="team-title" className={styles.panelTitle}>Histórico por usuario</h3>
          <p className={styles.panelSubtext}>Acumulado desde el inicio: desembolsos, contratos pendientes, documentos y tiempo ahorrado por miembro</p>
        </div>
      </div>
      {members.length === 0 ? <p className={styles.dataHint}>Aún no hay actividad registrada por usuario en esta empresa.</p> : (
        <div className={styles.tableScroll} role="region" aria-labelledby="team-title" tabIndex={0}>
          <table className={styles.table}>
            <thead><tr>
              <th scope="col">Usuario</th>
              <th scope="col">Desembolsos</th>
              <th scope="col">Sin firmar</th>
              <th scope="col">Sin desemb.</th>
              <th scope="col">Docs</th>
              <th scope="col">Tiempo ahorrado</th>
            </tr></thead>
            <tbody>{members.map(member => <tr key={member.user_id}>
              <th scope="row">
                <span className={styles.userCell}>
                  <span>{member.user_name}</span>
                  {member.is_current_user && <span className={styles.youBadge}>Tú</span>}
                </span>
              </th>
              <td className={styles.numericStrong}>{count(member.disbursements_total)}</td>
              <td>{count(member.unsigned_cases)}</td>
              <td>{count(member.pending_disbursement_cases)}</td>
              <td>{count(member.documents_total)}</td>
              <td className={styles.numericStrong}>{formatMinutes(member.time_saved_minutes)}</td>
            </tr>)}</tbody>
          </table>
        </div>
      )}
    </section>
  </section>;
}
