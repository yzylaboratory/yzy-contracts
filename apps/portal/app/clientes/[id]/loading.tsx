import { PortalLoading } from "@/components/loading/loading-ui";
import { ClientRecordSkeleton } from "../clients-skeleton";

export default function ClientRecordLoading() {
  return (
    <PortalLoading currentPage="/clientes" title="Expedientes" label="Cargando…" backLink={{ href: "/clientes", label: "Volver a Expedientes" }}>
      <ClientRecordSkeleton />
    </PortalLoading>
  );
}
