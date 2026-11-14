import type { Metadata } from "next";
import { isRecordId } from "@/app/clientes/client-paths";
import { Administration } from "../administration";

export const metadata: Metadata = { title: "Actividad | YZY Contracts", robots: { index: false } };

export default async function AdminActivityPage({ searchParams }: PageProps<"/administracion/actividad">) {
  const { user } = await searchParams;
  const userId = typeof user === "string" && isRecordId(user) ? user : undefined;
  return <Administration section="activity" activityUserId={userId} />;
}
