import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { isDevelopmentPortal } from "@/lib/site-url";

export const metadata: Metadata = { title: "Control Seguros" };

export default function ControlSegurosLayout({ children }: { children: ReactNode }) {
  if (!isDevelopmentPortal()) notFound();
  return children;
}
