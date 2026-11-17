import type { ReactNode } from "react";
import { Badge, type BadgeTone } from "../badge/badge";
import styles from "./timeline.module.css";

const timeZone = "America/Santo_Domingo";
const date = new Intl.DateTimeFormat("es-DO", { timeZone, dateStyle: "full" });
const clock = new Intl.DateTimeFormat("es-DO", {
  timeZone,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export type TimelineItem = {
  id: string;
  dateTime: string;
  title: string;
  details?: string[];
  content?: ReactNode;
  status?: { label: string; tone: BadgeTone };
};

/** Display entries in the order supplied by the caller, grouped by local date. */
export function Timeline({ items }: { items: TimelineItem[] }) {
  const groups: { day: string; latest: number; items: TimelineItem[] }[] = [];
  for (const item of items) {
    const day = date.format(new Date(item.dateTime));
    const time = new Date(item.dateTime).getTime();
    const previous = groups.at(-1);
    if (previous?.day === day) {
      previous.items.push(item);
      previous.latest = Math.max(previous.latest, time);
    } else groups.push({ day, latest: time, items: [item] });
  }
  // Only the day closest to today starts expanded; the rest start collapsed.
  const openDay = groups.reduce<(typeof groups)[number] | undefined>((best, group) => !best || group.latest > best.latest ? group : best, undefined)?.day;

  return (
    <div className={styles.timeline}>
      {groups.map(group => (
        <details className={styles.day} key={group.day} open={group.day === openDay}>
          <summary className={styles.daySummary}>
            <h3>{group.day}</h3>
            <span className={styles.dayCount}>{group.items.length === 1 ? "1 evento" : `${group.items.length} eventos`}</span>
          </summary>
          <ol className={styles.events} role="list">
            {group.items.map(item => (
              <li key={item.id} className={styles.event} data-tone={item.status?.tone}>
                <time className={styles.eventTime} dateTime={item.dateTime}>{clock.format(new Date(item.dateTime))}</time>
                <div className={styles.eventBody}>
                  <strong>{item.title}</strong>
                  {item.details?.map((detail, index) => <p key={index} className={styles.detail}>{detail}</p>)}
                  {item.content}
                </div>
                {item.status && <Badge tone={item.status.tone} size="sm" pill className={styles.eventResult}>{item.status.label}</Badge>}
              </li>
            ))}
          </ol>
        </details>
      ))}
    </div>
  );
}
