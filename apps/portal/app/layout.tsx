import type { Metadata } from "next";
import type { ReactNode } from "react";
import "@fontsource-variable/geist";
import "@fontsource-variable/inter";
import "@/components/arc/foundation.css";
import "./globals.css";
import { PortalNotifications } from "./portal-notifications";
import { PortalAccessProvider } from "@/lib/portal-access";
import { ProductTourProvider } from "@/components/product-tour/product-tour";
import { portalThemeStorageKey } from "@/lib/portal-theme";

const title = "YZY Contracts | Contratos y documentos";
const description = "Convierte contratos PDF y Word en plantillas editables y prepara documentos desde tu espacio en YZY Contracts.";

export const metadata: Metadata = {
  metadataBase: process.env.NEXT_PUBLIC_SITE_URL ? new URL(process.env.NEXT_PUBLIC_SITE_URL) : undefined,
  title,
  description,
  openGraph: {
    title,
    description,
    siteName: "YZY Contracts",
    type: "website",
    locale: "es_DO",
    url: "/login",
  },
  twitter: { card: "summary_large_image", title, description },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: `try {
          if (localStorage.getItem(${JSON.stringify(portalThemeStorageKey)}) === "dark") {
            document.documentElement.dataset.theme = "dark";
          }
        } catch {}` }} />
      </head>
      <body>
        <PortalNotifications>
          <PortalAccessProvider><ProductTourProvider>{children}</ProductTourProvider></PortalAccessProvider>
        </PortalNotifications>
      </body>
    </html>
  );
}
