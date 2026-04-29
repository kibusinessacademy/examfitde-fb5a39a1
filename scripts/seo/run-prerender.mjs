/**
 * SEO Prerender Runner
 * --------------------------------------------------------------
 * Loads the TS-SSOT (src/content/seoRoutes.ts) and runs the prerender script.
 * Invoked as a Node 22 subprocess by the Vite plugin in vite.config.ts so that
 * the main Vite build runner does not need a TS loader.
 *
 * Usage (must be Node >= 22, started with --experimental-strip-types):
 *   node --experimental-strip-types scripts/seo/run-prerender.mjs
 */

import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const major = Number(process.versions.node.split(".")[0]);
if (Number.isFinite(major) && major < 22) {
  console.error(
    `[seo-prerender-runner] Node ${process.versions.node} too old; need >= 22.`,
  );
  process.exit(2);
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const ssotUrl = pathToFileURL(
  resolve(__dirname, "../../src/content/seoRoutes.ts"),
).href;
const prerenderUrl = pathToFileURL(resolve(__dirname, "./prerender.mjs")).href;

const ssot = await import(ssotUrl);
const { runSeoPrerender } = await import(prerenderUrl);

if (!Array.isArray(ssot.seoRoutes)) {
  console.error("[seo-prerender-runner] seoRoutes export missing");
  process.exit(2);
}

globalThis.__SEO_ROUTES__ = ssot.seoRoutes;

await runSeoPrerender();
