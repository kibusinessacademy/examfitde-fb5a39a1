#!/usr/bin/env node
/**
 * Guard: Pillar/Satellite routes — anti-orphan + no hand-written SEO copy.
 *
 *  1. Every routed entity kind (ROUTED_ENTITY_KINDS) MUST have a route
 *     mounted in `src/routes/AppRoutes.tsx` and a backing page under
 *     `src/pages/wissen/`.
 *  2. UI code MUST NOT hand-write `/wissen/(beruf|kompetenz|pruefung)/...`
 *     paths — they must come from `pillarPath()` / `pillarPathByKind()`.
 *  3. The Pillar page must import JSON-LD via `@/lib/seo/schema`
 *     (P3 SSOT), grounded chunks via `@/lib/llm-grounding` (P2 SSOT),
 *     and the graph via `@/lib/semantic` (P1 SSOT).
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();

const ROUTED = ["beruf", "kompetenz", "pruefung"];
const APP_ROUTES = join(ROOT, "src/routes/AppRoutes.tsx");
const PILLAR_PAGE = join(ROOT, "src/pages/wissen/EntityPillarPage.tsx");
const PAGE_FILES = ROUTED.map((k) => join(ROOT, `src/pages/wissen/Wissen${cap(k)}Page.tsx`));

function cap(s) { return s[0].toUpperCase() + s.slice(1); }

const errors = [];

// (1) Routes mounted
if (!existsSync(APP_ROUTES)) {
  errors.push("src/routes/AppRoutes.tsx missing");
} else {
  const src = readFileSync(APP_ROUTES, "utf8");
  for (const k of ROUTED) {
    if (!src.includes(`/wissen/${k}/:key`)) {
      errors.push(`Route '/wissen/${k}/:key' not mounted in AppRoutes.tsx`);
    }
  }
}

// (1b) Backing page files exist
for (const f of [PILLAR_PAGE, ...PAGE_FILES]) {
  if (!existsSync(f)) errors.push(`Missing pillar page: ${relative(ROOT, f)}`);
}

// (1c) SSOT imports present in EntityPillarPage
if (existsSync(PILLAR_PAGE)) {
  const src = readFileSync(PILLAR_PAGE, "utf8");
  for (const mod of ["@/lib/semantic", "@/lib/llm-grounding", "@/lib/seo/schema"]) {
    if (!src.includes(`from "${mod}"`) && !src.includes(`from '${mod}'`)) {
      errors.push(`EntityPillarPage missing import from ${mod}`);
    }
  }
}

// (2) No hand-written /wissen/<routed>/... paths outside SSOT
const HANDROLL = new RegExp(`['"\`]/wissen/(${ROUTED.join("|")})/`);
const ALLOW = new Set([
  "src/lib/semantic/pillarRoutes.ts",
  "src/lib/semantic/pillarSitemap.ts",
  "src/routes/AppRoutes.tsx",
  "scripts/guards/pillar-routes-orphan-guard.mjs",
]);
function walk(dir, out = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const e of entries) {
    const p = join(dir, e);
    let s; try { s = statSync(p); } catch { continue; }
    if (s.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(e)) out.push(p);
  }
  return out;
}
for (const f of walk(join(ROOT, "src"))) {
  const rel = relative(ROOT, f).replace(/\\/g, "/");
  if (ALLOW.has(rel)) continue;
  if (rel.includes("/__tests__/") || rel.endsWith(".test.ts") || rel.endsWith(".test.tsx")) continue;
  const src = readFileSync(f, "utf8");
  if (HANDROLL.test(src)) {
    errors.push(`Hand-written /wissen/<routed>/ path in ${rel} — use pillarPath() from @/lib/semantic`);
  }
}

if (errors.length) {
  console.error("✗ pillar-routes-orphan-guard failed:");
  for (const e of errors) console.error("  - " + e);
  process.exit(1);
}
console.log("✓ pillar-routes-orphan-guard: clean");
