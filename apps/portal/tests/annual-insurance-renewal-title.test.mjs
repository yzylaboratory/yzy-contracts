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

const { getDocumentType } = await import("../app/contratos/document-catalog.ts");
const { documentTypeFromName } = await import("../app/clientes/document-template-match.ts");
const { fileBase } = await import("../app/contratos/contract-template-fields.ts");

test("insurance documents retain distinct titles and filenames", () => {
  for (const [key, title, filename] of [
    ["autorizacion_asegurar_vehiculo", "Carta de autorización para asegurar vehículo", "autorizacion-para-asegurar-vehiculo"],
    ["acuerdo_seguro", "Acuerdo de renovación anual de seguro", "acuerdo-de-seguro"],
  ]) {
    assert.equal(getDocumentType(key)?.label, title);
    assert.equal(documentTypeFromName(title)?.id, key);
    assert.equal(documentTypeFromName(filename + ".docx")?.id, key);
    assert.equal(fileBase(title, key), filename);
  }
});
