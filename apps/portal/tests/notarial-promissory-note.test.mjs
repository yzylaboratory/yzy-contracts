import test from "node:test";
import assert from "node:assert/strict";
import { createRequire, registerHooks } from "node:module";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

process.env.NEXT_PUBLIC_API_URL = "http://127.0.0.1:8080";
process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "synthetic-key";

const root = new URL("../", import.meta.url);
const repoRoot = fileURLToPath(new URL("../../", root));
const portalNodeModules = join(repoRoot, "apps/portal/node_modules");
const pnpmStore = join(repoRoot, "node_modules/.pnpm");
const jsdomDir = readdirSync(pnpmStore).find(name => /^jsdom@26\./.test(name));
if (!jsdomDir) throw new Error("jsdom 26 not found in pnpm store");
const requireFromPortal = createRequire(join(portalNodeModules, "x.js"));
const { JSDOM } = requireFromPortal(join(pnpmStore, jsdomDir, "node_modules/jsdom"));
const { unzipSync, zipSync } = requireFromPortal("fflate");

const dom = new JSDOM("");
globalThis.DOMParser = dom.window.DOMParser;
globalThis.XMLSerializer = dom.window.XMLSerializer;

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
  NOTARIAL_PROMISSORY_NOTE_TITLE,
  getDocumentType,
} = await import("../app/contratos/document-catalog.ts");
const { documentTypeFromName, matchDocumentTemplate } = await import("../app/clientes/document-template-match.ts");
const { fileBase } = await import("../app/contratos/contract-template-fields.ts");
const { fillOriginalWord } = await import("../app/contratos/native-document.ts");

const wordNs = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

