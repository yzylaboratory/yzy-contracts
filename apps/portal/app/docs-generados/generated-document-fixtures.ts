import { demoContracts } from "@/app/contratos/contracts-fixtures";
import type { GeneratedDocument } from "@/app/contratos/contracts-store";

type DocumentFixture = {
  contractIndex: number;
  date: string;
  format: GeneratedDocument["format"];
  filename: string;
};

const recent: DocumentFixture[] = [
  { contractIndex: 0, date: "2026-11-08", format: "pdf", filename: "arrendamiento-2026-11-08.pdf" },
  { contractIndex: 1, date: "2026-11-07", format: "docx", filename: "nda-2026-11-07.docx" },
  { contractIndex: 2, date: "2026-11-05", format: "email", filename: "servicios-2026-11-05.eml" },
  { contractIndex: 3, date: "2026-11-02", format: "pdf", filename: "trabajo-2026-11-02.pdf" },
  { contractIndex: 4, date: "2026-10-30", format: "email", filename: "compraventa-2026-10-30.eml" },
  { contractIndex: 0, date: "2026-10-27", format: "docx", filename: "arrendamiento-2026-10-27.docx" },
];

const archiveFormats = [
  ...Array<GeneratedDocument["format"]>(22).fill("pdf"),
  ...Array<GeneratedDocument["format"]>(13).fill("docx"),
  ...Array<GeneratedDocument["format"]>(6).fill("email"),
];

const archive = archiveFormats.map((format, index): DocumentFixture => {
  const contractIndex = index % demoContracts.length;
  const date = new Date(Date.UTC(2026, 9, 26 - index * 3)).toISOString().slice(0, 10);
  const extension = format === "email" ? "eml" : format;
  return { contractIndex, date, format, filename: `${demoContracts[contractIndex].id.toLowerCase()}-${date}.${extension}` };
});

export const documentFixtures: GeneratedDocument[] = [...recent, ...archive].map(({ contractIndex, date, format, filename }, index) => {
  const contract = demoContracts[contractIndex];
  return {
    id: `fixture-document-${index + 1}`,
    contractId: contract.id,
    contractName: contract.name,
    category: contract.category,
    createdAt: `${date}T16:00:00Z`,
    format,
    filename,
    markdown: `# ${contract.name}\n\nReferencia ${contract.id}.\n\nDocumento de revisión para la Parte A y la Parte B.\n\nFecha de preparación: ${date}.`,
    email: format === "email" ? {
      to: "",
      subject: contract.name,
      message: `Hola,\n\nAdjunto el documento para su revisión.\n\nSaludos.`,
      attachmentFormat: "pdf",
    } : undefined,
  };
});
