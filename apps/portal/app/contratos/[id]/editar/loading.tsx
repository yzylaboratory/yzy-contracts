import { PortalLoading } from "@/components/loading/loading-ui";
import { ContractEditorBreadcrumb } from "../../contract-editor-breadcrumb";
import { ContractEditorSkeleton } from "../../contract-editor-skeleton";

const title = "Editar contrato";

export default function Loading() {
  return (
    <PortalLoading
      currentPage="/contratos"
      title={title}
      description="Actualiza los datos y el contenido del contrato."
      breadcrumb={<ContractEditorBreadcrumb title={title} />}
      label="Cargando editor del contrato…"
    >
      <ContractEditorSkeleton />
    </PortalLoading>
  );
}
