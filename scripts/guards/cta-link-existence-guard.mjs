#!/usr/bin/env node
/**
 * cta-link-existence-guard
 *
 * Static CI guard: scans the source tree for every internal link literal
 * (`to="/…"` and `href="/…"`) and fails the build when:
 *
 *   1. Any CTA still points to `/bundle/*` (hard ban — Vercel 404 class).
 *   2. Any internal target does not resolve to a registered SPA route in
 *      `src/lib/route-registry.ts`.
 *
 * Mirrors src/__tests__/cta-routes-no-bundle.test.tsx but runs without
 * the vitest harness so it can be wired into CI guard fan-out.
 *
 * Usage:
 *   node scripts/guards/cta-link-existence-guard.mjs
 *   node scripts/guards/cta-link-existence-guard.mjs --json
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = process.cwd();
const SRC = join(ROOT, "src");
const REGISTRY = join(SRC, "lib", "route-registry.ts");

const SCAN_EXTS = new Set([".tsx", ".ts", ".jsx", ".js"]);
const SKIP_DIRS = new Set(["node_modules", "__tests__", "test", "tests", "integrations"]);
const ALLOW_BUNDLE_LITERAL = [
  /[\\/]src[\\/]lib[\\/]route-registry\.ts$/,
  /[\\/]src[\\/]components[\\/]cta[\\/]SafeCta\.tsx$/,
  /[\\/]src[\\/]__tests__[\\/]cta-routes-no-bundle\.test\.tsx$/,
  /BundleToPaketRedirect/,
  /LegacyProductRedirect/,
  /AppRoutes\.tsx$/,
];

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (SKIP_DIRS.has(entry)) continue;
      walk(p, out);
    } else if (SCAN_EXTS.has(p.slice(p.lastIndexOf(".")))) {
      out.push(p);
    }
  }
  return out;
}

/** Extract ROUTE_PATTERNS string array from the TS registry without TS runtime. */
function loadPatterns() {
  const src = readFileSync(REGISTRY, "utf8");
  const start = src.indexOf("ROUTE_PATTERNS");
  const open = src.indexOf("[", start);
  const close = src.indexOf("];", open);
  if (start < 0 || open < 0 || close < 0) {
    throw new Error("Cannot locate ROUTE_PATTERNS in route-registry.ts");
  }
  const block = src.slice(open + 1, close);
  const patterns = [...block.matchAll(/["']([^"']+)["']/g)].map((m) => m[1]);
  if (!patterns.length) throw new Error("ROUTE_PATTERNS appears empty");
  return patterns;
}

function compilePattern(pattern) {
  const escaped = pattern
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\/\\\*$/, "(?:/.*)?")
    .replace(/:[A-Za-z0-9_]+/g, "[^/]+");
  return new RegExp(`^${escaped}/?$`);
}

const PATTERNS = loadPatterns();
const COMPILED = PATTERNS.map((p) => ({ p, rx: compilePattern(p) }));

function isKnownRoute(path) {
  if (!path) return false;
  if (/^(https?:|mailto:|tel:|#)/i.test(path)) return true;
  const pathname = path.split("?")[0].split("#")[0];
  if (!pathname.startsWith("/")) return false;
  return COMPILED.some(({ rx }) => rx.test(pathname));
}

const LINK_RX = /(?:^|[\s{(,])(?:to|href)\s*=\s*["']\s*(\/[A-Za-z0-9\-_/]*)\s*["']/g;

function collect() {
  const hits = [];
  for (const file of walk(SRC)) {
    const src = readFileSync(file, "utf8");
    LINK_RX.lastIndex = 0;
    let m;
    while ((m = LINK_RX.exec(src)) !== null) {
      hits.push({ file: relative(ROOT, file), target: m[1] });
    }
  }
  return hits;
}

function main() {
  const json = process.argv.includes("--json");
  const hits = collect();

  const bundleHits = hits.filter(
    (h) =>
      (h.target === "/bundle" || h.target.startsWith("/bundle/")) &&
      !ALLOW_BUNDLE_LITERAL.some((rx) => rx.test(h.file)),
  );
  const deadHits = hits.filter((h) => !isKnownRoute(h.target));

  const result = {
    scanned_files: walk(SRC).length,
    cta_links: hits.length,
    forbidden_bundle: bundleHits,
    unknown_routes: deadHits,
    ok: bundleHits.length === 0 && deadHits.length === 0,
  };

  if (json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } else {
    console.log(
      `[cta-link-existence-guard] scanned ${result.scanned_files} files, ${result.cta_links} CTA links`,
    );
    if (bundleHits.length) {
      console.error(`\n❌ ${bundleHits.length} forbidden /bundle/* CTA targets:`);
      for (const h of bundleHits) console.error(`   ${h.file} → ${h.target}`);
    }
    if (deadHits.length) {
      console.error(`\n❌ ${deadHits.length} CTA targets pointing to unregistered routes:`);
      for (const h of deadHits) console.error(`   ${h.file} → ${h.target}`);
    }
    if (result.ok) {
      console.log("✅ All CTA links resolve to registered SPA routes.");
    }
  }
  process.exit(result.ok ? 0 : 1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
