import { PortalLoading } from "@/components/loading/loading-ui";
import { settingsBackLink } from "../settings";
import { ProfileSkeleton, profileLoadingLabel } from "./profile-skeleton";

export default function ProfileLoading() {
  return (
    <PortalLoading
      currentPage="/configuracion"
      title="Perfil"
      description="Consulta los datos de tu cuenta y edita tu nombre."
      backLink={settingsBackLink}
      label={profileLoadingLabel}
    >
      <ProfileSkeleton />
    </PortalLoading>
  );
}
