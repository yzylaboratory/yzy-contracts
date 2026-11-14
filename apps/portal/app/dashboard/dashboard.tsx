"use client";

import Link from "next/link";
import { FilePlus2, Pencil } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { contractStatusLabels, errorMessage, listContracts } from "@/app/contratos/contracts-api";
import { documentTimeZone, legacyHistoryWarning, syncLegacyGeneratedDocuments } from "@/app/contratos/contracts-store";
import { getGeneratedDocumentStats, type GeneratedDocumentStats } from "@/app/contratos/generated-documents-api";
import { Button } from "@/components/arc/button/button";
import { MetricCard } from "@/components/arc/metric-card/metric-card";
import { Tooltip } from "@/components/arc/tooltip/tooltip";
import { isActiveAccount } from "@/lib/api";
import { useSession } from "@/lib/session";
import { FormatChart } from "./format-chart";
import DashboardLoading from "./loading";
import { MonthlyChart } from "./monthly-chart";
import styles from "./dashboard.module.css";

const monthName = new Intl.DateTimeFormat("es-DO", { month: "long", timeZone: "UTC" });
const monthShort = new Intl.DateTimeFormat("es-DO", { month: "short", timeZone: "UTC" });
const uploadedDate = new Intl.DateTimeFormat("es-DO", { dateStyle: "medium", timeZone: documentTimeZone });
const formatLabels = { pdf: "PDF", docx: "Word", email: "Correo" } as const;

