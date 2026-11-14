import { LoadingBlock } from "@/components/loading/loading-ui";
import styles from "../settings.module.css";
import skeletonStyles from "./preferences-skeleton.module.css";

export const preferencesLoadingLabel = "Cargando preferencias…";

export function PreferencesSkeleton() {
  return (
    <div className={styles.settings}>
      <div className={styles.panel}>
        <div className={skeletonStyles.heading}>
          <LoadingBlock width={170} height={16} />
        </div>

        <div className={styles.fields}>
          <div className={skeletonStyles.field}>
            <LoadingBlock width={152} height={16} />
            <LoadingBlock height={44} className={skeletonStyles.control} />
          </div>
        </div>

        <div className={`${styles.copyField} ${skeletonStyles.copyField}`}>
          <div className={styles.checkbox}>
            <LoadingBlock width={20} height={20} className={skeletonStyles.checkbox} />
            <LoadingBlock width={242} />
          </div>
          <div className={`${styles.hint} ${skeletonStyles.hint}`}>
            <LoadingBlock width={870} height={12} />
            <LoadingBlock width="70%" height={12} className={skeletonStyles.secondLine} />
            <LoadingBlock width="85%" height={12} className={skeletonStyles.thirdLine} />
            <LoadingBlock width="48%" height={12} className={skeletonStyles.fourthLine} />
          </div>
        </div>
      </div>

      <div className={styles.actions}>
        <div className={styles.buttons}>
          <LoadingBlock width={108} height={44} className={skeletonStyles.button} />
          <LoadingBlock width={166} height={44} className={skeletonStyles.button} />
        </div>
      </div>
    </div>
  );
}
