import { PortalLoading } from "@/components/loading/loading-ui";
import { GeneratedDocumentsSkeleton } from "./generated-documents-skeleton";

export default function Loading() {
  return (
    <PortalLoading
      currentPage="/docs-generados"
      title="Documentos generados"
      description="Consulta los documentos creados, descárgalos en PDF o Word y prepara borradores de correo."
    >
      <GeneratedDocumentsSkeleton />
    </PortalLoading>
  );
}
