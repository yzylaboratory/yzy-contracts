"use client";

import { useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
import { ThemeSwitch, type Theme } from "@/components/arc/theme-switch/theme-switch";
import { portalThemeStorageKey } from "@/lib/portal-theme";

const themeChangeEvent = "yzy:theme-changed";

function subscribeToTheme(callback: () => void) {
  document.addEventListener(themeChangeEvent, callback);
  return () => document.removeEventListener(themeChangeEvent, callback);
}

function getTheme(): Theme {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

function changeTheme(next: Theme) {
  const applyTheme = () => {
    document.documentElement.dataset.theme = next;
    document.dispatchEvent(new Event(themeChangeEvent));
    try {
      localStorage.setItem(portalThemeStorageKey, next);
    } catch {
      // The theme still applies when browser storage is unavailable.
    }
  };

  if (!document.startViewTransition ||
      !CSS.supports("selector(:active-view-transition-type(theme-eclipse))") ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    applyTheme();
    return;
  }

  document.startViewTransition({
    types: ["theme-eclipse"],
    update: () => flushSync(applyTheme),
  });
}

export function PortalThemeSwitch() {
  const theme = useSyncExternalStore(subscribeToTheme, getTheme, () => "light" as const);

  return (
    <ThemeSwitch
      theme={theme}
      variant="eclipse"
      iconOnly
      label="Tema oscuro"
      onThemeChange={changeTheme}
    />
  );
}
