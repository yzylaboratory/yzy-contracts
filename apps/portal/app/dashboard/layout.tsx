import type { ReactNode } from "react";
import { PortalShell } from "@/components/portal-shell/portal-shell";

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <PortalShell
      currentPage="/dashboard"
      title="Dashboard"
      description="Contratos, pólizas y actividad por usuario de la empresa activa."
    >
      {children}
    </PortalShell>
  );
}
