import type { Metadata } from "next";
import { Dashboard } from "./dashboard";

export const metadata: Metadata = {
  title: "Dashboard | YZY Contracts",
  description: "Consulta tus contratos recientes y el resumen de documentos generados.",
};

export default function DashboardPage() {
  return <Dashboard />;
}
