import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import type { Variation } from "./dashboard-format";
import styles from "./dashboard.module.css";

const arrows = { up: "▲", down: "▼", flat: "" } as const;
const spoken = { up: "Subió", down: "Bajó", flat: "" } as const;

export type StatCardProps = {
  label: string;
  icon: LucideIcon;
  value: string;
  variation?: Variation | null;
  context: ReactNode;
};

/** The only figure card of the Dashboard. Every card has the same four rows, so neighbours line up whether or not they show a variation. */
export function StatCard({ label, icon: Icon, value, variation, context }: StatCardProps) {
  return <div className={styles.card}>
    <dt className={styles.cardLabel}>
      <span className={styles.cardIcon} aria-hidden="true"><Icon size={15} /></span>
      <span>{label}</span>
    </dt>
    <dd className={styles.cardValue}>{value}</dd>
    {variation
      ? <dd className={styles.cardVariation} data-tone={variation.tone}>
        <span className={styles.cardChange}>
          {variation.direction !== "flat" && <span aria-hidden="true">{arrows[variation.direction]} </span>}
          {variation.direction !== "flat" && <span className={styles.srOnly}>{spoken[variation.direction]} </span>}
          {variation.text}
        </span>
        <span className={styles.cardReference}>{variation.reference}</span>
      </dd>
      : <dd className={styles.cardVariation} aria-hidden="true" />}
    <dd className={styles.cardContext}>{context}</dd>
  </div>;
}

export function StatGrid({ label, children }: { label: string; children: ReactNode }) {
  return <dl className={styles.cards} aria-label={label}>{children}</dl>;
}
