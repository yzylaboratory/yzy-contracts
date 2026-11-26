"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/arc/badge/badge";
import { Button } from "@/components/arc/button/button";
import { LoadingBlock, LoadingContent } from "@/components/loading/loading-ui";
import { insuranceMessage, type Due } from "./insurance-api";
import styles from "./insurance.module.css";

export const policiesPath = "/control-seguros/polizas";
export const policyPath = (id: string) => `${policiesPath}/${id}`;

const dateFormat = new Intl.DateTimeFormat("es-DO", { dateStyle: "medium", timeZone: "UTC" });
const moneyFormat = new Intl.NumberFormat("es-DO", { style: "currency", currency: "DOP" });
export const dateText = (value: string) => dateFormat.format(new Date(`${value}T00:00:00Z`));
export function money(minor: number | bigint) {
  const amount = BigInt(minor);
  const cents = (amount % BigInt(100)).toString().padStart(2, "0");
  return moneyFormat.formatToParts(amount / BigInt(100)).map(part => part.type === "fraction" ? cents : part.value).join("");
}
export const concept = (due: Due) => due.slot === 0 ? "Renovación" : `Cuota ${due.slot}`;

export function DueStatus({ due, today }: { due: Due; today: string }) {
  const days = (Date.parse(due.due_on) - Date.parse(today)) / 86_400_000;
  const status = due.replaced ? "Reemplazado" : due.paid_on ? "Pagado" : days < 0 ? "Vencido"
    : days === 0 ? "Vence hoy" : days === 1 ? "En 1 día" : `En ${days} días`;
  return <Badge size="sm" tone="neutral" outline>{status}</Badge>;
}

export function useInsuranceData<T>(load: (signal: AbortSignal) => Promise<T>) {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ load: typeof load; attempt: number; data?: T; error?: string }>();
  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal).then(data => {
      if (!controller.signal.aborted) setResult({ load, attempt, data });
    }, error => {
      if (!controller.signal.aborted) setResult({ load, attempt, error: insuranceMessage(error) });
    });
    return () => controller.abort();
  }, [load, attempt]);
  const current = result?.load === load && result.attempt === attempt ? result : undefined;
  return { data: current?.data, error: current?.error, retry: () => setAttempt(value => value + 1) };
}

export function InsuranceError({ message, retry }: { message: string; retry?: () => void }) {
  return <div className={styles.error}>
    <p role="alert">{message}</p>
    {retry && <Button type="button" variant="secondary" onClick={retry}>Reintentar</Button>}
  </div>;
}

export type SkeletonView = "policies" | "detail" | "editor";

export function InsuranceSkeleton({ view }: { view: SkeletonView }) {
  if (view === "editor") return <div className={styles.stack}>
    {[3, 3, 2].map((count, index) => <div key={index} className={styles.panel}>
      <LoadingBlock width={150} height={20} />
      <div className={styles.fields}>{Array.from({ length: count }, (_, i) => <LoadingBlock key={i} height={58} />)}</div>
    </div>)}
  </div>;
  return <div className={styles.stack}>
    <LoadingBlock width={420} height={44} />
    {[1, 2, 3, 4].map(index => <LoadingBlock key={index} height={42} />)}
    {view === "detail" && <LoadingBlock height={80} />}
  </div>;
}

export function InsuranceLoadingContent({ view }: { view: SkeletonView }) {
  return <LoadingContent label="Cargando Control de Pólizas…"><InsuranceSkeleton view={view} /></LoadingContent>;
}
