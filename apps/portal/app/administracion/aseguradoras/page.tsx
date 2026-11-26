import type { Metadata } from "next";
import { Administration } from "../administration";

export const metadata: Metadata = { title: "Aseguradoras | YZY Contracts", robots: { index: false } };

export default function AdminInsurersPage() {
  return <Administration section="insurers" />;
}
