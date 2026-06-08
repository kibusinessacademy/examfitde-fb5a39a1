#!/usr/bin/env node
/**
 * vibeos-public-bundle-guard.mjs
 *
 * Hard-separation guard for berufos.com production builds.
 *
 * Scans `dist/index.html` and every script referenced from it
 * (the eagerly-loaded entry graph) for forbidden public-surface identifiers.
 *
 * Two severity tiers (matches RC GREEN architecture):
 *   HARD_BLOCK — VibeOS / AvatarOS public surface. Exit 1 on any hit.
 *   ADMIN_WATCH — Admin runtime page identifiers (RuntimeCommandCenter,
 *                 BackgroundAgentRuntime). These are auth-gated admin
 *                 pages; their string appears in entry chunks as a
 *                 dynamic-import filename reference. Logged as WARN,
 *                 never blocks. Only blocks if it appears in dist/index.html
 *                 (which would mean real public surface contamination).
 *
 * Lazy/code-split chunks NOT referenced from index.html are tolerated.
 */
import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const DIST = resolve(process.cwd(), "dist");

const HARD_BLOCK = ["VibeOSLandingPage", "AvatarOS"];
const ADMIN_WATCH = ["RuntimeCommandCenter", "BackgroundAgentRuntime"];

if (!existsSync(DIST)) {
  console.log("[vibeos-guard] dist/ not present — skip (no build to inspect).");
  process.exit(0);
}

const indexPath = join(DIST, "index.html");
if (!existsSync(indexPath)) {
  console.error("[vibeos-guard] dist/index.html missing");
  process.exit(1);
}
const indexHtml = readFileSync(indexPath, "utf8");

const blockFindings = [];
const warnFindings = [];

// index.html is hard public surface — any forbidden token blocks.
for (const token of [...HARD_BLOCK, ...ADMIN_WATCH]) {
  if (indexHtml.includes(token)) blockFindings.push({ file: "dist/index.html", token });
}

// Collect eagerly-referenced script srcs from index.html
const scriptSrcs = [
  ...indexHtml.matchAll(/<script[^>]+src=["']([^"']+)["']/gi),
  ...indexHtml.matchAll(/<link[^>]+rel=["'](?:modulepreload|preload)["'][^>]+href=["']([^"']+)["']/gi),
].map((m) => m[1]).filter((s) => s.endsWith(".js"));

for (const src of scriptSrcs) {
  const rel = src.startsWith("/") ? src.slice(1) : src;
  const fp = join(DIST, rel);
  if (!existsSync(fp)) continue;
  const content = readFileSync(fp, "utf8");
  for (const token of HARD_BLOCK) {
    if (content.includes(token)) blockFindings.push({ file: rel, token });
  }
  for (const token of ADMIN_WATCH) {
    if (content.includes(token)) warnFindings.push({ file: rel, token });
  }
}

if (warnFindings.length > 0) {
  console.warn("\n[vibeos-guard] ⚠️  ADMIN_WATCH (non-blocking) — admin runtime identifiers in entry chunk:");
  for (const f of warnFindings) console.warn(`   - ${f.file} → ${f.token}`);
  console.warn("   (admin pages are auth-gated; these appear as lazy-chunk filename references)\n");
}

if (blockFindings.length > 0) {
  console.error("\n[vibeos-guard] ❌ HARD_BLOCK — forbidden public-surface identifiers found:");
  for (const f of blockFindings) console.error(`   - ${f.file} → ${f.token}`);
  console.error(
    "\nThe berufos.com build must not surface VibeOS/AvatarOS code in the initial HTML or entry chunk.\n" +
      "Move the offending import behind a lazy route gated by host, or remove it.\n",
  );
  process.exit(1);
}

console.log(
  `[vibeos-guard] ✅ clean — no HARD_BLOCK identifiers in dist/index.html or entry chunks ` +
    `(scanned ${scriptSrcs.length} entry scripts, ${warnFindings.length} admin-watch warnings).`,
);
