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
  className?: string;
};

/** The only figure card of the Dashboard, in the panel look. Label, value and variation sit on top; the context is pinned to the bottom, so a stretched card leaves no loose gap. */
export function StatCard({ label, icon: Icon, value, variation, context, className }: StatCardProps) {
  return <article className={className ? `${styles.card} ${className}` : styles.card}>
    <h3 className={styles.cardLabel}>
      <span className={styles.cardIcon} aria-hidden="true"><Icon size={15} /></span>
      <span>{label}</span>
    </h3>
    <p className={styles.cardValue}>{value}</p>
    {variation
      ? <p className={styles.cardVariation} data-tone={variation.tone}>
        <span className={styles.cardChange}>
          {variation.direction !== "flat" && <span aria-hidden="true">{arrows[variation.direction]} </span>}
          {variation.direction !== "flat" && <span className={styles.srOnly}>{spoken[variation.direction]} </span>}
          {variation.text}
        </span>
        <span className={styles.cardReference}>{variation.reference}</span>
      </p>
      : <p className={styles.cardVariation} aria-hidden="true" />}
    <p className={styles.cardContext}>{context}</p>
  </article>;
}
