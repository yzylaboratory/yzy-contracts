"use client";

import { useEffect, useRef, useState } from "react";
import { money } from "@/app/control-seguros/insurance-ui";
import { Button } from "@/components/arc/button/button";
import { LoadingContent } from "@/components/loading/loading-ui";
import { ApiError, isActiveAccount } from "@/lib/api";
import { usePortalAccess } from "@/lib/portal-access";
import { useSession } from "@/lib/session";
import { AttentionStrip } from "./attention-strip";
import { getWorkspaceDashboard, type WorkspaceDashboard } from "./dashboard-api";
import { DashboardSkeleton } from "./dashboard-skeleton";
import { ContractsFigures, InsuranceFigures } from "./dashboard-figures";
import { count } from "./dashboard-format";
import { AgingPanel, AttentionDuesPanel, CarrierPanel, StalledCasesPanel } from "./dashboard-panels";
import { periodApiKey, type DashboardPeriodSlug } from "./dashboard-period";
import { ProductivitySection } from "./productivity";
import { TrendChart } from "./trend-chart";
import styles from "./dashboard.module.css";

const loadingLabel = "Cargando el Dashboard…";

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof ApiError) return error.message || fallback;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

type Summary = { data: WorkspaceDashboard } | { failure: string };

export function Dashboard({ period }: { period: DashboardPeriodSlug }) {
  const accountId = useSession()?.user.id;
  const { activeCompany } = usePortalAccess();
  // The period selector lives in the page header (PeriodSelect). A new period arrives as a new prop and remounts the content, which shows its skeleton.
  if (!accountId || !activeCompany) return <LoadingContent label={loadingLabel}><DashboardSkeleton /></LoadingContent>;
  return <DashboardContent key={`${accountId}:${activeCompany.id}:${period}`} accountId={accountId} companyId={activeCompany.id} period={period} />;
}

function DashboardContent({ accountId, companyId, period }: { accountId: string; companyId: string; period: DashboardPeriodSlug }) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [loading, setLoading] = useState(true);
  const retryButton = useRef<HTMLButtonElement>(null);
  const content = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const request = new AbortController();
    getWorkspaceDashboard(accountId, companyId, periodApiKey(period), request.signal)
      .then(async data => {
        if (!await isActiveAccount(accountId) || request.signal.aborted) return;
        const restoreFocus = document.activeElement === retryButton.current;
        setSummary({ data });
        if (restoreFocus) requestAnimationFrame(() => {
          if (!request.signal.aborted) content.current?.focus();
        });
      })
      .catch((error: unknown) => {
        if (!request.signal.aborted) setSummary({ failure: errorMessage(error, "No se pudo cargar el resumen del Dashboard.") });
      })
      .finally(() => {
        if (!request.signal.aborted) setLoading(false);
      });
    return () => request.abort();
  }, [accountId, companyId, period, attempt]);

  if (!summary) return <LoadingContent label={loadingLabel}><DashboardSkeleton /></LoadingContent>;
  if ("failure" in summary) {
    return (
      <section className={styles.panel}>
        <p className={styles.dataHint} role="alert">{summary.failure}</p>
        <Button ref={retryButton} type="button" variant="secondary" loading={loading} onClick={() => {
          setLoading(true);
          setSummary(null);
          setAttempt(current => current + 1);
        }}>Reintentar</Button>
      </section>
    );
  }

  const stats = summary.data;
  return (
    <div ref={content} tabIndex={-1} className={styles.content}>
      <div className={styles.bento}>
        <AttentionStrip stats={stats} />
        <ContractsFigures stats={stats} />
        <InsuranceFigures stats={stats} />

        <section className={`${styles.panel} ${styles.trendPanel}`} aria-labelledby="trend-title">
          <h2 id="trend-title">Tendencia de 12 meses</h2>
          <div className={styles.trends}>
            <TrendChart title="Expedientes creados" format={count}
              points={stats.trend.map(({ month, cases_created }) => ({ month, value: cases_created }))} />
            <TrendChart title="Desembolsado" format={money}
              points={stats.trend.map(({ month, disbursed_amount_minor }) => ({ month, value: disbursed_amount_minor }))} />
            <TrendChart title="Cobrado" format={money}
              points={stats.trend.map(({ month, collected_amount_minor }) => ({ month, value: collected_amount_minor }))} />
          </div>
        </section>

        <div className={styles.panelRows}>
          <AttentionDuesPanel stats={stats} />
          <AgingPanel stats={stats} />
          <CarrierPanel stats={stats} />
          <StalledCasesPanel stats={stats} />
        </div>

        <ProductivitySection stats={stats} />
      </div>
    </div>
  );
}
