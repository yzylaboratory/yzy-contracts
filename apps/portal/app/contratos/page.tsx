import type { Metadata } from "next";
import { PortalShell } from "@/components/portal-shell/portal-shell";
import { Contracts } from "./contracts";

export const metadata: Metadata = {
  title: "Contratos | YZY Contracts",
  description: "Listado y filtros de contratos.",
};

export default function ContractsPage() {
  return (
    <PortalShell
      currentPage="/contratos"
      title="Contratos"
      description="Busca, selecciona y edita los contratos cargados."
    >
      <Contracts />
    </PortalShell>
  );
}
