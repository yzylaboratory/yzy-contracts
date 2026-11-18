// Resolves the portal's TypeScript import conventions for Node: the "@/" alias
// and extensionless relative specifiers. Read-only over apps/portal.
import { existsSync, statSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join, dirname } from "node:path";

const portalRoot = fileURLToPath(new URL("../../../apps/portal/", import.meta.url));
const extensions = [".ts", ".tsx", ".mjs", ".js", "/index.ts", "/index.tsx"];

function withExtension(base) {
  if (existsSync(base) && statSync(base).isFile()) return base;
  for (const extension of extensions) {
    if (existsSync(base + extension) && statSync(base + extension).isFile()) return base + extension;
  }
  return undefined;
}

const referenceShim = new URL("./reference-word-shim.mjs", import.meta.url).href;

export async function resolve(specifier, context, next) {
  if (specifier === "./reference-word" && context.parentURL?.endsWith("/app/contratos/native-document.ts")) {
    return next(referenceShim, context);
  }
  if (specifier.startsWith("@/")) {
    const resolved = withExtension(join(portalRoot, specifier.slice(2)));
    if (resolved) return next(pathToFileURL(resolved).href, context);
  }
  if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL?.startsWith("file://")) {
    const parent = fileURLToPath(context.parentURL);
    if (parent.startsWith(portalRoot) && !/\.[cm]?[jt]sx?$/.test(specifier)) {
      const resolved = withExtension(join(dirname(parent), specifier));
      if (resolved) return next(pathToFileURL(resolved).href, context);
    }
  }
  return next(specifier, context);
}
