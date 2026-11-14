"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/arc/button/button";
import { AccessScreen } from "@/components/access/access-screen";
import { AccessLegalLinks } from "@/components/access/access-links";
import { useAccessCheckScreen } from "@/components/access/use-access-check-screen";
import { portalLanding, usePortalAccess } from "@/lib/portal-access";

export function Preaccess() {
  const router = useRouter();
  const { state, session, checking, refresh, rememberRedirect } = usePortalAccess();
  const identity = state.kind === "ready" ? state.identity : null;
  const accountId = identity?.id;
  const destination = state.kind === "signed-out" ? "/login" : identity ? portalLanding(identity) : null;
  const showCheck = useAccessCheckScreen(state.kind === "loading");

  useEffect(() => {
    if (showCheck || !destination || destination === "/preacceso") return;
    if (accountId) rememberRedirect(accountId, destination);
    router.replace(destination);
  }, [accountId, destination, rememberRedirect, router, showCheck]);

  if (showCheck) return <AccessScreen status="checking" canSignOut={Boolean(session)} />;
  if (state.kind === "error") return (
    <AccessScreen status="error" title={state.denied ? "Acceso restringido" : "No se pudo comprobar el acceso"}
      action={!state.denied && <Button type="button" loading={checking} onClick={refresh}>Reintentar</Button>}>
      <p role="alert">{state.message}</p>
      <AccessLegalLinks />
    </AccessScreen>
  );

  if (!identity || destination !== "/preacceso") return <AccessScreen status="checking" canSignOut={Boolean(session)} />;

  return (
    <AccessScreen title="Acceso pendiente" pending action={<Button type="button" variant="secondary" loading={checking} onClick={refresh}>Comprobar de nuevo</Button>}>
      <p>El superadministrador debe habilitar tu cuenta{identity.email ? ` (${identity.email})` : ""} para que puedas entrar al portal.</p>
      <AccessLegalLinks />
    </AccessScreen>
  );
}
