import type { ComponentProps, ReactNode } from "react";
import { Skeleton } from "@/components/arc/skeleton/skeleton";
import { PortalShell } from "@/components/portal-shell/portal-shell";
import styles from "./loading-ui.module.css";

type LoadingBlockProps = {
  width?: number | string;
  height?: number | string;
  className?: string;
};

export function LoadingBlock({ width = "100%", height = 14, className }: LoadingBlockProps) {
  return (
    <div aria-hidden="true" className={className} style={{ inlineSize: width, blockSize: height, maxInlineSize: "100%" }}>
      <Skeleton className={styles.block} lines={1} />
    </div>
  );
}

export function LoadingContent({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={styles.content} data-portal-loading="">
      <span className={styles.status} role="status">{label}</span>
      <div className={styles.content} aria-hidden="true" inert>{children}</div>
    </div>
  );
}

export function PortalLoading({
  children,
  label = "Cargando…",
  ...shell
}: Pick<ComponentProps<typeof PortalShell>, "currentPage" | "title" | "description" | "breadcrumb" | "backLink" | "children"> & { label?: string }) {
  const content = <LoadingContent label={label}>{children}</LoadingContent>;
  return (
    <PortalShell {...shell} onboardingAvailable={false} activityAvailable={false} loadingFallback={content}>
      {content}
    </PortalShell>
  );
}
