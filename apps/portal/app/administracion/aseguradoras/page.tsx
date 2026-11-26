import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isDevelopmentPortal } from "@/lib/site-url";
import { Administration } from "../administration";

export const metadata: Metadata = { title: "Aseguradoras | YZY Contracts", robots: { index: false } };

export default function AdminInsurersPage() {
  if (!isDevelopmentPortal()) notFound();
  return <Administration section="insurers" />;
}
