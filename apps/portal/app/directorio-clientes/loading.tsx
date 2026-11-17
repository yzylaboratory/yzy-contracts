import { PortalLoading } from "@/components/loading/loading-ui";
import { ClientDirectorySkeleton } from "../clientes/clients-skeleton";

export default function ClientDirectoryLoading() {
  return (
    <PortalLoading currentPage="/directorio-clientes" title="Clientes" label="Cargando clientes…">
      <ClientDirectorySkeleton />
    </PortalLoading>
  );
}