import { PortalLoading } from "@/components/loading/loading-ui";
import { ClientRecordSkeleton } from "../../clientes/clients-skeleton";

export default function ClientRecordLoading() {
  return (
    <PortalLoading
      currentPage="/directorio-clientes"
      title="Cliente"
      label="Cargando cliente…"
      backLink={{ href: "/directorio-clientes", label: "Volver al directorio" }}
    >
      <ClientRecordSkeleton />
    </PortalLoading>
  );
}