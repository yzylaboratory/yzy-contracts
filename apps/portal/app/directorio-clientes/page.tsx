import type { Metadata } from "next";
import { ClientsCrudDirectory } from "./clients-crud";

export const metadata: Metadata = { title: "Clientes | YZY Contracts" };

export default async function ClientDirectoryPage({ searchParams }: PageProps<"/directorio-clientes">) {
  const params = await searchParams;
  const pageNumber = typeof params.page === "string" && /^\d+$/.test(params.page) ? Number(params.page) : 0;
  const page = Number.isSafeInteger(pageNumber) && pageNumber > 0 ? pageNumber : undefined;
  return <ClientsCrudDirectory page={page} creating={params.nuevo === "1"} />;
}