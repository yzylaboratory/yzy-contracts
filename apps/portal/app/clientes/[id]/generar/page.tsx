import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { clientsHref, isRecordId } from "../../client-paths";
import { ExpedienteDocumentGeneration } from "../../expediente-document-generation";

export const metadata: Metadata = { title: "Generar Documento | YZY Contracts" };

export default async function ExpedienteDocumentPage({ params, searchParams }: PageProps<"/clientes/[id]/generar">) {
  const [{ id }, { expediente }] = await Promise.all([params, searchParams]);
  if (!isRecordId(id) || typeof expediente !== "string" || !isRecordId(expediente)) redirect(clientsHref());
  return <ExpedienteDocumentGeneration clientId={id} expedienteId={expediente} />;
}
