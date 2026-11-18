import { LoadingBlock } from "@/components/loading/loading-ui";
import styles from "./clients.module.css";

export function ClientRowsSkeleton() {
  return (
    <ul className={styles.rows}>
      {[172, 220, 146, 196].map(width => (
        <li key={width} className={styles.rowPlaceholder}>
          <LoadingBlock width={width} height={18} />
          <LoadingBlock width={105} height={13} />
        </li>
      ))}
    </ul>
  );
}

export function ClientDirectorySkeleton() {
  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <LoadingBlock width={160} height={20} />
        <LoadingBlock width={124} height={44} />
      </div>
      <div className={styles.search}>
        <LoadingBlock height={44} />
        <LoadingBlock width={82} height={44} />
      </div>
      <ClientRowsSkeleton />
    </div>
  );
}

export function DocumentsRowsSkeleton() {
  return <div className={styles.documentStageSkeleton}>
    {[176, 134, 158].map(width => <div key={width} className={styles.documentStagePlaceholder}>
      <LoadingBlock width={42} height={42} />
      <div className={styles.rowPlaceholder}>
        <LoadingBlock width={width} height={16} />
        <LoadingBlock width={86} height={12} />
      </div>
    </div>)}
  </div>;
}

export function TimelineSkeleton() {
  return <div className={styles.stack}>
    <LoadingBlock width={134} height={16} />
    <ul className={styles.rows}>
      {[146, 118].map(width => <li key={width} className={styles.timelinePlaceholder}>
        <LoadingBlock width={11} height={11} />
        <LoadingBlock width={42} height={14} />
        <div className={styles.rowPlaceholder}>
          <LoadingBlock width={width} height={17} />
          <LoadingBlock width={100} height={13} />
        </div>
      </li>)}
    </ul>
  </div>;
}

export function ClientRecordSkeleton() {
  return (
    <div className={styles.recordFrame}>
      <div className={styles.recordLayout}>
        <div className={styles.stack}>
          <div className={styles.panel}>
            <div className={styles.header}>
              <LoadingBlock width={185} height={20} />
              <LoadingBlock width={120} height={44} />
            </div>
            <div className={styles.summary}>
              <LoadingBlock width={142} height={36} />
              <LoadingBlock width={112} height={36} />
            </div>
          </div>
          <div className={styles.panel}>
            <div className={styles.header}>
              <LoadingBlock width={142} height={20} />
              <LoadingBlock width={112} height={44} />
            </div>
            <div className={styles.summary}>
              <LoadingBlock width={158} height={36} />
              <LoadingBlock width={116} height={36} />
            </div>
          </div>
          <div className={styles.panel}>
            <div className={styles.header}>
              <LoadingBlock width={186} height={20} />
              <LoadingBlock width={154} height={44} />
            </div>
            <DocumentsRowsSkeleton />
          </div>
        </div>
        <div className={styles.panel}>
          <div className={styles.header}>
            <LoadingBlock width={168} height={20} />
            <LoadingBlock width={116} height={14} />
          </div>
          <TimelineSkeleton />
        </div>
      </div>
    </div>
  );
}
