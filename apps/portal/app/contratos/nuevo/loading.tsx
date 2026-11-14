import { PortalLoading } from "@/components/loading/loading-ui";
import { ContractEditorBreadcrumb } from "../contract-editor-breadcrumb";
import { ContractEditorSkeleton } from "../contract-editor-skeleton";

const title = "Nuevo contrato";

export default function Loading() {
  return (
    <PortalLoading
      currentPage="/contratos"
      title={title}
      description="Selecciona el archivo, completa sus datos y edita el contenido antes de guardarlo."
      label="Cargando editor del contrato…"
      breadcrumb={<ContractEditorBreadcrumb title={title} />}
    >
      <ContractEditorSkeleton />
    </PortalLoading>
  );
}
