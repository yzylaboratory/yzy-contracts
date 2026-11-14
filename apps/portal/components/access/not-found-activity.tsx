"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { recordPortalActivity } from "@/lib/activity";
import { usePortalAccess } from "@/lib/portal-access";

export function NotFoundActivity() {
  const pathname = usePathname();
  const { state } = usePortalAccess();
  const accountId = state.kind === "ready" ? state.identity.id : undefined;
  const lastEvent = useRef<{ accountId: string; pathname: string }>(null);

  useEffect(() => {
    if (!accountId || (lastEvent.current?.accountId === accountId && lastEvent.current.pathname === pathname)) return;
    lastEvent.current = { accountId, pathname };
    recordPortalActivity(accountId, "not_found", "not_found");
  }, [accountId, pathname]);

  return null;
}
