import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: "Control Seguros" };

export default function ControlSegurosLayout({ children }: { children: ReactNode }) {
  return children;
}
