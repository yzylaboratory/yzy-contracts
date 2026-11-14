import { AccessScreen } from "@/components/access/access-screen";
import { NotFoundActivity } from "@/components/access/not-found-activity";
import { PortalEntryLink } from "@/components/access/portal-entry-link";

export default function NotFound() {
  return (
    <AccessScreen title="Página no encontrada" canSignOut={false} action={<PortalEntryLink />}>
      <NotFoundActivity />
      <p>La página que buscas no está disponible.</p>
    </AccessScreen>
  );
}
