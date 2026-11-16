import type { Metadata } from "next";
import { Dashboard } from "./dashboard";

export const metadata: Metadata = {
  title: "Dashboard | YZY Contracts",
  description: "Consulta el resumen de expedientes y documentos de la empresa activa.",
};

export default function DashboardPage() {
  return <Dashboard />;
}
