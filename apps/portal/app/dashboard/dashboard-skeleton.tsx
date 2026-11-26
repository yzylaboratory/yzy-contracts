import { LoadingBlock } from "@/components/loading/loading-ui";
import styles from "./dashboard.module.css";

const rowWidths = [86, 64, 78, 92, 70];

function CardSkeleton() {
  return <div className={styles.card}>
    <LoadingBlock width={120} height={18} />
    <LoadingBlock width={140} height={30} />
    <LoadingBlock width={110} height={16} />
    <LoadingBlock width={170} height={14} />
  </div>;
}

function GroupSkeleton({ titleWidth }: { titleWidth: number }) {
  return <div className={styles.group}>
    <LoadingBlock width={titleWidth} height={22} />
    <div className={styles.cards}>{[1, 2, 3, 4].map(item => <CardSkeleton key={item} />)}</div>
  </div>;
}

function TableSkeleton({ columns, rows }: { columns: number; rows: number }) {
  return <div className={styles.rowsSkeleton}>
    {Array.from({ length: rows }, (_, row) => <div className={styles.rowSkeleton} style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }} key={row}>
      {Array.from({ length: columns }, (_, column) => <LoadingBlock key={column} width={`${rowWidths[(row + column) % rowWidths.length]}%`} height={14} />)}
    </div>)}
  </div>;
}

function PanelSkeleton({ className, titleWidth, children }: { className: string; titleWidth: number; children: React.ReactNode }) {
  return <div className={`${styles.panel} ${className}`}>
    <div className={styles.panelHeader}>
      <LoadingBlock width={titleWidth} height={20} />
      <LoadingBlock width={110} height={28} />
    </div>
    {children}
  </div>;
}

export function ToolbarSkeleton() {
  return <div className={styles.toolbar}><LoadingBlock height={58} /></div>;
}

/** Same structure as the loaded Dashboard, minus the period selector. The caller wraps it in LoadingContent. */
export function DashboardSkeleton() {
  return <div className={styles.content}>
    <div className={styles.attention}>
      <LoadingBlock width={150} height={22} />
      <div className={styles.attentionList}>
        {[1, 2, 3, 4].map(item => <div className={styles.attentionItem} key={item}>
          <LoadingBlock width={130} height={16} />
          <LoadingBlock width={110} height={26} />
          <LoadingBlock width={150} height={14} />
        </div>)}
      </div>
    </div>

    <div className={styles.figures}>
      <GroupSkeleton titleWidth={90} />
      <GroupSkeleton titleWidth={70} />
    </div>

    <div className={styles.group}>
      <LoadingBlock width={190} height={22} />
      <div className={`${styles.panel} ${styles.trends}`}>
        {[1, 2, 3].map(item => <div className={styles.trendSkeleton} key={item}>
          <LoadingBlock width={130} height={16} />
          <LoadingBlock width={150} height={28} />
          <LoadingBlock width={110} height={14} />
          <LoadingBlock height={112} />
          <LoadingBlock height={12} />
        </div>)}
      </div>
    </div>

    <div className={styles.analytics}>
      <PanelSkeleton className={styles.wide} titleWidth={220}><TableSkeleton columns={7} rows={4} /></PanelSkeleton>
      <PanelSkeleton className={styles.narrow} titleWidth={170}><TableSkeleton columns={2} rows={4} /></PanelSkeleton>
    </div>

    <div className={styles.analytics}>
      <PanelSkeleton className={styles.wide} titleWidth={210}><TableSkeleton columns={5} rows={4} /></PanelSkeleton>
      <PanelSkeleton className={styles.narrow} titleWidth={190}><TableSkeleton columns={2} rows={3} /></PanelSkeleton>
    </div>

    <div className={styles.group}>
      <LoadingBlock width={130} height={22} />
      <div className={styles.productivity}>
        <div className={styles.cards}><CardSkeleton /></div>
        <PanelSkeleton className={styles.narrow} titleWidth={180}><LoadingBlock height={156} /></PanelSkeleton>
      </div>
      <PanelSkeleton className={styles.wide} titleWidth={200}><TableSkeleton columns={6} rows={3} /></PanelSkeleton>
    </div>
  </div>;
}
