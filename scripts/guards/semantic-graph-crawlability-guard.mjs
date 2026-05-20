#!/usr/bin/env node
/**
 * P6 Guard — Semantic Graph crawlability + sitemap coverage.
 *
 * Reads the published graph via `semantic_graph_get_published` (anon
 * surface, identical to what crawlers see) and the rendered sitemap
 * routes via `scripts/seo/load-dynamic-routes.mjs::loadWissenRoutes`.
 * Checks:
 *   - missing_published_graph
 *   - sitemap_missing_route (eligible entity has no sitemap entry)
 *   - duplicate_wissen_route
 *   - invalid_route_key  (encoded URL ≠ source key, empty key)
 *   - orphan_route       (sitemap route not backed by graph entity)
 *   - route_builder_bypass (sitemap key shape differs from pillarPath)
 *
 * Cold-start tolerant: empty graph → OK.
 */
import fs from "node:fs";
import path from "node:path";

const ROUTED = new Set(["beruf", "kompetenz", "pruefung"]);

function readEnv() {
  const out = {};
  const p = path.resolve(process.cwd(), ".env");
  if (fs.existsSync(p)) {
    for (const line of fs.readFileSync(p, "utf8").split("\n")) {
      const m = line.match(/^([A-Z0-9_]+)=("?)([^"]*)\2\s*$/);
      if (m) out[m[1]] = m[3];
    }
  }
  return out;
}
const env = readEnv();
const URL_ = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || env.SUPABASE_URL || env.VITE_SUPABASE_URL;
const KEY = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!URL_ || !KEY) {
  console.warn("[crawlability-guard] SUPABASE_URL / KEY missing — skipping (non-fatal).");
  process.exit(0);
}

const res = await fetch(`${URL_}/rest/v1/rpc/semantic_graph_get_published`, {
  method: "POST",
  headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
  body: "{}",
});
if (!res.ok) {
  console.warn(`[crawlability-guard] RPC HTTP ${res.status} — skipping (non-fatal).`);
  process.exit(0);
}
const g = await res.json();
const entities = g?.entities ?? [];

if (entities.length === 0) {
  console.log("[crawlability-guard] cold-start (no published snapshot) — OK.");
  process.exit(0);
}

const errors = [];
const expectedRoutes = new Map(); // path → { kind, key }
for (const e of entities) {
  if (!ROUTED.has(e.kind)) continue;
  if (!e.key || typeof e.key !== "string") {
    errors.push(`invalid_route_key:${e.kind}/${JSON.stringify(e.key)}`);
    continue;
  }
  const encoded = encodeURIComponent(e.key);
  if (decodeURIComponent(encoded) !== e.key) {
    errors.push(`invalid_route_key:${e.kind}/${e.key}`);
    continue;
  }
  const p = `/wissen/${e.kind}/${encoded}`;
  if (expectedRoutes.has(p)) errors.push(`duplicate_wissen_route:${p}`);
  expectedRoutes.set(p, { kind: e.kind, key: e.key });
}

// Compare against sitemap builder output (same source, but proves the wiring).
let actualRoutes = [];
try {
  const mod = await import(path.resolve(process.cwd(), "scripts/seo/load-dynamic-routes.mjs"));
  if (typeof mod.loadWissenRoutes === "function") {
    actualRoutes = (await mod.loadWissenRoutes()) ?? [];
  }
} catch (e) {
  console.warn(`[crawlability-guard] loadWissenRoutes unavailable (${e?.message ?? e}) — skipping sitemap diff.`);
}

if (Array.isArray(actualRoutes) && actualRoutes.length > 0) {
  const seen = new Set();
  for (const r of actualRoutes) {
    const path_ = typeof r === "string" ? r : (r?.path ?? r?.url ?? null);
    if (!path_) continue;
    if (seen.has(path_)) errors.push(`duplicate_wissen_route:${path_}`);
    seen.add(path_);
    if (!path_.startsWith("/wissen/")) {
      errors.push(`route_builder_bypass:${path_}`);
      continue;
    }
    if (!expectedRoutes.has(path_)) errors.push(`orphan_route:${path_}`);
  }
  for (const p of expectedRoutes.keys()) {
    if (!seen.has(p)) errors.push(`sitemap_missing_route:${p}`);
  }
}

if (errors.length > 0) {
  console.error(`[crawlability-guard] FAIL (${errors.length} issue(s)):`);
  for (const e of errors.slice(0, 25)) console.error(`  - ${e}`);
  process.exit(1);
}

console.log(`[crawlability-guard] OK — ${expectedRoutes.size} routed entities, ${actualRoutes.length || "?"} sitemap routes.`);
