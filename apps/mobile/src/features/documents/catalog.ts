import type { AvailableDocument, CaseDocumentType } from '../../lib/api';

// Spanish labels matching apps/portal/app/contratos/document-catalog.ts and expedienteDocumentLabel.
export const CASE_DOCUMENT_LABELS: Record<CaseDocumentType, string> = {
  venta_condicional: 'Contrato de venta condicional de muebles',
  venta_condicional_seguro: 'Venta condicional de seguro',
  pagare_autentico: 'Pagaré auténtico notarial',
  entrega_voluntaria: 'Entrega voluntaria',
  acto_seguro: 'Contrato de venta condicional de muebles (SEGURO)',
  pagare_seguro: 'Pagaré auténtico notarial (SEGURO)',
  declaracion_jurada: 'Declaración jurada de persona física',
  gps: 'Contrato de acuerdo entre las partes - GPS',
  autorizacion_data: 'Autorización de revisión del buró de crédito',
  acuerdo_seguro: 'Acuerdo de renovación anual de seguro',
  autorizacion_asegurar_vehiculo: 'Carta de autorización para asegurar vehículo',
  autorizacion_desembolso: 'Autorización de desembolso',
  designacion_cuenta: 'Designación de cuenta',
  levantamiento_oposicion: 'Poder especial para levantamiento de oposición en la DGII',
  entrega_vehiculo: 'Entrega de vehículo',
  entrega_vehiculo_fines_saldo: 'Entrega de vehículo con fines de saldo',
  entrega_documentos: 'Entrega de documentos',
  carta_saldo: 'Carta de saldo',
};

// 6 portal groups from apps/portal/app/clientes/expediente-document-groups.ts.
export const CASE_DOCUMENT_GROUPS: readonly {
  title: string;
  types: readonly CaseDocumentType[];
}[] = [
  { title: 'Solicitud y evaluación', types: ['autorizacion_data', 'declaracion_jurada'] },
  { title: 'Formalización del préstamo', types: ['venta_condicional', 'pagare_autentico', 'gps'] },
  {
    title: 'Seguro del vehículo',
    types: [
      'autorizacion_asegurar_vehiculo',
      'acto_seguro',
      'venta_condicional_seguro',
      'pagare_seguro',
      'acuerdo_seguro',
    ],
  },
  { title: 'Desembolso y entrega', types: ['designacion_cuenta', 'autorizacion_desembolso', 'entrega_vehiculo'] },
  { title: 'Recuperación o incumplimiento', types: ['entrega_voluntaria', 'entrega_vehiculo_fines_saldo'] },
  { title: 'Cancelación y cierre del préstamo', types: ['carta_saldo', 'levantamiento_oposicion', 'entrega_documentos'] },
];

export const INSURANCE_DOCUMENT_TYPES: ReadonlySet<CaseDocumentType> = new Set([
  'venta_condicional_seguro',
  'acto_seguro',
  'pagare_seguro',
  'acuerdo_seguro',
  'autorizacion_asegurar_vehiculo',
]);

export function isInsuranceDocumentType(type: CaseDocumentType): boolean {
  return INSURANCE_DOCUMENT_TYPES.has(type);
}

export function documentLabel(type: CaseDocumentType): string {
  return CASE_DOCUMENT_LABELS[type];
}

export function groupAvailableDocuments(
  docs: readonly AvailableDocument[],
): { title: string; items: AvailableDocument[] }[] {
  const byType = new Map<CaseDocumentType, AvailableDocument>(docs.map((doc) => [doc.document_type, doc]));
  return CASE_DOCUMENT_GROUPS.map((group) => ({
    title: group.title,
    items: group.types.flatMap((type) => {
      const found = byType.get(type);
      return found ? [found] : [];
    }),
  })).filter((group) => group.items.length > 0);
}
