import type { Metadata } from "next";
import { Preaccess } from "./preaccess";

export const metadata: Metadata = { title: "Estado de acceso | YZY Contracts", robots: { index: false } };

export default function PreaccessPage() {
  return <Preaccess />;
}
