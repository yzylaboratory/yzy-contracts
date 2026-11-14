import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { adminRoutes } from "@/lib/admin-navigation";
import { Administration } from "./administration";

export const metadata: Metadata = { title: "Dashboard Admin | YZY Contracts", robots: { index: false } };

const legacyRoutes = {
  companies: adminRoutes.companies,
  users: adminRoutes.users,
  billing: adminRoutes.billing,
  activity: adminRoutes.activity,
} as const;

export default async function AdministrationPage({ searchParams }: PageProps<"/administracion">) {
  const { section, user } = await searchParams;
  if (section === "activity" && typeof user === "string") {
    redirect(`${adminRoutes.activity}?${new URLSearchParams({ user })}`);
  }
  if (section === "companies" || section === "users" || section === "billing" || section === "activity") {
    redirect(legacyRoutes[section]);
  }

  return <Administration section="dashboard" />;
}
