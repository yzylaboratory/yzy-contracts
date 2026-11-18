import assert from "node:assert/strict";
import test from "node:test";
import { expedienteDocumentLabel } from "../app/clientes/expediente-document-label.ts";

test("the expediente lists uppercase titles and filenames in sentence case", () => {
  assert.equal(expedienteDocumentLabel("ACUERDO DE RENOVACIÓN ANUAL DE SEGURO"), "Acuerdo de renovación anual de seguro");
  assert.equal(expedienteDocumentLabel("PODER ESPECIAL EN LA DGII.docx", true), "Poder especial en la DGII.docx");
  assert.equal(expedienteDocumentLabel("CONTRATO DE ACUERDO ENTRE LAS PARTES - GPS.PDF", true), "Contrato de acuerdo entre las partes - GPS.PDF");
  assert.equal(expedienteDocumentLabel("Entrega voluntaria"), "Entrega voluntaria");
  assert.equal(expedienteDocumentLabel("entrega-voluntaria.docx", true), "entrega-voluntaria.docx");
});
