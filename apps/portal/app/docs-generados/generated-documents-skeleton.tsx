import { LoadingBlock } from "@/components/loading/loading-ui";
import shared from "../contratos/contracts.module.css";
import styles from "./generated-documents.module.css";

const filterLabels = [116, 54, 128];
const documentTitles = [214, 176, 200, 168, 216, 192];

export function GeneratedDocumentsSkeleton() {
  return (
    <div className={`${shared.panel} ${styles.panel}`}>
      <div className={shared.filterGrid}>
        {filterLabels.map(width => (
          <div className={styles.skeletonField} key={width}>
            <LoadingBlock width={width} height={16} />
            <LoadingBlock className={styles.skeletonControl} height={44} />
          </div>
        ))}
        <LoadingBlock className={styles.skeletonPager} height={44} />
      </div>

      <div className={shared.tableScroll}>
        <table className={`${shared.table} ${styles.table} ${styles.skeletonTable}`}>
          <colgroup>
            <col />
            <col className={styles.skeletonDateColumn} />
            <col className={styles.skeletonFormatColumn} />
            <col className={styles.skeletonActionColumn} />
          </colgroup>
          <thead>
            <tr>
              <th><LoadingBlock width={56} height={14} /></th>
              <th><LoadingBlock width={62} height={14} /></th>
              <th><LoadingBlock width={54} height={14} /></th>
              <th />
            </tr>
          </thead>
          <tbody>
            {documentTitles.map(width => (
              <tr key={width}>
                <th>
                  <div className={styles.skeletonDocument}>
                    <LoadingBlock width={width} height={14} />
                    <LoadingBlock width={width + 88} height={12} />
                  </div>
                </th>
                <td><LoadingBlock width={82} height={14} /></td>
                <td><LoadingBlock className={styles.skeletonBadge} width={52} height={24} /></td>
                <td>
                  <div className={shared.rowActions}>
                    <LoadingBlock className={styles.skeletonAction} width={18} height={18} />
                    <LoadingBlock className={styles.skeletonAction} width={18} height={18} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className={shared.paginationBar}>
        <div className={shared.paginationSummary}>
          <LoadingBlock width={202} height={14} />
          <div className={shared.rowPicker}>
            <LoadingBlock width={28} height={14} />
            <LoadingBlock className={styles.skeletonControl} width={64} height={44} />
          </div>
        </div>
        <div className={shared.pagination}>
          <LoadingBlock
            className={`${styles.skeletonPager} ${styles.skeletonPrevious}`}
            width="var(--pager-width)"
            height={44}
          />
          {[1, 2, 3].map(page => (
            <LoadingBlock className={styles.skeletonPageNumber} key={page} width={44} height={44} />
          ))}
          <LoadingBlock width={12} height={4} />
          <LoadingBlock className={styles.skeletonPageNumber} width={44} height={44} />
          <LoadingBlock
            className={`${styles.skeletonPager} ${styles.skeletonNext}`}
            width="var(--pager-width)"
            height={44}
          />
        </div>
      </div>
    </div>
  );
}
