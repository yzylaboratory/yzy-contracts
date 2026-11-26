import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Dashboard } from "./dashboard";
import { parsePeriodSlug } from "./dashboard-period";

export const metadata: Metadata = {
  title: "Dashboard | YZY Contracts",
  description: "Consulta el resumen de expedientes y documentos de la empresa activa.",
};

export default async function DashboardPage({ searchParams }: PageProps<"/dashboard">) {
  const params = await searchParams;
  const period = parsePeriodSlug(params.periodo);
  if (!period) notFound();
  return <Dashboard period={period} />;
}