function chartData(stats: GeneratedDocumentStats) {
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

type ContractListing = { data: Awaited<ReturnType<typeof listContracts>> } | { failure: string };
type History = { data: GeneratedDocumentStats; legacyPending: boolean } | { failure: string };

export function Dashboard() {
  const accountId = useSession()?.user.id;
  if (!accountId) return <DashboardLoading />;
  return <DashboardContent key={accountId} accountId={accountId} />;
}

function DashboardContent({ accountId }: { accountId: string }) {
  const [listing, setListing] = useState<ContractListing | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [history, setHistory] = useState<History | null>(null);
  const [historyAttempt, setHistoryAttempt] = useState(0);
  const [loadingContracts, setLoadingContracts] = useState(true);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const retryContractsButton = useRef<HTMLButtonElement>(null);
  const retryHistoryButton = useRef<HTMLButtonElement>(null);
  const contractsHeading = useRef<HTMLHeadingElement>(null);
  const monthlyHeading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    let active = true;
    listContracts({ page: 1, perPage: 4, name: "", status: "all" }, accountId)
      .then(async data => {
        if (!await isActiveAccount(accountId) || !active) return;
        const restoreFocus = document.activeElement === retryContractsButton.current;
        setListing({ data });
        if (restoreFocus) contractsHeading.current?.focus();
      })
      .catch((error: unknown) => {
        if (active) setListing({ failure: errorMessage(error, "No se pudieron cargar los contratos.") });
      })
      .finally(() => { if (active) setLoadingContracts(false); });
    return () => { active = false; };
  }, [accountId, attempt]);

  useEffect(() => {
    const request = new AbortController();
    const { signal } = request;
    async function load() {
      try {
        const synced = await syncLegacyGeneratedDocuments(accountId);
        if (signal.aborted) return;
        const data = await getGeneratedDocumentStats(accountId, signal);
        if (await isActiveAccount(accountId) && !signal.aborted) {
          const restoreFocus = synced && document.activeElement === retryHistoryButton.current;
          setHistory({ data, legacyPending: !synced });
          if (restoreFocus) requestAnimationFrame(() => {
            if (!signal.aborted && document.activeElement === document.body) monthlyHeading.current?.focus();
          });
        }
      } catch (error) {
        if (!signal.aborted) setHistory({ failure: errorMessage(error, "No se pudieron cargar los indicadores de generación.") });
      } finally {
        if (!signal.aborted) setLoadingHistory(false);
      }
    }
    void load();
    return () => request.abort();
  }, [accountId, historyAttempt]);

  if (!listing && !history) return <DashboardLoading />;
  const contracts = listing && "data" in listing ? listing.data.items : [];
  const stats = history && "data" in history ? history.data : null;
  const charts = stats ? chartData(stats) : null;
  const metrics = [
    ...(listing && "data" in listing ? [{ label: "Total de contratos", value: listing.data.total, tone: styles.lime }] : []),
    ...(stats ? [
      { label: "Documentos generados", value: stats.total, tone: styles.ink },
      { label: "Generados este mes", value: stats.current_month_total, tone: styles.violet },
    ] : []),
  ];

  function retryHistory() {
    setLoadingHistory(true);
    setHistoryAttempt(current => current + 1);
  }

  return (
    <>
      <section className={styles.metrics} aria-label="Indicadores">
        {metrics.map(metric => (
          <div key={metric.label} className={`${styles.metric} ${metric.tone}`}>
            <MetricCard label={metric.label} value={metric.value} context="" />
          </div>
        ))}
      </section>
      {!history && <p className={styles.dataHint} role="status">Cargando indicadores de generación…</p>}
      {history && "failure" in history && (
        <div className={styles.panel}>
          <p className={styles.dataHint} role="alert">{history.failure}</p>
          <Button ref={retryHistoryButton} type="button" variant="secondary" loading={loadingHistory} onClick={retryHistory}>Reintentar</Button>
        </div>
      )}
      {history && "legacyPending" in history && history.legacyPending && (
        <div className={styles.panel}>
          <p className={styles.dataHint} role="status">{legacyHistoryWarning}</p>
          <Button ref={retryHistoryButton} type="button" variant="secondary" loading={loadingHistory} onClick={retryHistory}>Reintentar sincronización</Button>
        </div>
      )}

      {charts && <div className={styles.analytics}>
        <section className={`${styles.panel} ${styles.monthly}`} aria-labelledby="monthly-title">
          <h2 id="monthly-title" ref={monthlyHeading} tabIndex={-1}>Documentos generados por mes</h2>
          <MonthlyChart months={charts.months} />
        </section>

        <section className={`${styles.panel} ${styles.formats}`} aria-labelledby="formats-title">
          <h2 id="formats-title">Documentos por formato</h2>
          <FormatChart formats={charts.formats} />
        </section>
      </div>}

      <section className={`${styles.panel} ${styles.recent}`} aria-labelledby="contracts-title">
        <div className={styles.panelHeader}>
          <h2 id="contracts-title" ref={contractsHeading} tabIndex={-1}>Contratos recientes</h2>
          <Link className={styles.tableAction} href="/contratos">Ver todos</Link>
        </div>
        {!listing ? <p className={styles.dataHint} role="status">Cargando contratos recientes…</p> : "failure" in listing ? (
          <div>
            <p className={styles.dataHint} role="alert">{listing.failure}</p>
            <Button ref={retryContractsButton} type="button" variant="secondary" loading={loadingContracts} onClick={() => {
              setLoadingContracts(true);
              setAttempt(current => current + 1);
            }}>Reintentar</Button>
          </div>
        ) : contracts.length === 0 ? (
          <p className={styles.dataHint}>Todavía no has cargado contratos.</p>
        ) : (
          <div className={styles.tableScroll} role="region" aria-label="Tabla de contratos recientes" tabIndex={0}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">Contrato</th>
                  <th scope="col">Estado</th>
                  <th scope="col">Cargado</th>
                  <th scope="col"><span className={styles.srOnly}>Acciones</span></th>
                </tr>
              </thead>
              <tbody>
                {contracts.map(contract => {
                  const action = contract.template_id ? "Generar documento" : "Editar contrato";
                  return <tr key={contract.id}>
                    <th scope="row">{contract.name}</th>
                    <td>{contractStatusLabels[contract.status]}</td>
                    <td><time dateTime={contract.created_at}>{uploadedDate.format(new Date(contract.created_at))}</time></td>
                    <td>
                      <Tooltip content={action}>
                        <Link
                          href={`/contratos/${contract.id}/${contract.template_id ? "generar" : "editar"}`}
                          className={styles.tableAction}
                          aria-label={`${action} para ${contract.name}`}
                        >
                          {contract.template_id ? <FilePlus2 size={18} aria-hidden="true" /> : <Pencil size={18} aria-hidden="true" />}
                        </Link>
                      </Tooltip>
                    </td>
                  </tr>;
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
