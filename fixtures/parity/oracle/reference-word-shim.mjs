// Oracle-only seam. The portal identifies reviewed bodies by the SHA-256 of word/document.xml
// against its own table. Synthetic cases cannot carry those digests, so this module answers the
// identification from `fixtures/parity/reviewed_bodies.json` (written by build_cases.py). Every
// other export, including the layouts and reference values, is the real portal module.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export * from "../../../apps/portal/app/contratos/reference-word.ts";

const syntheticBodies = JSON.parse(readFileSync(new URL("../reviewed_bodies.json", import.meta.url), "utf8"));

function digest(body) {
  return createHash("sha256").update(body).digest("hex");
}

export async function identifyReviewedWordBody(body) {
  const key = digest(body);
  return Object.hasOwn(syntheticBodies, key) ? syntheticBodies[key] : undefined;
}

export async function identifyReferenceWord(body) {
  const key = await identifyReviewedWordBody(body);
  return key === "venta_condicional_seguro" ? undefined : key;
}
