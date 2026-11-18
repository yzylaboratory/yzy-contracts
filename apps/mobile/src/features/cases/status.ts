import type { CaseStatus } from '../../lib/api';

export const STATUS_LABEL: Record<CaseStatus, string> = {
  solicitud: 'Solicitud',
  en_proceso: 'En proceso',
  firma: 'Firma',
  desembolso: 'Desembolso',
  cerrado: 'Cerrado',
};

export const STATUS_FILTERS: readonly (CaseStatus | 'todos')[] = [
  'todos',
  'solicitud',
  'en_proceso',
  'firma',
  'desembolso',
  'cerrado',
];

export function statusFilterLabel(value: CaseStatus | 'todos'): string {
  return value === 'todos' ? 'Todos' : STATUS_LABEL[value];
}
