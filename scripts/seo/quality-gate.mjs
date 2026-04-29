#!/usr/bin/env node
/**
 * SEO Content Quality Gate
 * --------------------------------------------------------------
 * Validates every LIVE entry in src/content/seoRoutes.ts against the
 * Phase-1 quality contract.
 *
 * Run:  node --experimental-strip-types scripts/seo/quality-gate.mjs
 * (Node >= 22 with --experimental-strip-types loads the .ts SSOT directly.)
 *
 * Checks per route:
 *   - title: present, 30..60 chars
 *   - description: present, 70..160 chars
 *   - h1: present
 *   - intro: >= 500 chars
 *   - keyFacts: >= 4
 *   - faq: >= 4
 *   - jsonLd: present (>= 1 entry)
 *   - canonical derivable (path absolute)
 *   - visible-text proxy (h1+intro+facts+faq) >= 1200 chars
 *   - no forbidden claims (see FORBIDDEN)
 *
 * Exits non-zero on any failure.
 */

import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SSOT_URL = pathToFileURL(
  resolve(__dirname, "../../src/content/seoRoutes.ts"),
).href;

// Forbidden claim substrings (lowercase, matched against combined visible text)
const FORBIDDEN = [
  // Originality / IP claims
  "originalfragen",
  "originalformat",
  "original-punktebewertung",
  "originalbewertung",
  "offizielle ihk-fragen",
  "echte ihk-fragen",
  // Pass guarantees
  "garantiert bestehen",
  "garantierte bestehensquote",
  "bestehensgarantie",
  "100% bestehen",
  "100 % bestehen",
  // Hard unverified user / volume numbers
  "über 50.000",
  "ueber 50.000",
  "über 50000",
  "50.000 auszubildende",
  "über 300",
  "ueber 300",
  "über 500",
  "ueber 500",
  "über 1.000",
  "ueber 1.000",
  "über 1000",
  "ueber 1000",
];

const len = (s) => (s || "").trim().length;

function combinedVisibleText(r) {
  const facts = r.keyFacts.map((f) => `${f.label}: ${f.value}`).join(" ");
  const faq = r.faq.map((f) => `${f.q} ${f.a}`).join(" ");
  return [r.h1, r.intro, facts, faq].join("\n");
}

function check(r) {
  const errs = [];
  const tl = len(r.title);
  const dl = len(r.description);

  if (!r.title) errs.push("title missing");
  else if (tl < 30 || tl > 60)
    errs.push(`title length ${tl} (expected 30..60)`);

  if (!r.description) errs.push("description missing");
  else if (dl < 70 || dl > 160)
    errs.push(`description length ${dl} (expected 70..160)`);

  if (!r.h1 || len(r.h1) < 5) errs.push("h1 missing/too short");

  if (len(r.intro) < 500)
    errs.push(`intro ${len(r.intro)} chars (expected >= 500)`);

  if (!Array.isArray(r.keyFacts) || r.keyFacts.length < 4)
    errs.push(`keyFacts ${r.keyFacts?.length ?? 0} (expected >= 4)`);

  if (!Array.isArray(r.faq) || r.faq.length < 4)
    errs.push(`faq ${r.faq?.length ?? 0} (expected >= 4)`);

  if (!Array.isArray(r.jsonLd) || r.jsonLd.length < 1)
    errs.push("jsonLd missing");

  if (!r.path || !r.path.startsWith("/"))
    errs.push("path missing or not absolute");

  const visible = combinedVisibleText(r);
  if (visible.length < 1200)
    errs.push(`visible text ${visible.length} chars (expected >= 1200)`);

  const lower = visible.toLowerCase();
  for (const claim of FORBIDDEN) {
    if (lower.includes(claim))
      errs.push(`forbidden claim present: "${claim}"`);
  }

  return errs;
}

const mod = await import(SSOT_URL);
const live = mod.liveSeoRoutes;
if (!Array.isArray(live) || live.length === 0) {
  console.error("[quality-gate] no live routes found");
  process.exit(2);
}

let failed = 0;
const lines = [];
for (const r of live) {
  const errs = check(r);
  if (errs.length === 0) {
    lines.push(`  ✅ ${r.path}`);
  } else {
    failed++;
    lines.push(`  ❌ ${r.path}`);
    for (const e of errs) lines.push(`       - ${e}`);
  }
}

console.log(`SEO Quality Gate — ${live.length} live route(s)`);
console.log(lines.join("\n"));

if (failed > 0) {
  console.error(`\n[quality-gate] ${failed} route(s) failed.`);
  process.exit(1);
}
console.log("\n[quality-gate] all live routes pass ✅");
