export const categories = ["Vivienda", "Legal", "Servicios", "Laboral", "Comercial"] as const;
export type ContractCategory = (typeof categories)[number];

export type DemoContract = {
  id: string;
  name: string;
  category: ContractCategory;
  date: string;
  documents: number;
};

export const demoContracts: DemoContract[] = [
  { id: "CTR-018", name: "Contrato de arrendamiento", category: "Vivienda", date: "2026-11-06", documents: 9 },
  { id: "CTR-017", name: "Acuerdo de confidencialidad (NDA)", category: "Legal", date: "2026-11-03", documents: 7 },
  { id: "CTR-016", name: "Contrato de servicios profesionales", category: "Servicios", date: "2026-10-28", documents: 12 },
  { id: "CTR-015", name: "Contrato de trabajo", category: "Laboral", date: "2026-10-21", documents: 8 },
  { id: "CTR-014", name: "Contrato de compraventa", category: "Comercial", date: "2026-10-14", documents: 5 },
  { id: "CTR-013", name: "Acuerdo de mantenimiento", category: "Servicios", date: "2026-10-09", documents: 1 },
  { id: "CTR-012", name: "Contrato de subarrendamiento", category: "Vivienda", date: "2026-09-30", documents: 1 },
  { id: "CTR-011", name: "Convenio de distribución", category: "Comercial", date: "2026-09-16", documents: 1 },
  { id: "CTR-010", name: "Acuerdo de colaboración", category: "Legal", date: "2026-09-03", documents: 1 },
  { id: "CTR-009", name: "Contrato de pasantía", category: "Laboral", date: "2026-08-20", documents: 1 },
  { id: "CTR-008", name: "Contrato de soporte técnico", category: "Servicios", date: "2026-08-06", documents: 1 },
  { id: "CTR-007", name: "Promesa de compraventa", category: "Vivienda", date: "2026-07-24", documents: 0 },
  { id: "CTR-006", name: "Acuerdo de suministro", category: "Comercial", date: "2026-07-10", documents: 0 },
  { id: "CTR-005", name: "Acuerdo de cesión de derechos", category: "Legal", date: "2026-06-23", documents: 0 },
  { id: "CTR-004", name: "Contrato de consultoría", category: "Servicios", date: "2026-06-08", documents: 0 },
  { id: "CTR-003", name: "Anexo de jornada laboral", category: "Laboral", date: "2026-05-19", documents: 0 },
  { id: "CTR-002", name: "Acuerdo de depósito de garantía", category: "Vivienda", date: "2025-12-12", documents: 0 },
  { id: "CTR-001", name: "Convenio de representación comercial", category: "Comercial", date: "2025-11-20", documents: 0 },
];
