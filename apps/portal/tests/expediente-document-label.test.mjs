import assert from "node:assert/strict";
import test from "node:test";
import { expedienteDocumentLabel, expedienteDownloadFilename } from "../app/clientes/expediente-document-label.ts";

test("the expediente lists uppercase titles and filenames in sentence case", () => {
  assert.equal(expedienteDocumentLabel("ACUERDO DE RENOVACIÓN ANUAL DE SEGURO"), "Acuerdo de renovación anual de seguro");
  assert.equal(expedienteDocumentLabel("PODER ESPECIAL EN LA DGII.docx", true), "Poder especial en la DGII.docx");
  assert.equal(expedienteDocumentLabel("CONTRATO DE ACUERDO ENTRE LAS PARTES - GPS.PDF", true), "Contrato de acuerdo entre las partes - GPS.PDF");
  assert.equal(expedienteDocumentLabel("Entrega voluntaria"), "Entrega voluntaria");
  assert.equal(expedienteDocumentLabel("entrega-voluntaria.docx", true), "entrega-voluntaria.docx");
});

test("document headings preserve Spanish accents and acronyms", () => {
  assert.equal(expedienteDocumentLabel("DECLARACION JURADA DE PERSONA FISICA"), "Declaración jurada de persona física");
  assert.equal(expedienteDocumentLabel("PODER ESPECIAL PARA LEVANTAMIENTO DE OPOSICION EN LA DGII"), "Poder especial para levantamiento de oposición en la DGII");
  assert.equal(expedienteDocumentLabel("ENTREGA DE VEHICULO"), "Entrega de vehículo");
  assert.equal(expedienteDocumentLabel("ENTREGA DE VEHICULO CON FINES DE SALDO"), "Entrega de vehículo con fines de saldo");
});

test("document labels and filenames preserve (SEGURO) in uppercase", () => {
  assert.equal(expedienteDocumentLabel("CONTRATO DE VENTA CONDICIONAL DE MUEBLES (SEGURO)"), "Contrato de venta condicional de muebles (SEGURO)");
  assert.equal(expedienteDocumentLabel("CONTRATO DE VENTA CONDICIONAL DE MUEBLES (SEGURO).docx", true), "Contrato de venta condicional de muebles (SEGURO).docx");
  assert.equal(expedienteDocumentLabel("Pagaré auténtico notarial (SEGURO)"), "Pagaré auténtico notarial (SEGURO)");
});

test("expediente accordion download uses visible title with real extension and spaces/accents", () => {
  assert.equal(expedienteDownloadFilename("Entrega de vehículo", "docx"), "Entrega de vehículo.docx");
  assert.equal(expedienteDownloadFilename("Entrega de vehículo", "pdf"), "Entrega de vehículo.pdf");
  assert.equal(expedienteDownloadFilename("ENTREGA DE VEHICULO", "docx"), "Entrega de vehículo.docx");
  assert.equal(expedienteDownloadFilename("CONTRATO DE VENTA CONDICIONAL DE MUEBLES (SEGURO)", "docx"), "Contrato de venta condicional de muebles (SEGURO).docx");
  assert.equal(expedienteDownloadFilename("CONTRATO DE VENTA CONDICIONAL DE MUEBLES (SEGURO)", "pdf"), "Contrato de venta condicional de muebles (SEGURO).pdf");
  assert.equal(expedienteDownloadFilename("DECLARACION JURADA DE PERSONA FISICA", "docx"), "Declaración jurada de persona física.docx");
  assert.equal(expedienteDownloadFilename("PODER ESPECIAL PARA LEVANTAMIENTO DE OPOSICION EN LA DGII", "docx"), "Poder especial para levantamiento de oposición en la DGII.docx");
  assert.equal(expedienteDownloadFilename("CONTRATO DE ACUERDO ENTRE LAS PARTES - GPS", "docx"), "Contrato de acuerdo entre las partes - GPS.docx");
  assert.equal(expedienteDownloadFilename("Acuerdo de renovación anual de seguro", "pdf"), "Acuerdo de renovación anual de seguro.pdf");
  assert.equal(expedienteDownloadFilename("entrega-de-vehiculo.docx", "docx"), "entrega-de-vehiculo.docx");
});
