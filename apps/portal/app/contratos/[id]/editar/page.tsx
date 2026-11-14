import type { Metadata } from "next";
import { EditContract } from "../../contract-editor";

export const metadata: Metadata = {
  title: "Editar contrato | YZY Contracts",
  description: "Actualiza los datos y el contenido de un contrato.",
};

export default async function EditContractPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <EditContract contractId={id} />;
}
