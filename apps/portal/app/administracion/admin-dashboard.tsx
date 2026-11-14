"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/arc/button/button";
import { billingAmount, billingDate, billingPeriod } from "@/app/facturacion/billing-presentation";
import { adminRoutes, billingReviewSection } from "@/lib/admin-navigation";
import { getAdminDashboard, type DashboardSummary } from "./admin-api";
import { AdminActivityCharts } from "./admin-activity-charts";
import { AdminPagination } from "./admin-pagination";
import styles from "./admin-dashboard.module.css";

const count = new Intl.NumberFormat("es-DO").format;
const reviewHref = `${adminRoutes.billing}#${billingReviewSection}`;
const reportsPerPage = 3;

export function AdminDashboard({ accountId }: { accountId: string }) {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ attempt: number; page: number; data: DashboardSummary | null }>();
  const [reportPage, setReportPage] = useState(1);

  useEffect(() => {
    const request = new AbortController();
    getAdminDashboard(accountId, request.signal, reportPage, reportsPerPage)
      .then(data => { if (!request.signal.aborted) setResult({ attempt, page: reportPage, data }); })
      .catch(() => { if (!request.signal.aborted) setResult({ attempt, page: reportPage, data: null }); });
    return () => request.abort();
  }, [accountId, attempt, reportPage]);

  if (result?.attempt !== attempt) return <p className={styles.muted} role="status">Cargando indicadores…</p>;
  if (!result.data) return <div className={styles.panel}>
    <p role="alert">No se pudieron cargar los indicadores.</p>
    <Button type="button" variant="secondary" onClick={() => setAttempt(value => value + 1)}>Reintentar</Button>
  </div>;

  const { activity, collections, usage } = result.data;
  const reports = collections.recent_reports;
  const page = collections.recent_reports_page ?? 1;
  const total = collections.recent_reports_total ?? reports.length;
  const perPage = collections.recent_reports_per_page ?? Math.max(1, reports.length);
  const lastPage = Math.max(1, Math.ceil(total / perPage));
  if (result.page === reportPage && page > lastPage) setReportPage(lastPage);
  const period = billingPeriod(usage.period);
  return (
    <div className={styles.dashboard}>
      <section className={styles.panel} aria-labelledby="admin-collections-heading">
        <div className={styles.header}>
          <h2 id="admin-collections-heading">Cobros</h2>
          <Link className={styles.link} href={reviewHref}>Ir a Facturación <ArrowRight size={16} aria-hidden="true" /></Link>
        </div>
        <dl className={styles.metrics}>
          <Metric featured label="Transferencias por revisar" value={count(collections.transfers_to_review)} detail={billingAmount(collections.transfers_to_review_minor)} />
          <Metric label="Facturas vencidas sin reporte" value={billingAmount(collections.overdue_minor)} detail={`${count(collections.overdue_invoices)} facturas`} />
          <Metric label="Cobrado este mes" value={billingAmount(collections.confirmed_this_month_minor)} detail={period} />
        </dl>
        {total > 0 && (
          <div className={styles.reports}>
            <h3>Reportes recientes por revisar</h3>
            <ul className={styles.reportList} role="list">
              {reports.map(report => (
                <li key={report.invoice_id} className={styles.report}>
                  <span><strong>{report.account_name}</strong><br /><time className={styles.muted} dateTime={report.reported_at}>{billingDate(report.reported_at)}</time></span>
                  <span>{billingAmount(report.total_minor)}</span>
                </li>
              ))}
            </ul>
            <AdminPagination label="Páginas de reportes recientes" page={page} perPage={perPage} total={total} onPage={setReportPage} disabled={result.page !== reportPage} />
          </div>
        )}
      </section>
      <section className={styles.panel} aria-labelledby="admin-usage-heading">
        <div className={styles.header}>
          <h2 id="admin-usage-heading">Uso del portal</h2>
          <Link className={styles.link} href={adminRoutes.activity}>Ver actividad <ArrowRight size={16} aria-hidden="true" /></Link>
        </div>
        <dl className={styles.metrics}>
          <Metric label="Empresas activas" value={count(usage.active_companies)} href={adminRoutes.companies} />
          <Metric label="Usuarios habilitados" value={count(usage.enabled_users)} detail={`${count(usage.users_seen_this_month)} con acceso este mes`} href={adminRoutes.users} />
          <Metric label="Solicitudes de acceso" value={count(usage.access_requests)} detail="Pendientes de habilitar" href={adminRoutes.users} />
          <Metric label="Documentos generados" value={count(usage.documents_this_month)} detail={period} href={adminRoutes.activity} />
        </dl>
        <AdminActivityCharts activity={activity} />
      </section>
    </div>
  );
}

function Metric({ label, value, detail, href, featured }: {
  label: string; value: string; detail?: string; href?: string; featured?: boolean;
}) {
  return <div className={styles.metric} data-featured={featured || undefined}>
    <dt>{href ? <Link href={href}>{label}</Link> : label}</dt>
    <dd><strong>{value}</strong>{detail && <span>{detail}</span>}</dd>
  </div>;
}
