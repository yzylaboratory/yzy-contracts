"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { operationStatusLabel } from "@/app/clientes/expediente-status";
import { Button } from "@/components/arc/button/button";
import { DashboardHero } from "./dashboard-hero";
import { Tooltip } from "@/components/arc/tooltip/tooltip";
import { ApiError, isActiveAccount } from "@/lib/api";
import { usePortalAccess } from "@/lib/portal-access";
import { useSession } from "@/lib/session";
import { getWorkspaceDashboard, type WorkspaceDashboard } from "./dashboard-api";
import { FormatChart } from "./format-chart";
import DashboardLoading from "./loading";
import { MonthlyChart } from "./monthly-chart";
import styles from "./dashboard.module.css";

const monthName = new Intl.DateTimeFormat("es-DO", { month: "long", timeZone: "UTC" });
const monthShort = new Intl.DateTimeFormat("es-DO", { month: "short", timeZone: "UTC" });
const createdDate = new Intl.DateTimeFormat("es-DO", { dateStyle: "medium", timeZone: "America/Santo_Domingo" });
const formatLabels = { pdf: "PDF", docx: "Word", email: "Correo" } as const;

function formatMinutes(minutes: number) {
  if (minutes <= 0) return "0 min";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  return rem > 0 ? `${hours} h ${rem} min` : `${hours} h`;
}

function timeSavedCounter(minutes: number): { value: number; suffix: string } {
  if (minutes < 60) {
    return { value: Math.max(0, minutes), suffix: " min" };
  }
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  return { value: hours, suffix: rem > 0 ? ` h ${rem} m` : " h" };
}

function chartData(stats: WorkspaceDashboard) {
  const months = stats.months.map(({ month, total }, index) => {
    const date = new Date(`${month}-01T00:00:00Z`);
    return { name: monthName.format(date), short: monthShort.format(date), total, current: index === stats.months.length - 1 };
  });
  const formats = (Object.keys(formatLabels) as Array<keyof typeof formatLabels>).map(format => ({
    name: formatLabels[format],
    total: stats.formats[format],
  }));
  return { months, formats };
}

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof ApiError) return error.message || fallback;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

type Summary = { data: WorkspaceDashboard } | { failure: string };

export function Dashboard() {
  const accountId = useSession()?.user.id;
  const { activeCompany } = usePortalAccess();
  if (!accountId || !activeCompany) return <DashboardLoading />;
  return <DashboardContent key={`${accountId}:${activeCompany.id}`} accountId={accountId} companyId={activeCompany.id} />;
}

