import signInStyles from "@/components/arc/blocks/sign-in/sign-in.module.css";
import { LoadingBlock, LoadingContent } from "@/components/loading/loading-ui";
import styles from "./page.module.css";

export default function LoginLoading() {
  return (
    <div className={signInStyles.signIn}>
      <LoadingContent label="Cargando el acceso…">
        <div className={signInStyles.heading}>
          <div className={styles.loadingTitle}>
            <LoadingBlock width="min(320px, 90%)" height={28} />
          </div>
          <div className={styles.loadingDescription}>
            <LoadingBlock width="min(306px, 95%)" height={14} />
          </div>
        </div>

        <div className={`${signInStyles.card} ${signInStyles.options}`}>
          <div className={styles.loadingCardTitle}>
            <LoadingBlock width={76} height={12} />
          </div>
          <LoadingBlock className={styles.loadingButton} height={52} />
          <LoadingBlock className={styles.loadingButton} height={52} />
          <div className={`${signInStyles.divider} ${styles.loadingDivider}`}>
            <LoadingBlock width={10} height={10} />
          </div>
          <LoadingBlock className={styles.loadingButton} height={52} />
        </div>
      </LoadingContent>
    </div>
  );
}
