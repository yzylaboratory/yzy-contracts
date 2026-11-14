import type { Metadata } from "next";
import { isRecordId } from "@/app/clientes/client-paths";
import { getDocumentType } from "@/app/contratos/document-catalog";
import { GenerateDocument } from "./generate-document";
import type { OperationSelection } from "./use-operation-context";

export const metadata: Metadata = {
  title: "Generar documento | YZY Contracts",
  description: "Completa los datos del contrato y prepara el documento.",
};

export default async function GenerateDocumentPage({ params, searchParams }: PageProps<"/contratos/[id]/generar">) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const { company_id: company, client_id: client, operation_id: operation, document_type: documentType } = query;
  const hasExpediente = [company, client, operation, documentType].some(value => value !== undefined);
  let selection: OperationSelection | null = null;
  if (typeof company === "string" && isRecordId(company) && typeof client === "string" && isRecordId(client) &&
      typeof operation === "string" && isRecordId(operation) && typeof documentType === "string") {
    const type = getDocumentType(documentType);
    if (type) selection = { companyId: company, clientId: client, operationId: operation, type: type.id };
  }

  return <GenerateDocument contractId={id} selection={selection} invalidSelection={hasExpediente && !selection} />;
}
