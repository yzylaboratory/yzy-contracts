import type { Metadata } from "next";
import { CompanySettings } from "./company-settings";

export const metadata: Metadata = {
  title: "Datos de la empresa | YZY Contracts",
  description: "Configura los datos de las empresas que utilizas en tus contratos.",
};

export default async function CompaniesPage({ searchParams }: PageProps<"/configuracion/empresas">) {
  const params = await searchParams;
  const companyId = typeof params.id === "string" ? params.id : undefined;
  return <CompanySettings initialCompanyId={companyId} />;
}
