import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { clientsHref } from "../client-paths";
import { ClientRecord } from "../client-record";

export const metadata: Metadata = { title: "Expedientes | YZY Contracts" };

export default async function ClientPage({ params, searchParams }: PageProps<"/clientes/[id]">) {
  const [{ id }, { expediente, nuevo }] = await Promise.all([params, searchParams]);
  const expedienteId = Array.isArray(expediente) ? "" : expediente;
  if (expedienteId === undefined && nuevo !== "1") redirect(clientsHref());
  return <ClientRecord clientId={id} expedienteId={expedienteId} />;
}
