import type { Metadata } from "next";
import { Billing } from "./billing";

export const metadata: Metadata = { title: "Membresía | YZY Contracts", robots: { index: false } };

export default function BillingPage() {
  return <Billing />;
}