function buildSyntheticPagareDocx() {
  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${wordNs}">
  <w:body>
    <w:p>
      <w:pPr><w:jc w:val="center"/></w:pPr>
      <w:r><w:rPr><w:b/></w:rPr><w:t>PAGARE AUTENTICO NOTARIAL.</w:t></w:r>
    </w:p>
    <w:p><w:r><w:t></w:t></w:r></w:p>
    <w:p>
      <w:pPr><w:spacing w:before="0" w:after="120"/><w:jc w:val="both"/></w:pPr>
      <w:r><w:rPr><w:b/><w:bCs/></w:rPr><w:t xml:space="preserve">ACTO </w:t></w:r>
      <w:r><w:rPr><w:bCs/></w:rPr><w:t>Número</w:t></w:r>
      <w:r><w:rPr><w:b/><w:bCs/></w:rPr><w:t>,</w:t></w:r>
      <w:r><w:t xml:space="preserve">                                                                                                                                      En la  Ciudad de Santo Domingo, Distrito Nacional, Capital de la República  Dominicana, a {{fecha_firma}}</w:t></w:r>
      <w:r><w:t xml:space="preserve">, por ante mí </w:t></w:r>
      <w:r><w:rPr><w:b/></w:rPr><w:t>{{nombre_del_notario}}</w:t></w:r>
      <w:r><w:t xml:space="preserve">.</w:t></w:r>
    </w:p>
    <w:p>
      <w:r><w:rPr><w:b/><w:bCs/></w:rPr><w:t xml:space="preserve">_______________________________        _______________________________                                       </w:t></w:r>
      <w:r><w:rPr><w:b/><w:bCs/></w:rPr><w:t xml:space="preserve">{{testigo_richard}}             </w:t></w:r>
      <w:r><w:rPr><w:b/><w:bCs/></w:rPr><w:t xml:space="preserve">{{testigo_usuario}}   TESTIGO                                                                           TESTIGO                                                                                                       </w:t></w:r>
      <w:r><w:t>_</w:t></w:r>
    </w:p>
    <w:sectPr>
      <w:pgSz w:w="12240" w:h="20160"/>
      <w:pgMar w:left="1701" w:right="1701" w:top="993" w:bottom="284"/>
    </w:sectPr>
  </w:body>
</w:document>`;

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

  const bytes = zipSync({
    "[Content_Types].xml": new TextEncoder().encode(contentTypes),
    "_rels/.rels": new TextEncoder().encode(rels),
    "word/document.xml": new TextEncoder().encode(xml),
  });
  return new Blob([bytes]);
}

test("pagare_autentico uses Pagaré auténtico notarial in catalog, keeps pagare-autentico.docx filename, and matches legacy aliases", () => {
  const definition = getDocumentType("pagare_autentico");
  assert.ok(definition);
  assert.equal(NOTARIAL_PROMISSORY_NOTE_TITLE, "Pagaré auténtico notarial");
  assert.equal(definition.label, "Pagaré auténtico notarial");

  assert.equal(fileBase("Pagaré auténtico notarial", "pagare_autentico"), "pagare-autentico");
  assert.equal(fileBase("Pagaré auténtico notarial"), "pagare-autentico");
  assert.equal(fileBase("PAGARÉ AUTÉNTICO NOTARIAL"), "pagare-autentico");
  assert.equal(fileBase("Pagaré auténtico", "pagare_autentico"), "pagare-autentico");
  assert.equal(fileBase("Pagaré auténtico"), "pagare-autentico");

  for (const alias of [
    "Pagaré auténtico notarial",
    "Pagaré auténtico",
    "pagare-autentico.docx",
    "pagare_autentico",
    "Pagaré notarial",
  ]) {
    assert.equal(documentTypeFromName(alias)?.id, "pagare_autentico", `alias failed: ${alias}`);
    assert.equal(matchDocumentTemplate("pagare_autentico", alias, definition.requiredFields), "matching");
  }
  assert.equal(matchDocumentTemplate("pagare_autentico", "Cualquier nombre", definition.requiredFields, "pagare_autentico"), "matching");
});

test("formatPagareAutentico renders ACTO left and Número, right above left-aligned En la Ciudad... while keeping bold date and witness table", async () => {
  const { formatPagareAutentico } = await import("../app/contratos/word-pagare-autentico.ts");

  const filled = await fillOriginalWord(
    buildSyntheticPagareDocx(),
    "",
    [
      { key: "fecha_firma", label: "Fecha", kind: "date", dateStyle: "notarialAct", required: true },
      { key: "nombre_del_notario", label: "Notario", kind: "text", required: true },
      { key: "testigo_richard", label: "Testigo 1", kind: "text", required: true },
      { key: "testigo_usuario", label: "Testigo 2", kind: "text", required: true },
    ],
    {
      fecha_firma: "2026-11-17",
      nombre_del_notario: "LIC. RENÉ ÁLVAREZ DE PRUEBA",
      testigo_richard: "ADRIÁN LUNA DE PRUEBA",
      testigo_usuario: "NICOLÁS SOL DE ENSAYO",
    },
    [
      { key: "fecha_firma", occurrences: 1 },
      { key: "nombre_del_notario", occurrences: 1 },
      { key: "testigo_richard", occurrences: 1 },
      { key: "testigo_usuario", occurrences: 1 },
    ],
    false,
    undefined,
    false,
    true,
  );

  const files = unzipSync(new Uint8Array(await filled.arrayBuffer()));
  const doc = new DOMParser().parseFromString(new TextDecoder().decode(files["word/document.xml"]), "application/xml");
  formatPagareAutentico(doc);

  const body = doc.getElementsByTagNameNS(wordNs, "body")[0];
  const children = Array.from(body.children);
  assert.equal(children[0].localName, "p");
  assert.equal(children[1].localName, "p");
  assert.equal(children[2].localName, "tbl");
  assert.equal(children[3].localName, "p");

  const headerTable = children[2];
  const headerRows = Array.from(headerTable.children).filter(el => el.localName === "tr");
  assert.equal(headerRows.length, 1);
  const headerCells = Array.from(headerRows[0].children).filter(el => el.localName === "tc");
  assert.equal(headerCells.length, 2);

  const leftText = Array.from(headerCells[0].getElementsByTagNameNS(wordNs, "t"), n => n.textContent ?? "").join("");
  const rightText = Array.from(headerCells[1].getElementsByTagNameNS(wordNs, "t"), n => n.textContent ?? "").join("");
  assert.equal(leftText, "ACTO");
  assert.equal(rightText, "Número,");

  const leftJc = headerCells[0].getElementsByTagNameNS(wordNs, "jc")[0]?.getAttributeNS(wordNs, "val");
  const rightJc = headerCells[1].getElementsByTagNameNS(wordNs, "jc")[0]?.getAttributeNS(wordNs, "val");
  assert.equal(leftJc, "left");
  assert.equal(rightJc, "right");

  const leftRunBold = headerCells[0].getElementsByTagNameNS(wordNs, "r")[0]?.getElementsByTagNameNS(wordNs, "b").length;
  const rightRuns = Array.from(headerCells[1].getElementsByTagNameNS(wordNs, "r"));
  assert.equal(leftRunBold, 1);
  assert.equal(rightRuns[0].getElementsByTagNameNS(wordNs, "b").length, 0);
  assert.equal(rightRuns[1].getElementsByTagNameNS(wordNs, "b").length, 1);

  const opening = children[3];
  const openingRuns = Array.from(opening.getElementsByTagNameNS(wordNs, "r"));
  const openingText = Array.from(opening.getElementsByTagNameNS(wordNs, "t"), n => n.textContent ?? "").join("");
  assert.ok(openingText.startsWith("En la  Ciudad de Santo Domingo"), `Expected left-aligned start, got: ${openingText}`);
  assert.match(openingText, /DIECISIETE \(17\) días del mes de NOVIEMBRE del año 2026/);

  const dateRun = openingRuns.find(run => run.textContent?.includes("DIECISIETE (17)"));
  assert.ok(dateRun, "Expected date run in opening paragraph");
  assert.ok(dateRun.getElementsByTagNameNS(wordNs, "b").length > 0, "Expected date run to remain bold");

  // Idempotent on second pass.
  formatPagareAutentico(doc);
  assert.equal(doc.getElementsByTagNameNS(wordNs, "tbl").length, 2);

  const witnessTable = children[4];
  assert.equal(witnessTable.localName, "tbl");
  const witnessRows = Array.from(witnessTable.children).filter(el => el.localName === "tr");
  assert.equal(witnessRows.length, 3);
  const witnessNames = Array.from(witnessRows[1].children)
    .filter(el => el.localName === "tc")
    .map(cell => Array.from(cell.getElementsByTagNameNS(wordNs, "t"), n => n.textContent ?? "").join(""));
  assert.deepEqual(witnessNames, ["ADRIÁN LUNA DE PRUEBA", "NICOLÁS SOL DE ENSAYO"]);
});
