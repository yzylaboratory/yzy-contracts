import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Completar datos de prospecto | YZY Contracts",
  description: "Completa tus datos para que el equipo pueda revisarlos.",
  robots: {
    index: false,
    follow: false,
  },
  referrer: "no-referrer",
};

export default function ProspectoLayout({ children }: LayoutProps<"/prospecto">) {
  return children;
}
