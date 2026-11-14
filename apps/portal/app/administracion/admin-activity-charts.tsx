import { BarChart } from "@/components/arc/bar-chart/bar-chart";
import { activityScreenLabels, type DashboardActivity } from "./admin-api";
import styles from "./admin-dashboard.module.css";

const dateLabel = new Intl.DateTimeFormat("es-DO", { day: "numeric", month: "short", timeZone: "UTC" });
const fullDate = new Intl.DateTimeFormat("es-DO", { dateStyle: "full", timeZone: "UTC" });
const count = new Intl.NumberFormat("es-DO");

export function AdminActivityCharts({ activity }: { activity?: DashboardActivity }) {
  if (!activity) {
    return <p className={styles.muted}>Los indicadores de actividad no están disponibles.</p>;
  }

  const { daily_users: days, top_screens: screens } = activity;
  if (!screens.length || !days.length) {
    return <p className={styles.muted}>No hay visitas registradas en los últimos 7 días.</p>;
  }

  const period = dateLabel.formatRange(new Date(days[0].day), new Date(days[days.length - 1].day));
  const mostVisits = screens[0].visits;
  const dailyUsers = days.map(({ day, users }) => {
    const date = new Date(day);
    return { key: day, label: fullDate.format(date), axisLabel: dateLabel.format(date), value: users };
  });

  return (
    <div className={styles.activityCharts}>
      <p className={styles.muted}>Últimos 7 días, incluido hoy · Hora de Santo Domingo</p>
      <div className={styles.chartGrid}>
        <section className={styles.chartCard} aria-labelledby="admin-daily-users">
          <h3 id="admin-daily-users">Usuarios únicos por día</h3>
          <BarChart data={dailyUsers} label="Usuarios únicos por día" period={period}
            averageLabel="Promedio diario" valueLabel="Usuarios únicos" categoryLabel="Día"
            height={144} />
        </section>
        <section className={styles.chartCard} aria-labelledby="admin-top-screens">
          <h3 id="admin-top-screens">Pantallas con más visitas</h3>
          <ol className={styles.screenRank}>
            {screens.map(({ screen, visits }) => (
              <li key={screen}>
                <span>{activityScreenLabels[screen]}</span>
                <span>{count.format(visits)} {visits === 1 ? "visita" : "visitas"}</span>
                <span className={styles.visitTrack} aria-hidden="true">
                  <span style={{ inlineSize: `${(visits / mostVisits) * 100}%` }} />
                </span>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </div>
  );
}
