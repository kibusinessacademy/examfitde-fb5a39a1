#!/usr/bin/env node
/**
 * Vercel Prerender Rewrites Parity Guard
 * ──────────────────────────────────────────────────────────────
 * P0.2 root-cause fix (2026-06-05):
 *
 * Vercel's `cleanUrls: true` filesystem lookup did NOT win against the
 * catch-all SPA rewrite `/(.*) → /index.html` for the per-route prerendered
 * files in `dist/<path>/index.html`. Live cold-loads of `/berufe`, `/preise`,
 * `/berufe/:slug` returned the homepage HTML — Reality-Gate saw:
 *   - links=0 on /berufe
 *   - hasPrice=false on /preise
 *   - body=0 chars on multiple /berufe/:slug
 *
 * Fix: explicit `rewrites` in `vercel.json` for every prerendered route
 * BEFORE the catch-all, mapping `/<path>` → `/<path>/index.html`. This guard
 * enforces parity between `src/content/seoRoutes.ts` (SSOT) and `vercel.json`:
 *
 *   - Every LIVE route in the SSOT (incl. berufDetail() slugs) MUST appear
 *     as an explicit rewrite in vercel.json.
 *   - The catch-all `/(.*) → /index.html` MUST be the LAST rewrite.
 *
 * Fails CI with exit code 2 if drift is detected. Add new prerendered routes
 * to BOTH places or the build is rejected.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(fileURLToPath(import.meta.url), "../../..");
const VERCEL_JSON = path.join(ROOT, "vercel.json");
const SSOT_PATH = path.join(ROOT, "src/content/seoRoutes.ts");

const violations = [];

// 1. Load vercel.json
const vercel = JSON.parse(fs.readFileSync(VERCEL_JSON, "utf8"));
const rewrites = Array.isArray(vercel.rewrites) ? vercel.rewrites : [];

// 2. Catch-all MUST be last
const last = rewrites[rewrites.length - 1];
if (!last || last.source !== "/(.*)" || last.destination !== "/index.html") {
  violations.push(
    `vercel.json: last rewrite must be { source: "/(.*)", destination: "/index.html" }, got ${JSON.stringify(last)}`,
  );
}

// 3. Extract explicit prerender rewrites (source startsWith /, destination ends with /index.html)
const prerenderRewrites = new Set(
  rewrites
    .filter(
      (r) =>
        typeof r.source === "string" &&
        typeof r.destination === "string" &&
        r.destination.endsWith("/index.html") &&
        !r.source.includes("("),
    )
    .map((r) => r.source),
);

// 4. Parse SSOT for live route paths (lightweight regex parse — avoids TS runtime)
const ssotSrc = fs.readFileSync(SSOT_PATH, "utf8");
const ssotPaths = new Set();

// 4a. Literal paths: `path: "/foo"`
for (const m of ssotSrc.matchAll(/path:\s*"(\/[^"]+)"/g)) {
  ssotPaths.add(m[1]);
}
// 4b. berufDetail() invocations: berufDetail("slug", ...) → /berufe/<slug>
for (const m of ssotSrc.matchAll(/berufDetail\("([^"]+)"/g)) {
  ssotPaths.add(`/berufe/${m[1]}`);
}

// 5. Cross-check: every SSOT path must have an explicit rewrite
for (const p of ssotPaths) {
  if (!prerenderRewrites.has(p)) {
    violations.push(
      `vercel.json: missing explicit rewrite for prerendered route "${p}" → "${p}/index.html". Without it, the SPA catch-all hijacks the cold-load and serves the homepage.`,
    );
  }
}

// 6. Reverse: warn about stale rewrites pointing to routes no longer in SSOT
for (const r of prerenderRewrites) {
  if (!ssotPaths.has(r)) {
    violations.push(
      `vercel.json: stale rewrite "${r}" → "${r}/index.html" — no matching route in src/content/seoRoutes.ts. Remove or align SSOT.`,
    );
  }
}

if (violations.length > 0) {
  console.error(
    `\n❌ vercel-prerender-rewrites-parity: ${violations.length} violation(s)\n`,
  );
  for (const v of violations) console.error(`  • ${v}`);
  console.error(
    `\nFix by adding (or removing) explicit rewrites in vercel.json above the SPA catch-all.\n`,
  );
  process.exit(2);
}

console.log(
  `✅ vercel-prerender-rewrites-parity: ${ssotPaths.size} prerendered routes covered (catch-all last).`,
);
