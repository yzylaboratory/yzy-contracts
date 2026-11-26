import { LoadingContent } from "@/components/loading/loading-ui";
import { DashboardSkeleton, ToolbarSkeleton } from "./dashboard-skeleton";
import styles from "./dashboard.module.css";

export default function DashboardLoading() {
  return (
    <LoadingContent label="Cargando el Dashboard…">
      <div className={styles.dashboard}>
        <ToolbarSkeleton />
        <DashboardSkeleton />
      </div>
    </LoadingContent>
  );
}
