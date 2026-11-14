import type { Metadata } from "next";
import { PortalShell } from "@/components/portal-shell/portal-shell";
import { SettingsNavigation } from "./settings-navigation";

export const metadata: Metadata = {
  title: "Configuración | YZY Contracts",
  description: "Perfil y documentos legales de YZY Contracts.",
};

export default function SettingsPage() {
  return (
    <PortalShell
      currentPage="/configuracion"
      title="Configuración"
      description="Gestiona tu perfil y consulta los documentos legales."
    >
      <SettingsNavigation />
    </PortalShell>
  );
}
