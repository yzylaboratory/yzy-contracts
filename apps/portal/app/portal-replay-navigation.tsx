"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

export function PortalReplayNavigation() {
  const pathname = usePathname();
  useEffect(() => {
    if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
      void import("../instrumentation-client").then(module => module.updatePortalReplay()).catch(() => undefined);
    }
  }, [pathname]);
  return null;
}
