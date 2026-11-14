"use client";

import { useEffect, useRef, type RefObject } from "react";
import { activityScreenForPath, recordPortalActivity } from "./activity";

export function usePortalVisit(accountId: string | null, pathname: string, main: RefObject<HTMLElement | null>, accessKey: string | null) {
  const lastVisit = useRef<{ accountId: string; pathname: string }>(null);

  useEffect(() => {
    const element = main.current;
    const screen = activityScreenForPath(pathname);
    if (!element || !screen || !accountId) return;
    if (lastVisit.current?.accountId === accountId && lastVisit.current.pathname === pathname) return;

    // Route transitions and page-level data requests both use this loading marker.
    const reportIfVisible = () => {
      if (!element.isConnected || element.querySelector("[data-portal-loading]")) return false;
      lastVisit.current = { accountId, pathname };
      recordPortalActivity(accountId, "portal_visit", screen);
      return true;
    };

    if (reportIfVisible()) return;
    const observer = new MutationObserver(() => {
      if (reportIfVisible()) observer.disconnect();
    });
    observer.observe(element, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [accessKey, accountId, main, pathname]);
}
