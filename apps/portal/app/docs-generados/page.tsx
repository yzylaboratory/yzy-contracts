import type { Metadata } from "next";
import { PortalShell } from "@/components/portal-shell/portal-shell";
import { GeneratedDocuments } from "./generated-documents";

export const metadata: Metadata = {
  title: "Documentos generados | YZY Contracts",
  description: "Consulta y descarga los documentos generados en YZY Contracts.",
};

export default function GeneratedDocumentsPage() {
  return (
    <PortalShell
      currentPage="/docs-generados"
      title="Documentos generados"
      description="Consulta los documentos creados, descárgalos en PDF o Word y prepara borradores de correo."
    >
      <GeneratedDocuments />
    </PortalShell>
  );
}
