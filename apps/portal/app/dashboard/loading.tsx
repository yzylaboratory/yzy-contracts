import { LoadingContent } from "@/components/loading/loading-ui";
import { DashboardSkeleton } from "./dashboard-skeleton";

export default function DashboardLoading() {
  return (
    <LoadingContent label="Cargando el Dashboard…">
      <DashboardSkeleton />
    </LoadingContent>
  );
}
