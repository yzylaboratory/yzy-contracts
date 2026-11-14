"use client";

import type { ReactNode } from "react";
import { ToastStack, ToastStackProvider } from "@/components/arc/toast-stack/toast-stack";

export function PortalNotifications({ children }: { children: ReactNode }) {
  return (
    <ToastStackProvider>
      {children}
      <ToastStack label="Notificaciones" />
    </ToastStackProvider>
  );
}
