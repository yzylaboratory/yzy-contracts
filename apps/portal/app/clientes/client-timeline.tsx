"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/arc/button/button";
import { Timeline, type TimelineItem } from "@/components/arc/timeline/timeline";
import { LoadingContent } from "@/components/loading/loading-ui";
import { clientErrorMessage, listClientTimeline, type ClientTimelineChange, type ClientTimelineEvent, type ClientTimelinePage, type ClientTimelineValue } from "./clients-api";
import { TimelineSkeleton } from "./clients-skeleton";
import { operationStatusLabel } from "./expediente-status";
import styles from "./clients.module.css";

const eventLabels: Record<ClientTimelineEvent["kind"], string> = {
  client_created: "Cliente registrado",
  client_updated: "Cliente actualizado",
  operation_created: "Expediente registrado",
  operation_updated: "Expediente actualizado",
  document_generated: "Documento generado",
};

const fieldLabels = new Map<string, string>([
  ["name", "Nombre completo"],
  ["identity", "Cédula"],
  ["address", "Dirección"],
  ["phone", "Teléfono"],
  ["email", "Correo electrónico"],
  ["income_source", "Origen de los ingresos"],
  ["profile", "Datos complementarios del cliente"],
  ["contract_id", "Contrato base"],
  ["application", "Datos de la solicitud"],
  ["reference", "Referencia del expediente"],
  ["contract_date", "Fecha del contrato"],
  ["signature_date", "Fecha de firma"],
  ["status", "Estado"],
  ["insurance_installment_minor", "Monto de cada cuota del seguro"],
  ["insurance_paid", "Seguro saldo"],
  ["vehicle.registration_number", "Matrícula"],
  ["vehicle.chassis_number", "Chasis"],
  ["vehicle.plate", "Placa"],
  ["vehicle.make", "Marca"],
  ["vehicle.model", "Modelo"],
  ["vehicle.year", "Año"],
  ["vehicle.color", "Color"],
  ["vehicle.engine_number", "Número de motor"],
  ["vehicle.vehicle_type", "Tipo de vehículo"],
  ["financing.interest_installments", "Cuotas de intereses"],
  ["financing.final_principal", "Última cuota de capital"],
  ["financing.extraordinary_payments", "Abonos extraordinarios"],
  ["financing.extraordinary_from_signature", "Calendario de abonos desde la firma"],
  ["financing.insurance_installment_count", "Cantidad de cuotas del seguro"],
  ["financing.monthly_plan.capital_minor", "Capital financiado"],
  ["financing.monthly_plan.monthly_rate_basis_points", "Tasa mensual"],
  ["financing.monthly_plan.installment_count", "Cantidad de cuotas"],
]);

const dates = new Intl.DateTimeFormat("es-DO", { dateStyle: "medium", timeZone: "UTC" });
const currency = new Intl.NumberFormat("es-DO", { style: "currency", currency: "DOP" });
const numbers = new Intl.NumberFormat("es-DO");

function calendarDate(value: string) {
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? value : dates.format(date);
}

function paymentAmount(minor: number) {
  const cents = minor % 100;
  return currency.formatToParts((minor - cents) / 100)
    .map(part => part.type === "fraction" ? String(cents).padStart(2, "0") : part.value)
    .join("");
}

function formatChangeValue(field: string, value: ClientTimelineValue) {
  if (value === null) return "Sin valor";
  if (typeof value === "string") {
    if (field === "contract_date" || field === "signature_date") return calendarDate(value);
    if (field === "status") return operationStatusLabel(value);
    return value;
  }
  if (typeof value === "number") {
    if (field === "financing.monthly_plan.capital_minor" || field === "insurance_installment_minor") return paymentAmount(value);
    if (field === "financing.monthly_plan.monthly_rate_basis_points") return `${numbers.format(value / 100)} %`;
    return numbers.format(value);
  }
  if (typeof value === "boolean") return value ? "Sí" : "No";
  if (!Array.isArray(value) && typeof value.date === "string" && typeof value.amount_minor === "number") {
    return `${calendarDate(value.date)} · ${paymentAmount(value.amount_minor)}`;
  }
  return "Detalle no disponible";
}

function ChangeValue({ field, value }: { field: string; value: ClientTimelineValue }) {
  if (!Array.isArray(value)) return formatChangeValue(field, value);
  if (value.length === 0) return "Ninguno";
  return (
    <ul className={styles.timelinePaymentList}>
      {value.map((payment, index) => <li key={index}>{formatChangeValue(field, payment)}</li>)}
    </ul>
  );
}

