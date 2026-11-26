import type { ReactNode } from "react";
import { LoadingBlock } from "@/components/loading/loading-ui";
import styles from "./dashboard.module.css";

const rowWidths = [86, 64, 78, 92, 70];

function CardSkeleton({ className }: { className?: string }) {
  return <div className={className ? `${styles.card} ${className}` : styles.card}>
    <LoadingBlock width={120} height={18} />
    <LoadingBlock width={140} height={28} />
    <LoadingBlock width={110} height={16} />
    <div className={styles.cardContext}><LoadingBlock width={170} height={14} /></div>
  </div>;
}

function PairSkeleton({ titleWidth }: { titleWidth: number }) {
  return <div className={styles.pair}>
    <div className={styles.bentoHeading}><LoadingBlock width={titleWidth} height={22} /></div>
    {[1, 2, 3, 4].map(item => <CardSkeleton key={item} />)}
  </div>;
}

function TableSkeleton({ columns, rows }: { columns: number; rows: number }) {
  return <div className={styles.rowsSkeleton}>
    {Array.from({ length: rows }, (_, row) => <div className={styles.rowSkeleton} style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }} key={row}>
      {Array.from({ length: columns }, (_, column) => <LoadingBlock key={column} width={`${rowWidths[(row + column) % rowWidths.length]}%`} height={14} />)}
    </div>)}
  </div>;
}

function PanelSkeleton({ className, titleWidth, children }: { className: string; titleWidth: number; children: ReactNode }) {
  return <div className={`${styles.panel} ${className}`}>
    <div className={styles.panelHeader}>
      <LoadingBlock width={titleWidth} height={20} />
      <LoadingBlock width={110} height={28} />
    </div>
    {children}
  </div>;
}

/** Same bento grid as the loaded Dashboard, in the same order and with the same spans. The caller wraps it in LoadingContent. */
export function DashboardSkeleton() {
  return <div className={styles.content}>
    <div className={styles.bento}>
      <div className={styles.attention}>
        <div className={styles.bentoHeading}><LoadingBlock width={150} height={22} /></div>
        <div className={styles.attentionList}>
          {[1, 2, 3, 4].map(item => <div className={styles.attentionItem} key={item}>
            <LoadingBlock width={130} height={16} />
            <LoadingBlock width={110} height={26} />
            <LoadingBlock width={150} height={14} />
          </div>)}
        </div>
      </div>

      <PairSkeleton titleWidth={90} />
      <PairSkeleton titleWidth={70} />

      <div className={`${styles.panel} ${styles.trendPanel}`}>
        <LoadingBlock width={190} height={22} />
        <div className={styles.trends}>
          {[1, 2, 3].map(item => <div className={styles.trendSkeleton} key={item}>
            <LoadingBlock width={130} height={16} />
            <LoadingBlock width={150} height={28} />
            <LoadingBlock width={110} height={14} />
            <LoadingBlock height={112} />
            <LoadingBlock height={12} />
          </div>)}
        </div>
      </div>

      <div className={styles.panelRows}>
        <PanelSkeleton className={styles.wide} titleWidth={220}><TableSkeleton columns={7} rows={4} /></PanelSkeleton>
        <PanelSkeleton className={styles.narrow} titleWidth={170}><TableSkeleton columns={2} rows={4} /></PanelSkeleton>
        <PanelSkeleton className={`${styles.narrow} ${styles.carrierPanel}`} titleWidth={190}><TableSkeleton columns={2} rows={3} /></PanelSkeleton>
        <PanelSkeleton className={`${styles.wide} ${styles.stalledPanel}`} titleWidth={210}><TableSkeleton columns={5} rows={4} /></PanelSkeleton>
      </div>

      <div className={styles.productivity}>
        <div className={styles.bentoHeading}><LoadingBlock width={130} height={22} /></div>
        <CardSkeleton className={styles.timeCard} />
        <PanelSkeleton className={styles.documentsPanel} titleWidth={180}><LoadingBlock height={156} /></PanelSkeleton>
        <PanelSkeleton className={styles.historyPanel} titleWidth={200}><TableSkeleton columns={6} rows={3} /></PanelSkeleton>
      </div>
    </div>
  </div>;
}
