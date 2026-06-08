#!/usr/bin/env node
/**
 * vibeos-public-bundle-guard.mjs
 *
 * Hard-separation guard for berufos.com production builds.
 *
 * Scans `dist/index.html` and every script referenced from it
 * (the eagerly-loaded entry graph) for forbidden VibeOS identifiers.
 *
 * Exits 1 on any hit — CI must fail and the deploy must be blocked.
 *
 * Lazy/code-split chunks that are NOT referenced from index.html are tolerated:
 * they only load when a user explicitly hits a forbidden route, which is now
 * 404'd at the router level.
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const DIST = resolve(process.cwd(), "dist");
const FORBIDDEN = [
  "VibeOSLandingPage",
  "AvatarOS",
  "RuntimeCommandCenter",
  "BackgroundAgentRuntime",
];

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

const findings = [];

for (const token of FORBIDDEN) {
  if (indexHtml.includes(token)) {
    findings.push({ file: "dist/index.html", token });
  }
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
  for (const token of FORBIDDEN) {
    if (content.includes(token)) {
      findings.push({ file: rel, token });
    }
  }
}

if (findings.length > 0) {
  console.error("\n[vibeos-guard] ❌ FORBIDDEN VibeOS identifiers found in eagerly-loaded bundle:");
  for (const f of findings) {
    console.error(`   - ${f.file} → ${f.token}`);
  }
  console.error(
    "\nThe berufos.com build must not surface VibeOS code in the initial HTML or entry chunk.\n" +
      "Move the offending import behind a lazy route gated by host, or remove it.\n",
  );
  process.exit(1);
}

console.log(
  `[vibeos-guard] ✅ clean — no forbidden VibeOS identifiers in dist/index.html or entry chunks ` +
    `(scanned ${scriptSrcs.length} entry scripts).`,
);
