import type { Metadata } from "next";
import { Administration } from "../administration";

export const metadata: Metadata = { title: "Facturación | YZY Contracts", robots: { index: false } };

export default function AdminBillingPage() {
  return <Administration section="billing" />;
}
