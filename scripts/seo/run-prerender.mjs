/**
 * SEO Prerender Runner
 * --------------------------------------------------------------
 * Loads the TS-SSOT (src/content/seoRoutes.ts) and runs the prerender script.
 * Invoked as a Node subprocess by the Vite plugin in vite.config.ts.
 *
 * IMPORTANT: This file MUST work on any Node version Vercel actually
 * provisions (currently 20.x / 22.x). DO NOT rely on
 * --experimental-strip-types or other Node-24-only flags — Vercel does
 * not ship Node 24 yet and silently falls back to 22, which made earlier
 * versions of this runner no-op without failing the build (see
 * mem://architektur/seo/production-architecture-v2-vercel-prerender-llm-visibility).
 *
 * We use esbuild (already in the dep tree via Vite) to transpile the TS
 * SSOT to ESM in-memory, then load it via a data: URL.
 *
 * Usage:
 *   node scripts/seo/run-prerender.mjs
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const major = Number(process.versions.node.split(".")[0]);
if (Number.isFinite(major) && major < 18) {
  console.error(
    `[seo-prerender-runner] Node ${process.versions.node} too old; need >= 18.`,
  );
  process.exit(2);
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const ssotPath = resolve(__dirname, "../../src/content/seoRoutes.ts");
const prerenderUrl = pathToFileURL(resolve(__dirname, "./prerender.mjs")).href;

console.log(
  `[seo-prerender-runner] Node ${process.versions.node}, cwd=${process.cwd()}`,
);
console.log(`[seo-prerender-runner] Loading SSOT: ${ssotPath}`);

// Load + transpile TS SSOT via esbuild → ESM data URL.
let ssot;
try {
  const esbuild = await import("esbuild");
  const tsSource = readFileSync(ssotPath, "utf8");
  const { code } = await esbuild.transform(tsSource, {
    loader: "ts",
    format: "esm",
    target: "es2022",
    sourcefile: ssotPath,
  });
  const dataUrl =
    "data:text/javascript;base64," + Buffer.from(code, "utf8").toString("base64");
  ssot = await import(dataUrl);
} catch (e) {
  console.error(
    "[seo-prerender-runner] FATAL: could not load SSOT via esbuild:",
    e && e.message ? e.message : e,
  );
  process.exit(2);
}

if (!Array.isArray(ssot.seoRoutes)) {
  console.error(
    "[seo-prerender-runner] FATAL: seoRoutes export missing or not an array",
  );
  process.exit(2);
}

console.log(
  `[seo-prerender-runner] SSOT loaded: ${ssot.seoRoutes.length} routes`,
);

globalThis.__SEO_ROUTES__ = ssot.seoRoutes;

const { runSeoPrerender } = await import(prerenderUrl);
await runSeoPrerender();

console.log("[seo-prerender-runner] DONE");
