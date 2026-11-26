import { LoadingBlock, LoadingContent } from "@/components/loading/loading-ui";
import styles from "./dashboard.module.css";
import sections from "./dashboard-insurance.module.css";
import { InsuranceAttentionSkeleton, InsuranceCarrierSkeleton, TilesSkeleton } from "./insurance-skeletons";

const metricWidths = [112, 150, 132, 140];
const barHeights = [38, 66, 85, 76, 122, 57];
const formatWidths = [40, 50, 44];
const recentCaseWidths = [96, 168, 200, 128];
const teamUserWidths = [140, 110, 130];
const stageSkeletonData = [
  { name: 60, hint: 50, fill: "64%" },
  { name: 72, hint: 78, fill: "38%" },
  { name: 40, hint: 92, fill: "22%" },
  { name: 80, hint: 84, fill: "50%" },
  { name: 54, hint: 60, fill: "18%" },
];

export default function DashboardLoading() {
  return (
    <LoadingContent label="Cargando el Dashboard…">
      <div className={styles.dashboardSkeleton}>
        {/* 1. Totales */}
        <TilesSkeleton count={4} />

        {/* 2. Contratos (Skeleton adaptable independiente del hero) */}
        <div className={styles.metrics}>
          {metricWidths.map(width => (
            <div className={styles.metricSkeleton} key={width}>
              <LoadingBlock width={width} height={14} />
              <LoadingBlock width={52} height={40} />
            </div>
          ))}
        </div>

        {/* 3. Pólizas: filtros y cifras */}
        <div className={sections.filters}>
          <LoadingBlock height={58} />
          <LoadingBlock height={58} />
          <LoadingBlock width={92} height={40} />
        </div>
        <TilesSkeleton count={4} />

        {/* 4. Pipeline + Pendiente por aseguradora */}
        <div className={styles.analytics}>
          {/* Pipeline: Estado de contratos y desembolsos */}
          <div className={`${styles.panel} ${styles.pipeline}`}>
            <div className={styles.panelHeader}>
              <div>
                <LoadingBlock width={230} height={18} />
                <div style={{ marginTop: 6 }}>
                  <LoadingBlock width={280} height={12} />
                </div>
              </div>
              <LoadingBlock width={92} height={28} />
            </div>

            <div className={styles.stageList}>
              {stageSkeletonData.map((stage, i) => (
                <div className={styles.stageRowSkeleton} key={i}>
                  <div className={styles.stageInfo}>
                    <LoadingBlock width={stage.name} height={14} />
                    <div style={{ marginTop: 3 }}>
                      <LoadingBlock width={stage.hint} height={11} />
                    </div>
                  </div>
                  <div className={styles.stageTrackSkeleton}>
                    <LoadingBlock width={stage.fill} height={10} />
                  </div>
                  <div className={styles.stageNumbers}>
                    <LoadingBlock width={20} height={14} />
                    <LoadingBlock width={26} height={12} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Pendiente por aseguradora */}
          <div className={`${styles.panel} ${sections.narrow}`}>
            <div className={styles.panelHeader}>
              <LoadingBlock width={190} height={18} />
            </div>
            <InsuranceCarrierSkeleton />
          </div>
        </div>

        {/* 5. Pagos que requieren atención + Expedientes recientes */}
        <div className={styles.analytics}>
          <div className={`${styles.panel} ${sections.wide}`}>
            <div className={`${styles.panelHeader} ${styles.skeletonTitle}`}>
              <LoadingBlock width={220} height={18} />
              <LoadingBlock width={150} height={28} />
            </div>
            <InsuranceAttentionSkeleton />
          </div>
          <div className={`${styles.panel} ${styles.recent} ${sections.narrow}`}>
            <div className={`${styles.panelHeader} ${styles.skeletonTitle}`}>
              <LoadingBlock width={168} height={18} />
              <LoadingBlock width={64} height={28} />
            </div>
            <div className={`${styles.tableScroll} ${styles.tableSkeletonViewport}`}>
              <table className={`${styles.table} ${styles.tableSkeleton}`}>
                <colgroup>
                  <col style={{ width: "18%" }} />
                  <col style={{ width: "26%" }} />
                  <col style={{ width: "18%" }} />
                  <col style={{ width: "18%" }} />
                  <col style={{ width: "14%" }} />
                  <col style={{ width: "6%" }} />
                </colgroup>
                <thead>
                  <tr>
                    <th><LoadingBlock width={72} height={11} /></th>
                    <th><LoadingBlock width={54} height={11} /></th>
                    <th><LoadingBlock width={50} height={11} /></th>
                    <th><LoadingBlock width={76} height={11} /></th>
                    <th><LoadingBlock width={52} height={11} /></th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {recentCaseWidths.map((width, i) => (
                    <tr key={i}>
                      <th><LoadingBlock width={72} height={14} /></th>
                      <td><LoadingBlock width={width} height={14} /></td>
                      <td><LoadingBlock width={68} height={18} /></td>
                      <td><LoadingBlock width={84} height={14} /></td>
                      <td><LoadingBlock width={74} height={14} /></td>
                      <td><LoadingBlock className={styles.actionSkeleton} width={18} height={18} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* 6. Gráfico mensual + Gráfico de formatos */}
        <div className={styles.analytics}>
          <div className={`${styles.panel} ${styles.monthly}`}>
            <div className={styles.skeletonTitle}>
              <LoadingBlock width={248} height={18} />
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
              <LoadingBlock width={190} height={18} />
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

        {/* 7. Rendimiento y desembolsos por usuario */}
        <div className={styles.analytics}>
          <div className={`${styles.panel} ${styles.teamPanel}`}>
            <div className={styles.panelHeader}>
              <div>
                <LoadingBlock width={260} height={18} />
                <div style={{ marginTop: 6 }}>
                  <LoadingBlock width={340} height={12} />
                </div>
              </div>
            </div>

            <div className={`${styles.tableScroll} ${styles.tableSkeletonViewport}`}>
              <table className={`${styles.table} ${styles.tableSkeleton}`}>
                <colgroup>
                  <col style={{ width: "28%" }} />
                  <col style={{ width: "16%" }} />
                  <col style={{ width: "14%" }} />
                  <col style={{ width: "14%" }} />
                  <col style={{ width: "10%" }} />
                  <col style={{ width: "18%" }} />
                </colgroup>
                <thead>
                  <tr>
                    <th><LoadingBlock width={64} height={11} /></th>
                    <th><LoadingBlock width={72} height={11} /></th>
                    <th><LoadingBlock width={58} height={11} /></th>
                    <th><LoadingBlock width={64} height={11} /></th>
                    <th><LoadingBlock width={36} height={11} /></th>
                    <th><LoadingBlock width={84} height={11} /></th>
                  </tr>
                </thead>
                <tbody>
                  {teamUserWidths.map((width, i) => (
                    <tr key={i}>
                      <th>
                        <div className={styles.userCell}>
                          <LoadingBlock width={width} height={14} />
                          {i === 0 && <LoadingBlock width={26} height={16} />}
                        </div>
                      </th>
                      <td><LoadingBlock width={24} height={14} /></td>
                      <td><LoadingBlock width={20} height={14} /></td>
                      <td><LoadingBlock width={20} height={14} /></td>
                      <td><LoadingBlock width={20} height={14} /></td>
                      <td><LoadingBlock width={54} height={14} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </LoadingContent>
  );
}
