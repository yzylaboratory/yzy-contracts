import type { DocumentType } from "../contratos/document-catalog";

export const expedienteDocumentGroups: readonly {
  title: string;
  types: readonly (DocumentType | "solicitud_prestamo")[];
}[] = [
  { title: "Solicitud y evaluación", types: ["solicitud_prestamo", "autorizacion_data", "declaracion_jurada"] },
  { title: "Formalización del préstamo", types: ["venta_condicional", "pagare_autentico", "gps"] },
  { title: "Seguro del vehículo", types: ["autorizacion_asegurar_vehiculo", "acto_seguro", "pagare_seguro", "acuerdo_seguro"] },
  { title: "Desembolso y entrega", types: ["designacion_cuenta", "autorizacion_desembolso", "entrega_vehiculo"] },
  { title: "Recuperación o incumplimiento", types: ["entrega_voluntaria", "entrega_vehiculo_fines_saldo"] },
  { title: "Cancelación y cierre del préstamo", types: ["carta_saldo", "levantamiento_oposicion", "entrega_documentos"] },
];

const documentOrder: readonly string[] = expedienteDocumentGroups.flatMap(group => group.types);

export function expedienteDocumentPosition(type: string | undefined) {
  const index = type ? documentOrder.indexOf(type === "venta_condicional_seguro" ? "acto_seguro" : type) : -1;
  return index < 0 ? documentOrder.length : index;
}
