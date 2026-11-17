import { insuranceSaleDueDateKey, insuranceSaleInstallmentCount } from "./document-catalog";

export const ventaCondicionalSeguroBoldFields = [
  "fecha_de_firma",
  ...Array.from({ length: insuranceSaleInstallmentCount }, (_, index) => insuranceSaleDueDateKey(index + 1)),
];
