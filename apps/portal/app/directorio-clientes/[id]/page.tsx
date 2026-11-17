import type { Metadata } from "next";
import { ClientsCrudRecord } from "../clients-crud";

export const metadata: Metadata = { title: "Cliente | YZY Contracts" };

export default async function ClientRecordPage({ params }: PageProps<"/directorio-clientes/[id]">) {
  const { id } = await params;
  return <ClientsCrudRecord clientId={id} />;
}