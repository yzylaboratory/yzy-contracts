import type { LucideIcon } from "lucide-react";
import styles from "./dashboard-insurance.module.css";

export type MetricTile = { key: string; label: string; value: string; context: string; icon: LucideIcon };

export function MetricTiles({ label, tiles }: { label: string; tiles: MetricTile[] }) {
  return <dl className={styles.tiles} aria-label={label}>
    {tiles.map(({ key, label: tileLabel, value, context, icon: Icon }) => <div key={key} className={styles.tile}>
      <dt className={styles.tileLabel}>
        <span className={styles.tileIcon} aria-hidden="true"><Icon size={15} /></span>
        <span>{tileLabel}</span>
      </dt>
      <dd className={styles.tileValue}>{value}</dd>
      <dd className={styles.tileContext}>{context}</dd>
    </div>)}
  </dl>;
}
