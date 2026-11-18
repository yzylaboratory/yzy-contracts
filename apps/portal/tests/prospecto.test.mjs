import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { registerHooks } from "node:module";

process.env.NEXT_PUBLIC_API_URL = "http://127.0.0.1:8080";
process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "synthetic-anon-key";

const root = new URL("../", import.meta.url);
registerHooks({
  resolve(specifier, context, nextResolve) {
    const p = specifier.startsWith("@/") ? new URL(specifier.slice(2), root).href : specifier;
    try {
      return nextResolve(p, context);
    } catch (error) {
      if (error.code !== "ERR_MODULE_NOT_FOUND" || !/^(?:\.|file:)/.test(p)) throw error;
      try {
        return nextResolve(`${p}.ts`, context);
      } catch (err2) {
        if (err2.code !== "ERR_MODULE_NOT_FOUND") throw err2;
        return nextResolve(`${p}.tsx`, context);
      }
    }
  },
});

const {
  isValidProspectToken,
  extractProspectTokenFromHash,
  getPublicApiBase,
  checkProspectLink,
  submitProspectLink,
} = await import("../app/prospecto/prospect-api.ts");

const SYNTHETIC_TOKEN = "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90";

test("isValidProspectToken validates strictly 64 lowercase hex characters", () => {
  assert.equal(isValidProspectToken(SYNTHETIC_TOKEN), true);

  // 63 chars (too short)
  assert.equal(isValidProspectToken(SYNTHETIC_TOKEN.slice(0, 63)), false);

  // 65 chars (too long)
  assert.equal(isValidProspectToken(`${SYNTHETIC_TOKEN}a`), false);

  // Uppercase hex characters are invalid
  assert.equal(isValidProspectToken(SYNTHETIC_TOKEN.toUpperCase()), false);

  // Invalid hex characters
  assert.equal(isValidProspectToken(SYNTHETIC_TOKEN.replace("a", "z")), false);

  // Null, undefined, empty
  assert.equal(isValidProspectToken(null), false);
  assert.equal(isValidProspectToken(undefined), false);
  assert.equal(isValidProspectToken(""), false);
});

test("extractProspectTokenFromHash extracts token from browser URL hash without exposing it", () => {
  assert.equal(extractProspectTokenFromHash(`#${SYNTHETIC_TOKEN}`), SYNTHETIC_TOKEN);
  assert.equal(extractProspectTokenFromHash(SYNTHETIC_TOKEN), SYNTHETIC_TOKEN);
  assert.equal(extractProspectTokenFromHash("#invalid-token"), null);
  assert.equal(extractProspectTokenFromHash(""), null);
});

test("getPublicApiBase resolves runtime API base safely", () => {
  const originalWindow = globalThis.window;
  try {
    globalThis.window = {
      location: {
        hostname: "yzycontracts.yzylabs.dev",
        origin: "https://yzycontracts.yzylabs.dev",
      },
    };
    assert.equal(getPublicApiBase(), "");

    globalThis.window = {
      location: {
        hostname: "yzycontracts.yzylabs.com",
        origin: "https://yzycontracts.yzylabs.com",
      },
    };
    assert.equal(getPublicApiBase(), "http://127.0.0.1:8080");
  } finally {
    if (originalWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = originalWindow;
    }
  }
});

