import { PortalLoading } from "@/components/loading/loading-ui";
import { ClientDirectorySkeleton } from "./clients-skeleton";

export default function ClientsLoading() {
  return (
    <PortalLoading currentPage="/clientes" title="Expedientes" label="Cargando expedientes…">
      <ClientDirectorySkeleton />
    </PortalLoading>
  );
}
