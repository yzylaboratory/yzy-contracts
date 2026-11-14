import { LoadingBlock } from "@/components/loading/loading-ui";
import styles from "./generate-document.module.css";

const contractFields = [
  { labelWidth: 140 },
  { labelWidth: 126 },
  { labelWidth: 156 },
  { labelWidth: 144 },
  { labelWidth: 136, width: "wide" },
  { labelWidth: 96, width: "compact" },
  { labelWidth: 102, width: "compact" },
  { labelWidth: 84, width: "compact" },
];

function FieldSkeleton({ labelWidth, height = "var(--control-height-md)" }: { labelWidth: number; height?: number | string }) {
  return (
    <div className={styles.skeletonField}>
      <LoadingBlock className={styles.skeletonLabel} width={labelWidth} height={12} />
      <LoadingBlock className={styles.skeletonControl} height={height} />
    </div>
  );
}

export function GenerateDocumentSkeleton() {
  return (
    <div className={styles.form}>
      <div className={styles.top}>
        <div className={`${styles.panel} ${styles.dataPanel}`}>
          <LoadingBlock className={styles.skeletonTitle} width={148} height={16} />
          <div className={styles.fields}>
            {contractFields.map(({ labelWidth, width }) => (
              <div key={labelWidth} className={styles.field} data-width={width}>
                <FieldSkeleton labelWidth={labelWidth} />
              </div>
            ))}
          </div>
        </div>

      </div>
      <div className={styles.actionBar}>
        <div className={styles.actionRow}>
          <LoadingBlock className={styles.skeletonTitle} width={156} height={16} />
          <div className={styles.actionButtons}>
            {[0, 1, 2, 3].map(index => <LoadingBlock key={index} className={styles.skeletonOutput} width={96} height="var(--control-height-md)" />)}
          </div>
        </div>
      </div>
    </div>
  );
}
