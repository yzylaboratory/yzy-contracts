import type { Metadata } from "next";
import type { ReactNode } from "react";
import "@fontsource-variable/geist";
import "@fontsource-variable/inter";
import "@/components/arc/foundation.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Iniciar sesión | YZY Contracts",
  description: "Acceso a YZY Contracts.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
