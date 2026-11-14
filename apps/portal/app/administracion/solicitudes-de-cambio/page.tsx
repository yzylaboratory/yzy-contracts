import type { Metadata } from "next";
import { PortalShell } from "@/components/portal-shell/portal-shell";
import { adminRoutes } from "@/lib/admin-navigation";

export const metadata: Metadata = { title: "Solicitudes de cambio | YZY Contracts", robots: { index: false } };

export default function AdminChangeRequestsPage() {
  return <PortalShell currentPage={adminRoutes.dashboard} title="Solicitudes de cambio">{null}</PortalShell>;
}
