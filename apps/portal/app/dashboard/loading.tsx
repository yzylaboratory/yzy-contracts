import { LoadingBlock, LoadingContent } from "@/components/loading/loading-ui";
import styles from "./dashboard.module.css";

const metricWidths = [112, 150, 132, 140];
const barHeights = [38, 66, 85, 76, 122, 57];
const formatWidths = [40, 50, 44];
const caseWidths = [96, 168, 200, 128];

export default function DashboardLoading() {
  return (
    <LoadingContent label="Cargando el Dashboard…">
      <div className={styles.dashboardSkeleton}>
        <div className={styles.metrics}>
          {metricWidths.map(width => (
            <div className={styles.metricSkeleton} key={width}>
              <LoadingBlock width={width} height={14} />
              <LoadingBlock width={52} height={40} />
            </div>
          ))}
        </div>

        <div className={styles.analytics}>
          <div className={`${styles.panel} ${styles.monthly}`}>
            <div className={styles.skeletonTitle}>
              <LoadingBlock width={248} height={16} />
            </div>
            <div className={styles.chartSkeleton}>
              <div className={styles.barReadoutSkeleton}>
                <LoadingBlock width={120} height={14} />
                <LoadingBlock width={116} height={32} />
                <LoadingBlock width={146} height={14} />
              </div>
              <div className={styles.barChartSkeleton}>
                <div className={styles.plotSkeleton}>
                  {barHeights.map(height => (
                    <LoadingBlock className={styles.barSkeleton} width="min(28px, 100%)" height={height} key={height} />
                  ))}
                </div>
                <div className={styles.ticksSkeleton}>
                  {[0, 1, 2, 3].map(tick => <LoadingBlock width={18} height={10} key={tick} />)}
                </div>
                <div className={styles.monthsSkeleton}>
                  {barHeights.map(height => <LoadingBlock width={24} height={10} key={height} />)}
                </div>
              </div>
            </div>
          </div>

          <div className={`${styles.panel} ${styles.formats}`}>
            <div className={styles.skeletonTitle}>
              <LoadingBlock width={190} height={16} />
            </div>
            <div className={styles.donutSkeleton}>
              <div className={styles.donutSkeletonContent}>
                <div className={styles.ringSkeleton}>
                  <LoadingBlock width={38} height={10} />
                  <LoadingBlock width={36} height={23} />
                  <LoadingBlock width={58} height={10} />
                </div>
                <div className={styles.legendSkeleton}>
                  {formatWidths.map(width => (
                    <div className={styles.formatSkeleton} key={width}>
                      <LoadingBlock className={styles.legendDotSkeleton} width={10} height={10} />
                      <LoadingBlock width={width} height={14} />
                      <LoadingBlock width={18} height={14} />
                      <LoadingBlock className={styles.shareSkeleton} width={30} height={14} />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className={`${styles.panel} ${styles.recent}`}>
          <div className={`${styles.panelHeader} ${styles.skeletonTitle}`}>
            <LoadingBlock width={168} height={16} />
            <LoadingBlock width={58} height={14} />
          </div>
          <div className={`${styles.tableScroll} ${styles.tableSkeletonViewport}`}>
            <table className={`${styles.table} ${styles.tableSkeleton}`}>
              <colgroup>
                <col style={{ width: "22%" }} />
                <col style={{ width: "28%" }} />
                <col style={{ width: "20%" }} />
                <col style={{ width: "18%" }} />
                <col style={{ width: "12%" }} />
              </colgroup>
              <thead>
                <tr>
                  <th><LoadingBlock width={78} height={12} /></th>
                  <th><LoadingBlock width={58} height={12} /></th>
                  <th><LoadingBlock width={54} height={12} /></th>
                  <th><LoadingBlock width={54} height={12} /></th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {caseWidths.map(width => (
                  <tr key={width}>
                    <th><LoadingBlock width={72} height={14} /></th>
                    <td><LoadingBlock width={width} height={14} /></td>
                    <td><LoadingBlock width={64} height={14} /></td>
                    <td><LoadingBlock width={84} height={14} /></td>
                    <td><LoadingBlock className={styles.actionSkeleton} width={18} height={18} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </LoadingContent>
  );
}
