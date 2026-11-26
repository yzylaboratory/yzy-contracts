"use client";

import { usePathname } from "next/navigation";
import { PortalLoading } from "@/components/loading/loading-ui";
import { skeletonView, titles, type View } from "../insurance-screen";
import { InsuranceSkeleton } from "../insurance-ui";

export default function ControlSegurosLoading() {
  const [, , , item, action] = usePathname().split("/");
  const view: View = action === "editar" ? "edit" : item === "nueva" ? "new" : item ? "detail" : "policies";
  return <PortalLoading currentPage="/control-seguros" title={titles[view]} label="Cargando Control de Pólizas…">
    <InsuranceSkeleton view={skeletonView(view)} />
  </PortalLoading>;
}
