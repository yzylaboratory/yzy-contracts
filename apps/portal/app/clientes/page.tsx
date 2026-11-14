import type { Metadata } from "next";
import { ClientDirectory } from "./client-directory";

export const metadata: Metadata = { title: "Expedientes | YZY Contracts" };

export default async function ClientsPage({ searchParams }: PageProps<"/clientes">) {
  const params = await searchParams;
  const pageNumber = typeof params.page === "string" && /^\d+$/.test(params.page) ? Number(params.page) : 0;
  const page = Number.isSafeInteger(pageNumber) && pageNumber > 0 ? pageNumber : undefined;
  return <ClientDirectory page={page} choosingClient={params.nuevo === "1"} />;
}
