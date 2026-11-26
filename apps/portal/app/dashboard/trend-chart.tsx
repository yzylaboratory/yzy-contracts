"use client";

import { useId, useState, type KeyboardEvent } from "react";
import { monthLabel } from "./dashboard-format";
import styles from "./trend-chart.module.css";

const axisMonth = new Intl.DateTimeFormat("es-DO", { month: "short", year: "2-digit", timeZone: "UTC" });
const axisText = (month: string) => axisMonth.format(new Date(`${month}-01T00:00:00Z`));

export type TrendPoint = { month: string; value: number };

/**
 * One measure over 12 months on its own scale. The latest month is the highlighted column; the others sit back.
 * Hover, touch or the arrow keys read any month; a table view and a live reading carry the same data for screen readers.
 */
export function TrendChart({ title, points, format }: {
  title: string;
  points: readonly TrendPoint[];
  format: (value: number) => string;
}) {
  const titleId = useId();
  const [active, setActive] = useState<number | null>(null);
  const last = points.length - 1;
  const first = points[0];
  const latest = points[last];
  if (!first || !latest) return <p className={styles.empty}>No hay datos para {title.toLocaleLowerCase("es-DO")}.</p>;

  const peak = points.reduce((best, point) => Math.max(best, point.value), 0);
  const index = active === null ? last : active;
  const reading = points[index] ?? latest;
  const readingText = `${monthLabel(reading.month)}${index === last ? ", mes actual" : ""}: ${format(reading.value)}`;

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") { setActive(null); return; }
    const from = active ?? last + 1;
    const next = ({ ArrowLeft: from - 1, ArrowDown: from - 1, ArrowRight: active === null ? last : from + 1, ArrowUp: active === null ? last : from + 1, Home: 0, End: last } as Record<string, number>)[event.key];
    if (next === undefined) return;
    event.preventDefault();
    setActive(Math.min(last, Math.max(0, next)));
  };

  return <figure className={styles.trend} aria-labelledby={titleId}>
    <figcaption className={styles.header}>
      <h3 id={titleId} className={styles.title}>{title}</h3>
      <span className={styles.value} aria-hidden="true">{format(reading.value)}</span>
      <span className={styles.when} aria-hidden="true">{monthLabel(reading.month)}{index === last ? " · mes actual" : ""}</span>
    </figcaption>
    <div className={styles.plot} data-scrubbing={active !== null || undefined} role="group" tabIndex={0}
      aria-label={`${title}. Recorre los meses con las flechas.`}
      onKeyDown={onKeyDown} onBlur={() => setActive(null)}
      onFocus={event => { if (event.currentTarget.matches(":focus-visible")) setActive(current => current ?? last); }}
      onPointerLeave={event => { if (event.pointerType === "mouse") setActive(null); }}>
      <ol className={styles.columns}>
        {points.map((point, at) => <li key={point.month} className={styles.slot}
          onPointerEnter={() => setActive(at)} onPointerDown={() => setActive(at)}>
          <span className={styles.bar} data-current={at === last || undefined} data-active={at === active || undefined}
            style={{ blockSize: peak > 0 && point.value > 0 ? `max(2px, ${(point.value / peak) * 100}%)` : "0" }} />
        </li>)}
      </ol>
    </div>
    <div className={styles.axis} aria-hidden="true">
      <span>{axisText(first.month)}</span>
      <span>Máx. {format(peak)}</span>
      <span>{axisText(latest.month)}</span>
    </div>
    <p className={styles.srOnly} aria-live="polite" aria-atomic="true">{active === null ? "" : readingText}</p>
    <table className={styles.srOnly}>
      <caption>{title}, últimos 12 meses</caption>
      <thead><tr><th scope="col">Mes</th><th scope="col">{title}</th></tr></thead>
      <tbody>{points.map((point, at) => <tr key={point.month}>
        <th scope="row">{monthLabel(point.month)}{at === last ? " (mes actual)" : ""}</th>
        <td>{format(point.value)}</td>
      </tr>)}</tbody>
    </table>
  </figure>;
}
