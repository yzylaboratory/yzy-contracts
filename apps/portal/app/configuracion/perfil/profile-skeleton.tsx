import { LoadingBlock } from "@/components/loading/loading-ui";
import styles from "../settings.module.css";
import skeletonStyles from "./profile-skeleton.module.css";

export const profileLoadingLabel = "Cargando perfil…";

export function ProfileSkeleton() {
  return (
    <div className={styles.settings}>
      <div className={styles.panel}>
        <div className={skeletonStyles.heading}>
          <LoadingBlock width={114} height={16} />
        </div>
        <LoadingBlock width={64} height={64} className={skeletonStyles.avatar} />

        <div className={styles.fields}>
          <div className={skeletonStyles.field}>
            <LoadingBlock width={48} height={16} />
            <LoadingBlock height={44} className={skeletonStyles.control} />
          </div>
          <div className={skeletonStyles.field}>
            <LoadingBlock width={110} height={16} />
            <LoadingBlock height={44} className={skeletonStyles.control} />
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
