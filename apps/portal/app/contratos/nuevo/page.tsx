import type { Metadata } from "next";
import { NewContract } from "../contract-editor";

export const metadata: Metadata = {
  title: "Nuevo contrato | YZY Contracts",
  description: "Completa los datos y el contenido de un nuevo contrato.",
};

export default async function NewContractPage({ searchParams }: PageProps<"/contratos/nuevo">) {
  const { company_id: companyId } = await searchParams;
  return <NewContract companyId={typeof companyId === "string" ? companyId : undefined} />;
}
