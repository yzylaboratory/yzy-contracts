"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { type BadgeTone } from "@/components/arc/badge/badge";
import { Button } from "@/components/arc/button/button";
import { Timeline } from "@/components/arc/timeline/timeline";
import { tourCopy } from "@/components/product-tour/tour-steps";
import { documentTimeZone } from "@/app/contratos/contracts-store";
import { activityScreenLabels, adminErrorMessage, getAdminActivityEvents, userStatuses, type ActivityEvent, type ActivityEventKind, type ActivityEventPage, type AdminActivity } from "./admin-api";
import { AdminPagination } from "./admin-pagination";
import adminStyles from "./admin.module.css";
import styles from "./activity.module.css";

const dateAndTime = new Intl.DateTimeFormat("es-DO", { timeZone: documentTimeZone, dateStyle: "medium", timeStyle: "short", hourCycle: "h23" });

const eventLabels: Record<ActivityEventKind, string> = {
  portal_visit: "Visitó una pantalla",
  portal_redirect: "Redirección del portal",
  not_found: "Página no encontrada",
  document_previewed: "Abrió la vista previa del PDF",
  client_created: "Registro de cliente",
  client_updated: "Actualización de cliente",
  operation_created: "Registro de operación",
  operation_updated: "Actualización de operación",
  generation_access: "Acceso al generador",
  document_render: "Preparación del PDF",
  document_export: "Exportación de documento",
  portal_access: "Acceso autenticado al portal",
  tour_opened: "Abrió el tour guiado",
  tour_step_viewed: "Vio un paso del tour",
  tour_completed: "Completó el tour guiado",
  tour_skipped: "Omitió el tour guiado",
  document_generated: "Documento generado guardado",
  invitation_registered: "Invitación registrada",
  invitation_sent: "Invitación enviada",
};

const resultLabels: Record<Exclude<ActivityEvent["result"], "observed">, { label: string; tone: BadgeTone }> = {
  success: { label: "Exitoso", tone: "success" },
  blocked: { label: "Bloqueado", tone: "warning" },
  failed: { label: "Fallido", tone: "danger" },
};

function eventScreen(event: ActivityEvent) {
  return event.screen && event.screen !== "not_found" ? activityScreenLabels[event.screen] : null;
}

export function LastActivity({ event }: { event: ActivityEvent | null }) {
  if (!event) return <span className={styles.secondary}>Sin actividad registrada</span>;
  const context = event.step ? tourCopy(event.step, {}).title : eventScreen(event);
  return (
    <>
      <span>{eventLabels[event.event]}{context && ` · ${context}`}</span>
      <time className={styles.secondary} dateTime={event.occurred_at}>{dateAndTime.format(new Date(event.occurred_at))}</time>
    </>
  );
}

function ActivityTimeline({ events }: { events: ActivityEvent[] }) {
  return <Timeline items={events.map((event, index) => {
    const screen = eventScreen(event);
    const details: string[] = [];
    if (screen) details.push(event.event === "portal_redirect" ? `Desde ${screen}` : screen);
    if (event.step) details.push(`Paso del tour · ${tourCopy(event.step, {}).title}`);
    return {
      id: `${event.occurred_at}-${event.event}-${index}`,
      dateTime: event.occurred_at,
      title: eventLabels[event.event],
      details,
      status: event.result === "observed" ? undefined : resultLabels[event.result],
    };
  })} />;
}

type TimelineRequest = { page: number };
type TimelineResult = { request: TimelineRequest; data: ActivityEventPage } | { request: TimelineRequest; error: string };

export function ActivityHistory({ accountId, userId, user, onBack }: { accountId: string; userId: string; user?: AdminActivity; onBack: () => void }) {
  const [request, setRequest] = useState<TimelineRequest>({ page: 1 });
  const [result, setResult] = useState<TimelineResult | null>(null);
  const [pagination, setPagination] = useState({ perPage: 1, total: 0 });
  const heading = useRef<HTMLHeadingElement>(null);
  const current = result?.request === request ? result : null;
  const data = current && "data" in current ? current.data : null;

  useEffect(() => { heading.current?.focus(); }, []);

  useEffect(() => {
    const controller = new AbortController();
    getAdminActivityEvents(accountId, userId, request.page, controller.signal).then(data => {
      if (controller.signal.aborted) return;
      const lastPage = Math.max(1, Math.ceil(data.total / data.per_page));
      if (request.page > lastPage) {
        setRequest(current => current === request ? { page: lastPage } : current);
        return;
      }
      setPagination({ perPage: data.per_page, total: data.total });
      setResult({ request, data });
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setResult({ request, error: adminErrorMessage(error) });
    });
    return () => controller.abort();
  }, [accountId, userId, request]);

  function refresh() {
    setRequest(current => ({ ...current }));
  }

  return (
    <section className={adminStyles.panel} aria-labelledby="activity-history-title">
      <div className={adminStyles.header}>
        <Button type="button" variant="ghost" onClick={onBack}><ArrowLeft size={16} aria-hidden="true" />Volver</Button>
        <Button type="button" variant="secondary" loading={!current} onClick={refresh}>Actualizar</Button>
      </div>
      <div className={styles.historyHeader}>
        <h2 id="activity-history-title" ref={heading} tabIndex={-1}>{user ? `Actividad de ${user.name ?? user.email}` : "Historial de actividad"}</h2>
        {user && <div className={styles.historyIdentity}>
          {user.name && <span className={styles.secondary}>{user.email}</span>}
          <span className={adminStyles.status}>{userStatuses[user.status]}</span>
        </div>}
        <p className={styles.secondary}>Hora de Santo Domingo</p>
      </div>
      {!current && <p className={adminStyles.hint} role="status">Cargando historial…</p>}
      {current && "error" in current && (
        <div className={adminStyles.retry}>
          <p className={adminStyles.error} role="alert">{current.error}</p>
          <Button type="button" variant="secondary" onClick={refresh}>Reintentar</Button>
        </div>
      )}
      {data && (data.items.length ? <ActivityTimeline events={data.items} /> : (
        <p className={adminStyles.hint} role="status">Esta cuenta todavía no tiene actividad registrada.</p>
      ))}
      <AdminPagination label="Páginas del historial" page={request.page} {...pagination} disabled={!data} onPage={page => setRequest({ page })} />
    </section>
  );
}
