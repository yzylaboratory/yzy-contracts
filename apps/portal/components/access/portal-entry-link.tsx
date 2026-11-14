"use client";

import { portalLanding, usePortalAccess } from "@/lib/portal-access";
import { AccessActionLink } from "./access-links";

export function PortalEntryLink({ fromLegal = false }: { fromLegal?: boolean }) {
  const { state, activeCompany } = usePortalAccess();
  if (state.kind === "signed-out") return <AccessActionLink href="/login">{fromLegal ? "Volver al acceso" : "Iniciar sesión"}</AccessActionLink>;
  const destination = state.kind === "ready"
    ? fromLegal && activeCompany && state.identity.role === "member" ? "/configuracion" : portalLanding(state.identity)
    : "/preacceso";
  return <AccessActionLink href={destination}>{destination === "/configuracion" ? "Volver a Configuración" : "Ir al portal"}</AccessActionLink>;
}
