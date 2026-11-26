import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: "Control de Pólizas" };

export default function ControlSegurosLayout({ children }: { children: ReactNode }) {
  return children;
}
