import { PortalLoading } from "@/components/loading/loading-ui";
import { SettingsBackLink } from "../settings";
import { PreferencesSkeleton, preferencesLoadingLabel } from "./preferences-skeleton";

export default function PreferencesLoading() {
  return (
    <PortalLoading
      currentPage="/configuracion"
      title="Preferencias"
      description="Elige el idioma, el formato de salida y tus preferencias de correo."
      breadcrumb={<SettingsBackLink />}
      label={preferencesLoadingLabel}
    >
      <PreferencesSkeleton />
    </PortalLoading>
  );
}
