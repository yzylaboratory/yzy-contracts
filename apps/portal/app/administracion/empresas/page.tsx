import type { Metadata } from "next";
import { Administration } from "../administration";

export const metadata: Metadata = { title: "Empresas | YZY Contracts", robots: { index: false } };

export default function AdminCompaniesPage() {
  return <Administration section="companies" />;
}
