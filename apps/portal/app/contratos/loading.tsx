import { PortalLoading } from "@/components/loading/loading-ui";
import { ContractsSkeleton } from "./contracts-skeleton";

export default function Loading() {
  return (
    <PortalLoading
      currentPage="/contratos"
      title="Contratos"
      description="Busca, selecciona y edita los contratos cargados."
    >
      <ContractsSkeleton />
    </PortalLoading>
  );
}
