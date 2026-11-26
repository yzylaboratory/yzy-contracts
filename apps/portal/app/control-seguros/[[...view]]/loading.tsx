"use client";

import { usePathname } from "next/navigation";
import { PortalLoading } from "@/components/loading/loading-ui";
import { skeletonView, titles, type View } from "../insurance-screen";
import { InsuranceSkeleton } from "../insurance-ui";

export default function ControlSegurosLoading() {
  const [, , section, item, action] = usePathname().split("/");
  const view: View = section === "dashboard" ? "dashboard" : section === "aseguradoras" ? "carrier"
    : action === "editar" ? "edit" : item === "nueva" ? "new" : item ? "detail" : section === "polizas" ? "policies" : "home";
  return <PortalLoading currentPage="/control-seguros" title={titles[view]} label="Cargando Control Seguros…">
    <InsuranceSkeleton view={skeletonView(view)} />
  </PortalLoading>;
}
