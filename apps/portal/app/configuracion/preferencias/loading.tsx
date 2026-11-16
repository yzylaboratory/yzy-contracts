import { PortalLoading } from "@/components/loading/loading-ui";
import { settingsBackLink } from "../settings";
import { PreferencesSkeleton, preferencesLoadingLabel } from "./preferences-skeleton";

export default function PreferencesLoading() {
  return (
    <PortalLoading
      currentPage="/configuracion"
      title="Preferencias"
      description="Elige el formato de salida y tus preferencias de correo."
      backLink={settingsBackLink}
      label={preferencesLoadingLabel}
    >
      <PreferencesSkeleton />
    </PortalLoading>
  );
}
