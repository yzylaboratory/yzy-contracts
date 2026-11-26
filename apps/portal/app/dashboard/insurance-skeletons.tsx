import { LoadingBlock } from "@/components/loading/loading-ui";
import dashboard from "./dashboard.module.css";
import styles from "./dashboard-insurance.module.css";

export function TilesSkeleton({ count }: { count: number }) {
  return <div className={styles.tiles}>
    {Array.from({ length: count }, (_, index) => <div className={styles.tile} key={index}>
      <LoadingBlock width={120} height={14} />
      <LoadingBlock width={96} height={28} />
      <LoadingBlock width={150} height={12} />
    </div>)}
  </div>;
}

export const InsuranceTilesSkeleton = () => <TilesSkeleton count={4} />;

export function InsuranceCarrierSkeleton() {
  return <div className={dashboard.dashboardSkeleton}>
    {[1, 2, 3].map(index => <LoadingBlock key={index} height={20} />)}
  </div>;
}

export function InsuranceAttentionSkeleton() {
  return <div className={dashboard.dashboardSkeleton}>
    {[1, 2, 3, 4].map(index => <LoadingBlock key={index} height={36} />)}
  </div>;
}
