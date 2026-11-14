import { PortalLoading } from "@/components/loading/loading-ui";
import { SettingsBackLink } from "../settings";
import { ProfileSkeleton, profileLoadingLabel } from "./profile-skeleton";

export default function ProfileLoading() {
  return (
    <PortalLoading
      currentPage="/configuracion"
      title="Perfil"
      description="Consulta los datos de tu cuenta y edita tu nombre."
      breadcrumb={<SettingsBackLink />}
      label={profileLoadingLabel}
    >
      <ProfileSkeleton />
    </PortalLoading>
  );
}
