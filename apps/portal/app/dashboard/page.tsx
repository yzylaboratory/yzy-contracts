import type { Metadata } from "next";
import { Dashboard } from "./dashboard";

export const metadata: Metadata = {
  title: "Dashboard | YZY Contracts",
  description: "Resumen de ejemplo de contratos y documentos generados.",
};

export default function DashboardPage() {
  return <Dashboard />;
}
