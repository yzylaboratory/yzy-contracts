export const operationStatuses = ["solicitud", "en_proceso", "firma", "desembolso", "cerrado"] as const;

export type OperationStatus = (typeof operationStatuses)[number];

const labels: Record<OperationStatus, string> = {
  solicitud: "Solicitud",
  en_proceso: "En proceso",
  firma: "Firma",
  desembolso: "Desembolso",
  cerrado: "Cerrado",
};

export function isOperationStatus(value: string): value is OperationStatus {
  return (operationStatuses as readonly string[]).includes(value);
}

export function operationStatusLabel(status: OperationStatus | string | null | undefined) {
  if (!status || !isOperationStatus(status)) return "Solicitud";
  return labels[status];
}

export const operationStatusOptions = operationStatuses.map(value => ({ value, label: labels[value] }));