test("checkProspectLink sends POST to /api/v1/public/prospect-links/check with synthetic token", async () => {
  const originalFetch = globalThis.fetch;
  let capturedUrl = "";
  let capturedInit = null;

  try {
    globalThis.fetch = async (url, init) => {
      capturedUrl = String(url);
      capturedInit = init;
      return new Response(null, { status: 204 });
    };

    const result = await checkProspectLink(SYNTHETIC_TOKEN, "000-0000000-0");
    assert.equal(result.kind, "valid");
    assert.match(capturedUrl, /\/api\/v1\/public\/prospect-links\/check$/);
    assert.equal(capturedInit?.method, "POST");
    assert.equal(capturedInit?.referrerPolicy, "no-referrer");
    assert.deepEqual(JSON.parse(capturedInit?.body), { token: SYNTHETIC_TOKEN, identity: "000-0000000-0" });

    // Test 404 not available
    globalThis.fetch = async () => new Response(null, { status: 404 });
    const notFoundResult = await checkProspectLink(SYNTHETIC_TOKEN, "000-0000000-0");
    assert.equal(notFoundResult.kind, "not_found");

    // Test network error
    globalThis.fetch = async () => {
      throw new Error("Network offline");
    };
    const networkErrorResult = await checkProspectLink(SYNTHETIC_TOKEN, "000-0000000-0");
    assert.equal(networkErrorResult.kind, "network_error");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("submitProspectLink sends required fields and converts empty optional fields to null without financial data", async () => {
  const originalFetch = globalThis.fetch;
  let capturedUrl = "";
  let capturedInit = null;

  try {
    globalThis.fetch = async (url, init) => {
      capturedUrl = String(url);
      capturedInit = init;
      return new Response(null, { status: 204 });
    };

    const syntheticData = {
      name: "Persona Sintetica",
      identity: "000-0000000-0",
      phone: "809-555-0000",
      address: "Calle Sintetica 123",
      email: "",
      nationality: "Dominicana",
      marital_status: "",
      position: null,
      income_source: "Empleado privado",
      profile: {
        treatment: "Sr.",
        owns_home: true,
        owns_vehicle: false,
        employer: "Empresa Ejemplo",
        work_address: "Av. Principal 45",
        work_phone: "809-555-1111",
        position: "Analista",
        employment_duration: "3 años",
        fixed_income: "RD$50,000.00",
        other_income: "RD$0.00",
        other_income_source: "No aplica",
        pay_days: "Quincenal",
        spouse_not_applicable: true,
        family_references: [
          { name: "Fam 1", relationship: "HERMANO/A", phone: "809-555-2221", address: "Calle 1" },
          { name: "Fam 2", relationship: "MADRE", phone: "809-555-2222", address: "Calle 2" },
          { name: "Fam 3", relationship: "PADRE", phone: "809-555-2223", address: "Calle 3" },
        ],
        personal_references: [
          { name: "Ref 1", relationship: "AMIGO/A", phone: "809-555-3331" },
          { name: "Ref 2", relationship: "COMPAÑERO/A DE TRABAJO", phone: "809-555-3332" },
        ],
      },
    };

    const result = await submitProspectLink(SYNTHETIC_TOKEN, syntheticData);
    assert.equal(result.kind, "success");
    assert.match(capturedUrl, /\/api\/v1\/public\/prospect-links\/submit$/);
    assert.equal(capturedInit?.method, "POST");
    assert.equal(capturedInit?.referrerPolicy, "no-referrer");

    const parsedBody = JSON.parse(capturedInit?.body);
    assert.equal(parsedBody.token, SYNTHETIC_TOKEN);
    assert.equal(parsedBody.name, "Persona Sintetica");
    assert.equal(parsedBody.identity, "000-0000000-0");
    assert.equal(parsedBody.phone, "809-555-0000");
    assert.equal(parsedBody.address, "Calle Sintetica 123");
    assert.equal(parsedBody.nationality, "Dominicana");
    assert.equal(parsedBody.email, null);
    assert.equal(parsedBody.marital_status, null);
    assert.equal(parsedBody.position, "Analista");
    assert.equal(parsedBody.income_source, "Empleado privado");
    assert.equal(parsedBody.profile.owns_home, true);
    assert.equal(parsedBody.profile.rents_home, false);
    assert.equal(parsedBody.profile.family_references.length, 3);
    assert.equal(parsedBody.profile.personal_references.length, 2);

    // Verify absolutely no loan calculation or requested amount keys exist
    const rootKeys = Object.keys(parsedBody);
    for (const key of rootKeys) {
      assert.doesNotMatch(key, /requested_amount|application_date|case_|loan_calculation/i);
    }
    const profileKeys = Object.keys(parsedBody.profile);
    for (const key of profileKeys) {
      assert.doesNotMatch(key, /requested_amount|application_date|case_|loan_calculation/i);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("instrumentation-client excludes /prospecto from Sentry Replay", () => {
  const instrumentationPath = path.resolve(import.meta.dirname, "../instrumentation-client.ts");
  const content = fs.readFileSync(instrumentationPath, "utf-8");

  assert.equal(
    content.includes('!/^\\/(?:auth|login|preacceso|prospecto)(?:\\/|$)/.test(pathname)'),
    true,
    "canRecordPage must exclude prospecto from Sentry Replay recording",
  );
});

test("prospecto code does not leak PII or tokens to storage or console", () => {
  const prospectDir = path.resolve(import.meta.dirname, "../app/prospecto");
  const files = fs.readdirSync(prospectDir);

  for (const file of files) {
    if (!file.endsWith(".ts") && !file.endsWith(".tsx")) continue;
    const content = fs.readFileSync(path.join(prospectDir, file), "utf-8");

    assert.equal(
      content.includes("localStorage"),
      false,
      `File ${file} should not use localStorage for prospect data`,
    );
    assert.equal(
      content.includes("sessionStorage"),
      false,
      `File ${file} should not use sessionStorage for prospect data`,
    );
    assert.equal(
      content.includes("document.cookie"),
      false,
      `File ${file} should not use document.cookie for prospect data`,
    );
    assert.doesNotMatch(
      content,
      /console\.(?:log|info|debug|warn|error)\([^)]*(?:token|name|identity|phone|address|email)/,
      `File ${file} should not log prospect token or PII to console`,
    );
  }
});

test("prospect payload completely satisfies missingLoanClientFields", async () => {
  const { missingLoanClientFields } = await import("../app/clientes/loan-application-fields.ts");
  const { sanitizeProspectProfile } = await import("../app/prospecto/prospect-api.ts");

  const completedProspect = {
    name: "Juan Pérez Santana",
    identity: "001-1234567-8",
    phone: "809-555-1234",
    address: "Calle 1ra #24, Gazcue, Santo Domingo",
    email: "juan.perez@example.com",
    treatment: "Sr.",
    nationality: "Dominicana",
    marital_status: "Soltero(a)",
    position: "Analista de Operaciones",
    income_source: "Empleado privado",
    profile: sanitizeProspectProfile({
      treatment: "Sr.",
      nationality: "Dominicana",
      marital_status: "Soltero(a)",
      owns_home: true,
      owns_vehicle: false,
      employer: "Empresa Dominicana S.A.",
      work_address: "Av. 27 de Febrero #100",
      work_phone: "809-555-9876",
      position: "Analista de Operaciones",
      employment_duration: "3 años",
      fixed_income: "RD$65,000.00",
      other_income: "RD$0.00",
      other_income_source: "No aplica",
      pay_days: "Quincenal (15 y 30)",
      spouse_not_applicable: true,
      family_references: [
        { name: "Pedro Pérez", relationship: "HERMANO/A", phone: "809-555-1111", address: "Calle Central 10" },
        { name: "Ana Santana", relationship: "MADRE", phone: "809-555-2222", address: "Calle Sol 15" },
        { name: "Carlos Pérez", relationship: "PADRE", phone: "809-555-3333", address: "Calle Sol 15" },
      ],
      personal_references: [
        { name: "Luis Gómez", relationship: "AMIGO/A", phone: "809-555-4444" },
        { name: "Rosa Martínez", relationship: "COMPAÑERO/A DE TRABAJO", phone: "809-555-5555" },
      ],
    }),
  };

  const clientLike = {
    name: completedProspect.name,
    identity: completedProspect.identity,
    phone: completedProspect.phone,
    address: completedProspect.address,
    email: completedProspect.email,
    income_source: completedProspect.income_source,
    profile: completedProspect.profile,
  };

  const missing = missingLoanClientFields(clientLike);
  assert.deepEqual(missing, [], `Expected 0 missing fields, but found: ${missing.join(", ")}`);
});
