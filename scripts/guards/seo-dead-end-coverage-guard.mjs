#!/usr/bin/env node
/**
 * E3d SEO Dead-End Coverage Guard
 * ──────────────────────────────────────────────────────────────
 * Stellt sicher, dass UI keine direkten Reads/Writes auf den
 * SEO-Coverage-Quelltabellen macht. Zugriff nur via
 *   admin_get_seo_dead_end_coverage RPC.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const SCAN = [join(ROOT, "src")];
const FORBIDDEN = [
  "certification_seo_pages",
  "seo_content_pages",
  "v_seo_dead_end_coverage",
];
const ALLOW_FILE = /SeoDeadEndCoverageCard\.tsx$/;

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e)) out.push(p);
  }
  return out;
}

const violations = [];
for (const root of SCAN) {
  for (const f of walk(root)) {
    if (ALLOW_FILE.test(f)) continue;
    if (f.includes("/integrations/supabase/")) continue;
    if (f.includes("/__tests__/") || f.includes(".test.")) continue;
    const src = readFileSync(f, "utf8");
    for (const t of FORBIDDEN) {
      const re = new RegExp(`\\.from\\(\\s*['"\`]${t}['"\`]\\s*\\)\\s*\\.(update|delete|insert|upsert)\\b`);
      if (re.test(src)) {
        violations.push(`${f}: direct mutation on ${t}`);
      }
    }
  }
}

if (violations.length) {
  console.error("E3d guard failed:\n" + violations.map((v) => "  - " + v).join("\n"));
  process.exit(1);
}
console.log("E3d seo-dead-end-coverage guard: OK");
