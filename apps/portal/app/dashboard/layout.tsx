import type { ReactNode } from "react";
import { PortalShell } from "@/components/portal-shell/portal-shell";

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <PortalShell
      currentPage="/dashboard"
      title="Dashboard"
      description="Resumen de los contratos y documentos de toda tu cuenta."
    >
      {children}
    </PortalShell>
  );
}
