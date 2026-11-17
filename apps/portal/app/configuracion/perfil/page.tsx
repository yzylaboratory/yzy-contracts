import type { Metadata } from "next";
import { PortalShell } from "@/components/portal-shell/portal-shell";
import { settingsBackLink } from "../settings";
import { ProfileSettings } from "./profile-settings";

export const metadata: Metadata = {
  title: "Perfil | YZY Contracts",
  description: "Consulta y actualiza tu perfil de YZY Contracts.",
};

export default function ProfilePage() {
  return (
    <PortalShell
      currentPage="/configuracion"
      title="Perfil"
      description="Consulta los datos de tu cuenta y edita tu nombre."
      backLink={settingsBackLink}
    >
      <ProfileSettings />
    </PortalShell>
  );
}
