import Link from "next/link";
import { PortalLoading } from "@/components/loading/loading-ui";
import { GenerateDocumentSkeleton } from "./generate-document-skeleton";
import styles from "./generate-document.module.css";

export default function GenerateDocumentLoading() {
  return (
    <PortalLoading
      currentPage="/contratos"
      title="Generar documento"
      description="Completa los datos del contrato seleccionado y elige cómo recibirlo."
      label="Cargando el contrato…"
      breadcrumb={
        <nav aria-label="Ruta de navegación" className={styles.breadcrumb}>
          <Link href="/contratos">Contratos</Link>
          <span aria-hidden="true">/</span>
          <span aria-current="page">Generar documento</span>
        </nav>
      }
    >
      <GenerateDocumentSkeleton />
    </PortalLoading>
  );
}
