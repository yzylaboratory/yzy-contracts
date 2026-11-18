import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { registerHooks } from "node:module";

process.env.NEXT_PUBLIC_API_URL = "http://127.0.0.1:8080";
process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "synthetic-key";

const root = new URL("../", import.meta.url);
registerHooks({
  resolve(specifier, context, nextResolve) {
    const p = specifier.startsWith("@/") ? new URL(specifier.slice(2), root).href : specifier;
    try {
      return nextResolve(p, context);
    } catch (error) {
      if (error.code !== "ERR_MODULE_NOT_FOUND" || !/^(?:\.|file:)/.test(p)) throw error;
      return nextResolve(`${p}.ts`, context);
    }
  },
});

const { getApiBaseUrl } = await import("../lib/api.ts");
const { resolveSiteUrl } = await import("../lib/site-url.ts");

test("getApiBaseUrl returns same-origin empty string on dev hostname yzycontracts.yzylabs.dev", () => {
  const originalWindow = globalThis.window;
  try {
    globalThis.window = {
      location: {
        hostname: "yzycontracts.yzylabs.dev",
        origin: "https://yzycontracts.yzylabs.dev",
      },
    };

    assert.equal(getApiBaseUrl(), "");
  } finally {
    if (originalWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = originalWindow;
    }
  }
});

test("getApiBaseUrl returns configured NEXT_PUBLIC_API_URL on prod and other hostnames", () => {
  const originalWindow = globalThis.window;
  const originalEnv = process.env.NEXT_PUBLIC_API_URL;
  try {
    process.env.NEXT_PUBLIC_API_URL = "https://contracts-api.yzylabs.com";

    globalThis.window = {
      location: {
        hostname: "yzycontracts.yzylabs.com",
        origin: "https://yzycontracts.yzylabs.com",
      },
    };
    assert.equal(getApiBaseUrl(), "https://contracts-api.yzylabs.com");

    globalThis.window = {
      location: {
        hostname: "localhost",
        origin: "http://localhost:3000",
      },
    };
    assert.equal(getApiBaseUrl(), "https://contracts-api.yzylabs.com");
  } finally {
    process.env.NEXT_PUBLIC_API_URL = originalEnv;
    if (originalWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = originalWindow;
    }
  }
});

test("getApiBaseUrl server-side prefers API_URL over NEXT_PUBLIC_API_URL", () => {
  const originalWindow = globalThis.window;
  const originalApiUrl = process.env.API_URL;
  const originalNextPublic = process.env.NEXT_PUBLIC_API_URL;
  try {
    delete globalThis.window;
    process.env.API_URL = "http://api:8080";
    process.env.NEXT_PUBLIC_API_URL = "https://contracts-api.yzylabs.com";

    assert.equal(getApiBaseUrl(), "http://api:8080");

    delete process.env.API_URL;
    assert.equal(getApiBaseUrl(), "https://contracts-api.yzylabs.com");
  } finally {
    process.env.API_URL = originalApiUrl;
    process.env.NEXT_PUBLIC_API_URL = originalNextPublic;
    if (originalWindow !== undefined) {
      globalThis.window = originalWindow;
    }
  }
});

test("resolveSiteUrl reads runtime SITE_URL and falls back to NEXT_PUBLIC_SITE_URL", () => {
  const originalSiteUrl = process.env.SITE_URL;
  const originalNextPublic = process.env.NEXT_PUBLIC_SITE_URL;
  try {
    process.env.SITE_URL = "https://yzycontracts.yzylabs.dev";
    process.env.NEXT_PUBLIC_SITE_URL = "https://yzycontracts.yzylabs.com";
    assert.equal(resolveSiteUrl(), "https://yzycontracts.yzylabs.dev");

    delete process.env.SITE_URL;
    assert.equal(resolveSiteUrl(), "https://yzycontracts.yzylabs.com");

    delete process.env.NEXT_PUBLIC_SITE_URL;
    assert.equal(resolveSiteUrl(), undefined);
  } finally {
    process.env.SITE_URL = originalSiteUrl;
    process.env.NEXT_PUBLIC_SITE_URL = originalNextPublic;
  }
});

test("sign-in component does not include password authentication or DevelopmentSignIn", () => {
  const filePath = path.resolve(import.meta.dirname, "../components/arc/blocks/sign-in/sign-in.tsx");
  const content = fs.readFileSync(filePath, "utf-8");

  assert.equal(content.includes("DevelopmentSignIn"), false, "DevelopmentSignIn should be removed");
  assert.equal(content.includes("signInWithPassword"), false, "signInWithPassword should be removed");
  assert.equal(content.includes('provider: "google"'), true, "Google OAuth should remain present");
  assert.equal(content.includes("${window.location.origin}/auth/callback"), true, "OAuth callback should use current window origin");
});

test("instrumentation-client sets Sentry environment to development on dev hostname", () => {
  const filePath = path.resolve(import.meta.dirname, "../instrumentation-client.ts");
  const content = fs.readFileSync(filePath, "utf-8");

  assert.equal(content.includes('window.location.hostname === "yzycontracts.yzylabs.dev"'), true);
  assert.equal(content.includes('"development"'), true);
});
