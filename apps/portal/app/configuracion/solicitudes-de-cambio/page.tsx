import type { Metadata } from "next";
import { PortalShell } from "@/components/portal-shell/portal-shell";
import { SettingsBackLink } from "../settings";

export const metadata: Metadata = {
  title: "Solicitudes de cambio | YZY Contracts",
  robots: { index: false },
};

export default function ChangeRequestsPage() {
  return (
    <PortalShell
      currentPage="/configuracion"
      title="Solicitudes de cambio"
      breadcrumb={<SettingsBackLink />}
      requiresBillingAccess
    >
      {null}
    </PortalShell>
  );
}
