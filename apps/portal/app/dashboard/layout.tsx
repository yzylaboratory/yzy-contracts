import type { ReactNode } from "react";
import { PortalShell } from "@/components/portal-shell/portal-shell";

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <PortalShell
      currentPage="/dashboard"
      title="Dashboard"
      description="Tiempo ahorrado, contratos pendientes de firma o desembolso y actividad por usuario."
    >
      {children}
    </PortalShell>
  );
}
