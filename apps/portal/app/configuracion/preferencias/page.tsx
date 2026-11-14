import type { Metadata } from "next";
import { PortalShell } from "@/components/portal-shell/portal-shell";
import { SettingsBackLink } from "../settings";
import { DocumentPreferences } from "./document-preferences";

export const metadata: Metadata = {
  title: "Preferencias | YZY Contracts",
  description: "Gestiona tus preferencias de YZY Contracts.",
};

export default function PreferencesPage() {
  return (
    <PortalShell
      currentPage="/configuracion"
      title="Preferencias"
      description="Elige el formato de salida y tus preferencias de correo."
      breadcrumb={<SettingsBackLink />}
    >
      <DocumentPreferences />
    </PortalShell>
  );
}
