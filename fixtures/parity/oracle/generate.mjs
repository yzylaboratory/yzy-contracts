// Runs the portal's fillOriginalWord (apps/portal, read-only) on each synthetic case and
// writes the exact XML it produces. The Rust suite compares its output against these files.
// Synthetic placeholders below only satisfy the portal's module-level env checks.
process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://127.0.0.1:1";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "synthetic-anon-key";
process.env.NEXT_PUBLIC_API_URL ??= "http://127.0.0.1:1";

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readdirSync } from "node:fs";

const here = dirname(fileURLToPath(import.meta.url));
const parityRoot = join(here, "..");
const repoRoot = join(here, "../../..");
const portalNodeModules = join(repoRoot, "apps/portal/node_modules");
const pnpmStore = join(repoRoot, "node_modules/.pnpm");
const jsdomDir = readdirSync(pnpmStore).find(name => /^jsdom@26\./.test(name));
if (!jsdomDir) throw new Error("jsdom 26 not found in the pnpm store");
const requireFromPortal = createRequire(join(portalNodeModules, "x.js"));
const { JSDOM } = requireFromPortal(join(pnpmStore, jsdomDir, "node_modules/jsdom"));
const { window } = new JSDOM("");
globalThis.DOMParser = window.DOMParser;
globalThis.XMLSerializer = window.XMLSerializer;

const { fillOriginalWord, NativeDocumentError } = await import("/Users/randydominguez/Developer/yzy-contracts/apps/portal/app/contratos/native-document.ts");

const cases = JSON.parse(readFileSync(join(parityRoot, "cases.json"), "utf8"));
mkdirSync(join(parityRoot, "expected"), { recursive: true });
const { unzipSync } = requireFromPortal("fflate");

for (const testCase of cases) {
  const original = new Blob([readFileSync(join(parityRoot, testCase.docx))]);
  try {
    const result = await fillOriginalWord(
      original, "", testCase.fields, testCase.values, testCase.variables,
      testCase.allowIncomplete, testCase.conditionalSale ?? undefined, testCase.uppercase,
      testCase.boldPagareDate, testCase.vehicle ?? undefined, testCase.company ?? undefined,
    );
    const files = unzipSync(new Uint8Array(await result.arrayBuffer()));
    const compared = /^(word\/(document|header\d+|footer\d+|footnotes|endnotes|fontTable)|docProps\/(app|custom))\.xml$/;
    for (const part of Object.keys(files).filter(name => compared.test(name))) {
      const out = join(parityRoot, "expected", testCase.name, part);
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, Buffer.from(files[part]));
    }
    console.log(`${testCase.name}: ok`);
  } catch (error) {
    if (error instanceof NativeDocumentError && testCase.expectError) {
      writeFileSync(join(parityRoot, "expected", `${testCase.name}.error`), error.message + "\n");
      console.log(`${testCase.name}: rejected as expected (${error.message})`);
    } else {
      console.log(`${testCase.name}: ERROR ${error?.message ?? error}`);
      process.exitCode = 1;
    }
  }
}
