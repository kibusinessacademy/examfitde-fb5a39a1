#!/usr/bin/env node
/**
 * SEO Content Quality Gate
 * --------------------------------------------------------------
 * Validates every LIVE entry in src/content/seoRoutes.ts against the
 * Phase-1 quality contract:
 *
 *   - title: present, 30..60 chars
 *   - description: present, 70..160 chars
 *   - h1: present
 *   - intro: >= 500 chars
 *   - keyFacts: >= 4
 *   - faq: >= 4
 *   - jsonLd: present (>= 1 entry)
 *   - canonical: derivable from path (path starts with /)
 *   - visible-html-text proxy: intro + facts + faq combined >= 1200 chars
 *   - forbidden claims (case-insensitive substrings): see FORBIDDEN
 *
 * Exits non-zero on any failure. Prints a concise per-route report.
 *
 * Usage:
 *   node scripts/seo/quality-gate.mjs
 *
 * The script loads the TS-SSOT via a tiny inline transpile (no bundler).
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { transformSync } from "esbuild";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SSOT_PATH = resolve(__dirname, "../../src/content/seoRoutes.ts");

// Forbidden claim substrings (lowercased match)
const FORBIDDEN = [
  "originalfragen",
  "originalformat",
  "garantiert bestehen",
  "garantierte bestehensquote",
  "100% bestehen",
  "über 50.000",
  "ueber 50.000",
  "über 50000",
  "50.000 auszubildende",
];

async function loadSsot() {
  const src = readFileSync(SSOT_PATH, "utf8");
  const { code } = transformSync(src, {
    loader: "ts",
    format: "esm",
    target: "es2022",
    sourcemap: false,
  });
  // Write to a temp data: URL is awkward; use eval via dynamic import of base64.
  const dataUrl =
    "data:text/javascript;base64," + Buffer.from(code).toString("base64");
  return await import(dataUrl);
}

function lenText(s) {
  return (s || "").trim().length;
}

function combinedVisibleText(r) {
  const facts = r.keyFacts.map((f) => `${f.label}: ${f.value}`).join(" ");
  const faq = r.faq.map((f) => `${f.q} ${f.a}`).join(" ");
  return [r.h1, r.intro, facts, faq].join("\n");
}

function check(r) {
  const errs = [];
  const tlen = lenText(r.title);
  const dlen = lenText(r.description);

  if (!r.title) errs.push("title missing");
  else if (tlen < 30 || tlen > 60)
    errs.push(`title length ${tlen} (expected 30..60)`);

  if (!r.description) errs.push("description missing");
  else if (dlen < 70 || dlen > 160)
    errs.push(`description length ${dlen} (expected 70..160)`);

  if (!r.h1 || lenText(r.h1) < 5) errs.push("h1 missing/too short");

  if (lenText(r.intro) < 500)
    errs.push(`intro ${lenText(r.intro)} chars (expected >= 500)`);

  if (!Array.isArray(r.keyFacts) || r.keyFacts.length < 4)
    errs.push(`keyFacts ${r.keyFacts?.length ?? 0} (expected >= 4)`);

  if (!Array.isArray(r.faq) || r.faq.length < 4)
    errs.push(`faq ${r.faq?.length ?? 0} (expected >= 4)`);

  if (!Array.isArray(r.jsonLd) || r.jsonLd.length < 1)
    errs.push("jsonLd missing");

  if (!r.path || !r.path.startsWith("/"))
    errs.push("path missing or not absolute (canonical undeterminable)");

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

(async () => {
  const mod = await loadSsot();
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
})();
