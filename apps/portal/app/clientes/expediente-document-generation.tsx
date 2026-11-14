"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/arc/button/button";
import { LoadingContent } from "@/components/loading/loading-ui";
import { PortalShell } from "@/components/portal-shell/portal-shell";
import { usePortalAccess } from "@/lib/portal-access";
import { expedienteDetails, expedienteHref } from "./client-paths";
import { clientErrorMessage, getExpediente, type Operation } from "./clients-api";
import { DocumentOptionsSkeleton, OperationDocumentPicker } from "./operation-document-picker";
import styles from "./clients.module.css";

export function ExpedienteDocumentGeneration({ clientId, expedienteId }: { clientId: string; expedienteId: string }) {
  const { state } = usePortalAccess();
  const accountId = state.kind === "ready" && state.identity.role === "member" && state.identity.access === "active" ? state.identity.id : undefined;
  return <PortalShell currentPage="/clientes" title="Generar Documento"
    loadingFallback={<LoadingContent label="Cargando tipos de documento…"><DocumentOptionsSkeleton /></LoadingContent>}
    backLink={{ href: expedienteHref(clientId, expedienteId), label: "Volver al expediente", tour: "expediente-return" }}>
    {accountId && <GenerationOptions key={`${accountId}:${clientId}:${expedienteId}`} accountId={accountId} clientId={clientId} expedienteId={expedienteId} />}
  </PortalShell>;
}

function GenerationOptions({ accountId, clientId, expedienteId }: { accountId: string; clientId: string; expedienteId: string }) {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<({ operation: Operation } | { message: string; retryable: boolean }) & { attempt: number }>();
  const current = result?.attempt === attempt ? result : undefined;

  useEffect(() => {
    const controller = new AbortController();
    getExpediente(accountId, expedienteId, controller.signal).then(operation => {
      if (controller.signal.aborted) return;
      setResult(operation.client_id === clientId ? { attempt, operation } : { attempt, message: "El expediente no está disponible.", retryable: false });
    }).catch(error => {
      if (!controller.signal.aborted) setResult({ attempt, message: clientErrorMessage(error, "No se pudo cargar el expediente."), retryable: true });
    });
    return () => controller.abort();
  }, [accountId, attempt, clientId, expedienteId]);

  if (!current) return <LoadingContent label="Cargando expediente…"><DocumentOptionsSkeleton /></LoadingContent>;
  if ("message" in current) return <div className={styles.panel}>
    <p className={styles.failure} role="alert">{current.message}</p>
    {current.retryable && <Button className={styles.alignStart} type="button" variant="secondary" onClick={() => setAttempt(value => value + 1)}>Reintentar</Button>}
  </div>;

  return <section className={styles.panel} aria-labelledby="generation-options-title">
    <h2 id="generation-options-title">{expedienteDetails(current.operation).label}</h2>
    <OperationDocumentPicker accountId={accountId} operation={current.operation} />
  </section>;
}