function TimelineChanges({ changes }: { changes: ClientTimelineChange[] }) {
  return (
    <details className={styles.timelineChanges}>
      <summary>{changes.length === 1 ? "Ver 1 cambio" : `Ver ${changes.length} cambios`}</summary>
      <ul className={styles.timelineChangeList} role="list">
        {changes.map(change => (
          <li key={change.field}>
            <strong>{fieldLabels.get(change.field) ?? change.field}</strong>
            {change.field === "application" || change.field === "profile" ? <p className={styles.muted}>Consulta los datos actuales en el expediente.</p> : <dl className={styles.timelineChangeValues}>
              <div><dt>Antes</dt><dd><ChangeValue field={change.field} value={change.before} /></dd></div>
              <div><dt>Después</dt><dd><ChangeValue field={change.field} value={change.after} /></dd></div>
            </dl>}
          </li>
        ))}
      </ul>
    </details>
  );
}

function timelineItem(event: ClientTimelineEvent): TimelineItem {
  const changes = event.changes ?? [];
  const actor = event.actor_name?.trim();
  const details = [actor ? `Por ${actor}` : "Autor no registrado"];
  if (event.document_name) details.push(event.document_name);
  if (event.operation_label) details.push(event.operation_label);
  if (changes.length === 0 && (event.kind === "client_updated" || event.kind === "operation_updated")) {
    details.push("Detalle del cambio no registrado");
  }

  return {
    id: `${event.kind}:${event.id}`,
    dateTime: event.occurred_at,
    title: eventLabels[event.kind],
    details,
    content: changes.length > 0 ? <TimelineChanges changes={changes} /> : undefined,
  };
}

type Request = { page: number };
type Result = { request: Request; data: ClientTimelinePage } | { request: Request; message: string };

export function ClientTimeline({ accountId, clientId, operationId }: {
  accountId: string;
  clientId: string;
  operationId?: string;
}) {
  const [request, setRequest] = useState<Request>({ page: 1 });
  const [result, setResult] = useState<Result>();
  const [pageCount, setPageCount] = useState(1);
  const current = result?.request === request ? result : undefined;

  useEffect(() => {
    const controller = new AbortController();
    listClientTimeline(accountId, clientId, request.page, controller.signal, operationId)
      .then(data => {
        if (controller.signal.aborted) return;
        const lastPage = Math.max(1, Math.ceil(data.total / data.per_page));
        if (request.page > lastPage) {
          setRequest(previous => previous === request ? { page: lastPage } : previous);
          return;
        }
        setPageCount(lastPage);
        setResult({ request, data });
      })
      .catch(error => {
        if (controller.signal.aborted) return;
        setResult({ request, message: clientErrorMessage(error, "No se pudo cargar el historial.") });
      });
    return () => controller.abort();
  }, [accountId, clientId, operationId, request]);

  const canGoBack = Boolean(current && request.page > 1);
  const canGoForward = Boolean(current && request.page < pageCount);
  const historyLabel = operationId ? "Historial del expediente" : "Historial del cliente";

  return (
    <section className={styles.panel} aria-labelledby="client-timeline-title">
      <div className={styles.header}>
        <h2 id="client-timeline-title">{historyLabel}</h2>
        <span className={styles.muted}>Hora de Santo Domingo</span>
      </div>
      {!current ? <LoadingContent label="Cargando historial…"><TimelineSkeleton /></LoadingContent> : "message" in current ? (
        <div className={styles.header}>
          <p className={styles.failure} role="alert">{current.message}</p>
          <Button type="button" variant="secondary" onClick={() => setRequest({ page: request.page })}>Reintentar</Button>
        </div>
      ) : current.data.items.length > 0 ? <Timeline items={current.data.items.map(timelineItem)} /> : (
        <p className={styles.muted}>Aún no hay eventos registrados.</p>
      )}
      {pageCount > 1 && (
        <nav className={styles.pagination} aria-label={`Páginas de ${historyLabel.toLowerCase()}`}>
          <Button type="button" variant="secondary" aria-disabled={!canGoBack} onClick={() => {
            if (canGoBack) setRequest({ page: request.page - 1 });
          }}>Anterior</Button>
          <span className={styles.muted} role="status">Página {request.page} de {pageCount}</span>
          <Button type="button" variant="secondary" aria-disabled={!canGoForward} onClick={() => {
            if (canGoForward) setRequest({ page: request.page + 1 });
          }}>Siguiente</Button>
        </nav>
      )}
    </section>
  );
}
