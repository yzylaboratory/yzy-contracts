import type { Metadata } from "next";
import type { ReactNode } from "react";
import { connection } from "next/server";
import "@fontsource-variable/geist";
import "@fontsource-variable/inter";
import "@/components/arc/foundation.css";
import "./globals.css";
import { PortalReplayNavigation } from "./portal-replay-navigation";
import { PortalNotifications } from "./portal-notifications";
import { PortalAccessProvider } from "@/lib/portal-access";
import { ProductTourProvider } from "@/components/product-tour/product-tour";
import { portalThemeStorageKey } from "@/lib/portal-theme";
import { resolveSiteUrl } from "@/lib/site-url";

const title = "YZY Contracts | Contratos y documentos";
const description = "Convierte contratos PDF y Word en plantillas editables y prepara documentos desde tu espacio en YZY Contracts.";

export function generateMetadata(): Metadata {
  const siteUrl = resolveSiteUrl();
  const metadataBase = siteUrl ? new URL(siteUrl) : undefined;
  return {
    metadataBase,
    title: metadataBase?.hostname === "yzycontracts.yzylabs.dev"
      ? { default: `[DEV] ${title}`, template: "[DEV] %s" }
      : title,
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
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  await connection();
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
        <PortalReplayNavigation />
        <PortalNotifications>
          <PortalAccessProvider><ProductTourProvider>{children}</ProductTourProvider></PortalAccessProvider>
        </PortalNotifications>
      </body>
    </html>
  );
}