function DashboardContent({ accountId, companyId }: { accountId: string; companyId: string }) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [loading, setLoading] = useState(true);
  const retryButton = useRef<HTMLButtonElement>(null);
  const casesHeading = useRef<HTMLHeadingElement>(null);
  const monthlyHeading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const request = new AbortController();
    getWorkspaceDashboard(accountId, companyId, request.signal)
      .then(async data => {
        if (!await isActiveAccount(accountId) || request.signal.aborted) return;
        const restoreFocus = document.activeElement === retryButton.current;
        setSummary({ data });
        if (restoreFocus) requestAnimationFrame(() => {
          if (!request.signal.aborted) (casesHeading.current ?? monthlyHeading.current)?.focus();
        });
      })
      .catch((error: unknown) => {
        if (!request.signal.aborted) setSummary({ failure: errorMessage(error, "No se pudo cargar el resumen del Dashboard.") });
      })
      .finally(() => {
        if (!request.signal.aborted) setLoading(false);
      });
    return () => request.abort();
  }, [accountId, companyId, attempt]);

  if (!summary) return <DashboardLoading />;
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
  const charts = chartData(stats);
  const savedCounter = timeSavedCounter(stats.time_saved_minutes);

  const heroMetrics = {
    timeSaved: {
      label: "Tiempo ahorrado",
      value: savedCounter.value,
      suffix: savedCounter.suffix,
      context: `Tu ahorro: ${formatMinutes(stats.user_time_saved_minutes)} · ${stats.documents_total} docs`,
    },
    unsigned: {
      label: "Sin firmar",
      value: stats.unsigned_cases,
      context: `${stats.status_counts.solicitud} en solicitud · ${stats.status_counts.en_proceso} en proceso`,
    },
    pendingDisbursement: {
      label: "Sin desembolsar",
      value: stats.pending_disbursement_cases,
      context: `${stats.status_counts.firma} en firma · ${stats.cases_without_plan} sin plan de pagos`,
    },
    disbursed: {
      label: "Desembolsados",
      value: stats.disbursed_cases,
      context: `${stats.user_disbursements_total} hechos por ti · ${stats.disbursed_this_month} este mes`,
    },
  };

  const pipelineStages = [
    {
      key: "solicitud",
      label: "Solicitud",
      hint: "Sin firmar",
      count: stats.status_counts.solicitud,
      fillClass: styles.stageFillBurgundy,
    },
    {
      key: "en_proceso",
      label: "En proceso",
      hint: "En depuración",
      count: stats.status_counts.en_proceso,
      fillClass: styles.stageFillBurgundy,
    },
    {
      key: "firma",
      label: "Firma",
      hint: "Por desembolsar",
      count: stats.status_counts.firma,
      fillClass: styles.stageFillInk,
    },
    {
      key: "desembolso",
      label: "Desembolso",
      hint: "Desembolsado",
      count: stats.status_counts.desembolso,
      fillClass: styles.stageFillInk,
    },
    {
      key: "cerrado",
      label: "Cerrado",
      hint: "Concluido",
      count: stats.status_counts.cerrado,
      fillClass: styles.stageFillInk,
    },
  ];

  return (
    <>
      <DashboardHero {...heroMetrics} />

      <div className={styles.analytics}>
        <section className={`${styles.panel} ${styles.pipeline}`} aria-labelledby="pipeline-title">
          <div className={styles.panelHeader}>
            <div>
              <h2 id="pipeline-title">Estado de contratos y desembolsos</h2>
              <p className={styles.panelSubtext}>
                Distribución actual de los {stats.cases_total} expedientes de la empresa
              </p>
            </div>
            <Link className={styles.tableAction} href="/clientes">Ver expedientes</Link>
          </div>

          <div className={styles.summaryStrip} role="list" aria-label="Resumen operativo">
            <div className={styles.summaryPill} role="listitem">
              <span className={styles.summaryPillLabel}>Expedientes</span>
              <strong className={styles.summaryPillValue}>{stats.cases_total}</strong>
            </div>
            <div className={styles.summaryPill} role="listitem">
              <span className={styles.summaryPillLabel}>Este mes</span>
              <strong className={styles.summaryPillValue}>{stats.cases_this_month}</strong>
            </div>
            <div className={styles.summaryPill} role="listitem">
              <span className={styles.summaryPillLabel}>Sin plan de pagos</span>
              <strong className={styles.summaryPillValue}>{stats.cases_without_plan}</strong>
            </div>
            <div className={styles.summaryPill} role="listitem">
              <span className={styles.summaryPillLabel}>Clientes</span>
              <strong className={styles.summaryPillValue}>{stats.clients_total}</strong>
            </div>
          </div>

          <ul className={styles.stageList} aria-label="Etapas de los expedientes">
            {pipelineStages.map(stage => {
              const share = stats.cases_total > 0 ? Math.round((stage.count / stats.cases_total) * 100) : 0;
              return (
                <li key={stage.key} className={styles.stageRow}>
                  <div className={styles.stageInfo}>
                    <span className={styles.stageName}>{stage.label}</span>
                    <span className={styles.stageHint}>{stage.hint}</span>
                  </div>
                  <div className={styles.stageTrack} aria-hidden="true">
                    <div
                      className={`${styles.stageFill} ${stage.fillClass}`}
                      style={{ width: `${stage.count > 0 ? Math.max(share, 6) : 0}%` }}
                    />
                  </div>
                  <div className={styles.stageNumbers}>
                    <strong>{stage.count}</strong>
                    <span>{share}%</span>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>

        <section className={`${styles.panel} ${styles.teamPanel}`} aria-labelledby="team-title">
          <div className={styles.panelHeader}>
            <div>
              <h2 id="team-title">Rendimiento y desembolsos por usuario</h2>
              <p className={styles.panelSubtext}>
                Desembolsos realizados, contratos pendientes y tiempo ahorrado por miembro
              </p>
            </div>
          </div>

          {stats.user_stats.filter(member => member.user_name.trim().toLowerCase() !== "admin@yzylabs.com").length === 0 ? (
            <p className={styles.dataHint}>Aún no hay actividad registrada por usuario en esta empresa.</p>
          ) : (
            <div className={styles.tableScroll} role="region" aria-label="Tabla de rendimiento por usuario" tabIndex={0}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th scope="col">Usuario</th>
                    <th scope="col">Desembolsos</th>
                    <th scope="col">Sin firmar</th>
                    <th scope="col">Sin desemb.</th>
                    <th scope="col">Docs</th>
                    <th scope="col">Tiempo ahorrado</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.user_stats
                    .filter(member => member.user_name.trim().toLowerCase() !== "admin@yzylabs.com")
                    .map(member => (
                    <tr key={member.user_id}>
                      <th scope="row">
                        <span className={styles.userCell}>
                          <span>{member.user_name}</span>
                          {member.is_current_user && <span className={styles.youBadge}>Tú</span>}
                        </span>
                      </th>
                      <td className={styles.numericStrong}>{member.disbursements_total}</td>
                      <td>{member.unsigned_cases}</td>
                      <td>{member.pending_disbursement_cases}</td>
                      <td>{member.documents_total}</td>
                      <td className={styles.numericStrong}>{formatMinutes(member.time_saved_minutes)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      <section className={`${styles.panel} ${styles.recent}`} aria-labelledby="cases-title">
        <div className={styles.panelHeader}>
          <h2 id="cases-title" ref={casesHeading} tabIndex={-1}>Expedientes recientes</h2>
          <Link className={styles.tableAction} href="/clientes">Ver todos</Link>
        </div>
        {stats.recent_cases.length === 0 ? (
          <p className={styles.dataHint}>Todavía no hay expedientes en esta empresa.</p>
        ) : (
          <div className={styles.tableScroll} role="region" aria-label="Tabla de expedientes recientes" tabIndex={0}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">Expediente</th>
                  <th scope="col">Cliente</th>
                  <th scope="col">Estado</th>
                  <th scope="col">Responsable</th>
                  <th scope="col">Creado</th>
                  <th scope="col"><span className={styles.srOnly}>Acciones</span></th>
                </tr>
              </thead>
              <tbody>
                {stats.recent_cases.map(item => (
                  <tr key={item.id}>
                    <th scope="row">{item.reference || "Sin referencia"}</th>
                    <td>{item.client_name}</td>
                    <td>
                      <span className={styles.statusCell}>
                        {operationStatusLabel(item.status)}
                        {!item.has_payment_plan && <span className={styles.planHint}>Sin plan</span>}
                      </span>
                    </td>
                    <td>{item.actor_name || "—"}</td>
                    <td><time dateTime={item.created_at}>{createdDate.format(new Date(item.created_at))}</time></td>
                    <td>
                      <Tooltip content="Abrir expediente">
                        <Link
                          href={`/clientes/${item.client_id}`}
                          className={styles.tableAction}
                          aria-label={`Abrir expediente de ${item.client_name}`}
                        >
                          <ArrowRight size={18} aria-hidden="true" />
                        </Link>
                      </Tooltip>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className={styles.analytics}>
        <section className={`${styles.panel} ${styles.monthly}`} aria-labelledby="monthly-title">
          <h2 id="monthly-title" ref={monthlyHeading} tabIndex={-1}>Documentos generados por mes</h2>
          <MonthlyChart months={charts.months} />
        </section>

        <section className={`${styles.panel} ${styles.formats}`} aria-labelledby="formats-title">
          <h2 id="formats-title">Documentos por formato</h2>
          <FormatChart formats={charts.formats} />
        </section>
      </div>
    </>
  );
}
