import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

process.env.NEXT_PUBLIC_API_URL = "http://127.0.0.1:8080";
process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "synthetic-key";

const root = new URL("../", import.meta.url);
registerHooks({
  resolve(specifier, context, nextResolve) {
    const path = specifier.startsWith("@/") ? new URL(specifier.slice(2), root).href : specifier;
    try {
      return nextResolve(path, context);
    } catch (error) {
      if (error.code !== "ERR_MODULE_NOT_FOUND" || !/^(?:\.|file:)/.test(path)) throw error;
      return nextResolve(`${path}.ts`, context);
    }
  },
});

const {
  ANNUAL_INSURANCE_RENEWAL_TITLE,
  getDocumentType,
} = await import("../app/contratos/document-catalog.ts");
const {
  documentTypeFromName,
  matchDocumentTemplate,
} = await import("../app/clientes/document-template-match.ts");

test("catalogue key autorizacion_asegurar_vehiculo displays ACUERDO DE RENOVACIÓN ANUAL DE SEGURO and leaves acuerdo_seguro intact", () => {
  assert.equal(ANNUAL_INSURANCE_RENEWAL_TITLE, "ACUERDO DE RENOVACIÓN ANUAL DE SEGURO");

  const renewalDoc = getDocumentType("autorizacion_asegurar_vehiculo");
  assert.ok(renewalDoc, "El tipo autorizacion_asegurar_vehiculo debe existir en el catálogo");
  assert.equal(renewalDoc.label, "ACUERDO DE RENOVACIÓN ANUAL DE SEGURO");

  // Verificar que acuerdo_seguro no fue renombrado
  const insuranceDoc = getDocumentType("acuerdo_seguro");
  assert.ok(insuranceDoc, "El tipo acuerdo_seguro debe existir en el catálogo");
  assert.equal(insuranceDoc.label, "Acuerdo de seguro");
});

test("documentTypeFromName matches the exact title, legacy labels, former proposed title and docx filename", () => {
  // Nuevo título exacto y normalizado
  assert.equal(
    documentTypeFromName("ACUERDO DE RENOVACIÓN ANUAL DE SEGURO")?.id,
    "autorizacion_asegurar_vehiculo",
  );
  assert.equal(
    documentTypeFromName("Acuerdo de renovación anual de seguro")?.id,
    "autorizacion_asegurar_vehiculo",
  );
  assert.equal(
    documentTypeFromName("acuerdo de renovacion anual de seguro")?.id,
    "autorizacion_asegurar_vehiculo",
  );

  // Etiqueta heredada del catálogo
  assert.equal(
    documentTypeFromName("Autorización para asegurar vehículo")?.id,
    "autorizacion_asegurar_vehiculo",
  );
  assert.equal(
    documentTypeFromName("autorizacion para asegurar vehiculo")?.id,
    "autorizacion_asegurar_vehiculo",
  );

  // Título anterior propuesto sustituido
  assert.equal(
    documentTypeFromName("Carta de autorización para asegurar vehículo")?.id,
    "autorizacion_asegurar_vehiculo",
  );
  assert.equal(
    documentTypeFromName("carta de autorizacion para asegurar vehiculo")?.id,
    "autorizacion_asegurar_vehiculo",
  );

  // Nombre de archivo con .docx
  assert.equal(
    documentTypeFromName("autorizacion-para-asegurar-vehiculo.docx")?.id,
    "autorizacion_asegurar_vehiculo",
  );

  // Clave del catálogo
  assert.equal(
    documentTypeFromName("autorizacion_asegurar_vehiculo")?.id,
    "autorizacion_asegurar_vehiculo",
  );

  // acuerdo_seguro debe mantenerse separado e intacto
  assert.equal(documentTypeFromName("Acuerdo de seguro")?.id, "acuerdo_seguro");
  assert.equal(documentTypeFromName("acuerdo_seguro")?.id, "acuerdo_seguro");
  assert.notEqual(documentTypeFromName("Acuerdo de seguro")?.id, "autorizacion_asegurar_vehiculo");
});

test("matchDocumentTemplate resolves autorizacion_asegurar_vehiculo with new title, catalogue key and legacy template names", () => {
  const definition = getDocumentType("autorizacion_asegurar_vehiculo");
  assert.ok(definition);
  const keys = definition.requiredFields;

  // Coincidencia por catálogo
  assert.equal(
    matchDocumentTemplate("autorizacion_asegurar_vehiculo", "Cualquier nombre", keys, "autorizacion_asegurar_vehiculo"),
    "matching",
  );

  // Coincidencia por nuevo título
  assert.equal(
    matchDocumentTemplate("autorizacion_asegurar_vehiculo", "ACUERDO DE RENOVACIÓN ANUAL DE SEGURO", keys),
    "matching",
  );

  // Coincidencia por nombre de plantilla heredado
  assert.equal(
    matchDocumentTemplate("autorizacion_asegurar_vehiculo", "Autorización para asegurar vehículo", keys),
    "matching",
  );

  // Coincidencia por título propuesto anterior
  assert.equal(
    matchDocumentTemplate("autorizacion_asegurar_vehiculo", "Carta de autorización para asegurar vehículo", keys),
    "matching",
  );

  // Coincidencia por nombre de archivo DOCX
  assert.equal(
    matchDocumentTemplate("autorizacion_asegurar_vehiculo", "autorizacion-para-asegurar-vehiculo.docx", keys),
    "matching",
  );

  // No debe coincidir si apunta a acuerdo_seguro
  assert.equal(
    matchDocumentTemplate("autorizacion_asegurar_vehiculo", "Acuerdo de seguro", keys),
    undefined,
  );
});
