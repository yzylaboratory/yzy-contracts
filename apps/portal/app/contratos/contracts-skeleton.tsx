import { LoadingBlock } from "@/components/loading/loading-ui";
import styles from "./contracts.module.css";

const filterLabelWidths = [48, 61, 92];
const columnLabelWidths = [58, 69, 57, 86];
const contractNameWidths = [178, 205, 190, 136, 167];

export function ContractsSkeleton() {
  return (
    <>
      <div className={`${styles.panel} ${styles.filters}`}>
        <div className={styles.skeletonHeading}><LoadingBlock width={51} height={16} /></div>
        <div className={styles.filterGrid}>
          {filterLabelWidths.map(width => (
            <div key={width} className={styles.skeletonField}>
              <div className={styles.skeletonLabel}><LoadingBlock width={width} height={12} /></div>
              <LoadingBlock width="100%" height={44} className={styles.skeletonControl} />
            </div>
          ))}
          <LoadingBlock width="100%" height={44} className={styles.skeletonButton} />
        </div>
      </div>

      <div className={styles.panel}>
        <div className={styles.panelHeader}>
          <div className={styles.skeletonHeading}><LoadingBlock width={155} height={16} /></div>
          <LoadingBlock width={150} height={44} className={styles.skeletonButton} />
        </div>

        <div className={`${styles.tableScroll} ${styles.skeletonTable}`}>
          <table className={styles.table}>
            <thead>
              <tr>
                {columnLabelWidths.map(width => (
                  <th key={width}>
                    <div className={styles.skeletonLine}><LoadingBlock width={width} height={12} /></div>
                  </th>
                ))}
                <th />
              </tr>
            </thead>
            <tbody>
              {contractNameWidths.map(width => (
                <tr key={width}>
                  <th>
                    <div className={styles.skeletonLine}><LoadingBlock width={width} height={14} /></div>
                    <div className={`${styles.contractId} ${styles.skeletonLine}`}><LoadingBlock width={52} height={10} /></div>
                  </th>
                  <td><LoadingBlock width={60} height={13} /></td>
                  <td><LoadingBlock width={75} height={13} /></td>
                  <td><LoadingBlock width={18} height={13} /></td>
                  <td>
                    <div className={styles.rowActions}>
                      <div className={styles.skeletonAction}><LoadingBlock width={18} height={18} /></div>
                      <div className={styles.skeletonAction}><LoadingBlock width={18} height={18} /></div>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className={styles.paginationBar}>
          <div className={styles.paginationSummary}>
            <LoadingBlock width={208} height={13} />
            <div className={styles.rowPicker}>
              <LoadingBlock width={29} height={13} />
              <LoadingBlock width={64} height={44} className={styles.skeletonControl} />
            </div>
          </div>
          <div className={styles.pagination}>
            <LoadingBlock width={106} height={44} className={styles.skeletonButton} />
            {[1, 2, 3, 4].map(page => (
              <LoadingBlock key={page} width={44} height={44} className={styles.skeletonPage} />
            ))}
            <LoadingBlock width={111} height={44} className={styles.skeletonButton} />
          </div>
        </div>
      </div>
    </>
  );
}
