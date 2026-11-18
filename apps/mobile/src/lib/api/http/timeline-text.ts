import type { TimelineEvent } from '../contract';
import type { JsonValue, TimelineEventWire } from './wire-schema';

// Spanish labels ported from apps/portal/app/clientes/client-timeline.tsx and expediente-status.ts.
const EVENT_LABELS: Record<TimelineEventWire['kind'], string> = {
  client_created: 'Cliente registrado',
  client_updated: 'Cliente actualizado',
  operation_created: 'Expediente registrado',
  operation_updated: 'Expediente actualizado',
  document_generated: 'Documento generado',
};

const STATUS_LABELS: Record<string, string> = {
  solicitud: 'Solicitud',
  en_proceso: 'En proceso',
  firma: 'Firma',
  desembolso: 'Desembolso',
  cerrado: 'Cerrado',
};

const FIELD_LABELS = new Map<string, string>([
  ['name', 'Nombre completo'],
  ['identity', 'Cédula'],
  ['address', 'Dirección'],
  ['phone', 'Teléfono'],
  ['email', 'Correo electrónico'],
  ['income_source', 'Origen de los ingresos'],
  ['profile', 'Datos complementarios del cliente'],
  ['contract_id', 'Contrato base'],
  ['application', 'Datos de la solicitud'],
  ['reference', 'Referencia del expediente'],
  ['contract_date', 'Fecha del contrato'],
  ['signature_date', 'Fecha de firma'],
  ['status', 'Estado'],
  ['insurance_installment_minor', 'Monto de cada cuota del seguro'],
  ['insurance_paid', 'Seguro saldo'],
  ['vehicle.registration_number', 'Matrícula'],
  ['vehicle.chassis_number', 'Chasis'],
  ['vehicle.plate', 'Placa'],
  ['vehicle.make', 'Marca'],
  ['vehicle.model', 'Modelo'],
  ['vehicle.year', 'Año'],
  ['vehicle.color', 'Color'],
  ['vehicle.engine_number', 'Número de motor'],
  ['vehicle.vehicle_type', 'Tipo de vehículo'],
  ['vehicle.source_document', 'Documento del vehículo'],
  ['financing.interest_installments', 'Cuotas de intereses'],
  ['financing.final_principal', 'Última cuota de capital'],
  ['financing.extraordinary_payments', 'Abonos extraordinarios'],
  ['financing.extraordinary_from_signature', 'Calendario de abonos desde la firma'],
  ['financing.insurance_installment_count', 'Cantidad de cuotas del seguro'],
  ['financing.monthly_plan.capital_minor', 'Capital financiado'],
  ['financing.monthly_plan.monthly_rate_basis_points', 'Tasa mensual'],
  ['financing.monthly_plan.installment_count', 'Cantidad de cuotas'],
]);

const dates = new Intl.DateTimeFormat('es-DO', { dateStyle: 'medium', timeZone: 'UTC' });
const currency = new Intl.NumberFormat('es-DO', { style: 'currency', currency: 'DOP' });
const numbers = new Intl.NumberFormat('es-DO');

function operationStatusLabel(status: string): string {
  return STATUS_LABELS[status] ?? 'Solicitud';
}

function calendarDate(value: string): string {
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? value : dates.format(date);
}

function paymentAmount(minor: number): string {
  const cents = minor % 100;
  return currency
    .formatToParts((minor - cents) / 100)
    .map((part) => (part.type === 'fraction' ? String(cents).padStart(2, '0') : part.value))
    .join('');
}

function isPayment(value: { [key: string]: JsonValue }): value is { date: string; amount_minor: number } {
  return typeof value.date === 'string' && typeof value.amount_minor === 'number';
}

function formatChangeValue(field: string, value: JsonValue): string {
  if (value === null) return 'Sin valor';
  if (typeof value === 'string') {
    if (field === 'contract_date' || field === 'signature_date') return calendarDate(value);
    if (field === 'status') return operationStatusLabel(value);
    if (field === 'vehicle.source_document') return value === 'bill_of_lading' ? 'Bill of lading (importado)' : 'Matrícula';
    return value;
  }
  if (typeof value === 'number') {
    if (field === 'financing.monthly_plan.capital_minor' || field === 'insurance_installment_minor') return paymentAmount(value);
    if (field === 'financing.monthly_plan.monthly_rate_basis_points') return `${numbers.format(value / 100)} %`;
    return numbers.format(value);
  }
  if (typeof value === 'boolean') return value ? 'Sí' : 'No';
  if (Array.isArray(value)) {
    if (value.length === 0) return 'Ninguno';
    return value.map((item) => formatChangeValue(field, item)).join(', ');
  }
  if (isPayment(value)) return `${calendarDate(value.date)} · ${paymentAmount(value.amount_minor)}`;
  return 'Detalle no disponible';
}

function changeSentence(change: TimelineEventWire['changes'][number]): string {
  const label = FIELD_LABELS.get(change.field) ?? change.field;
  if (change.field === 'application' || change.field === 'profile') {
    return `${label}: Consulta los datos actuales en el expediente.`;
  }
  return `${label}: ${formatChangeValue(change.field, change.before)} → ${formatChangeValue(change.field, change.after)}`;
}

function timelineDetail(event: TimelineEventWire): string {
  const actor = event.actor_name?.trim();
  const lines = [actor ? `Por ${actor}` : 'Autor no registrado'];
  if (event.document_name) lines.push(event.document_name);
  if (event.operation_label) lines.push(event.operation_label);
  if (event.changes.length === 0 && (event.kind === 'client_updated' || event.kind === 'operation_updated')) {
    lines.push('Detalle del cambio no registrado');
  }
  for (const change of event.changes) lines.push(changeSentence(change));
  return lines.join('\n');
}

// Event id alone is not unique across kinds. The composite matches the portal timeline key.
export function toTimelineEvent(event: TimelineEventWire): TimelineEvent {
  return {
    id: `${event.kind}:${event.id}`,
    occurred_at: event.occurred_at,
    title: EVENT_LABELS[event.kind],
    detail: timelineDetail(event),
  };
}
