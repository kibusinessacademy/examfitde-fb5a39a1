#!/usr/bin/env node
/**
 * Guard: src/ client code MUST NOT write to certification_seo_pages directly
 * and MUST NOT read v_pillar_generation_backfill_candidates outside admin RPCs.
 * E3f Pillar generation is only via admin_backfill_certification_pillars.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const FORBIDDEN_TABLE = "certification_seo_pages";
const FORBIDDEN_VIEW = "v_pillar_generation_backfill_candidates";
const ALLOW_FILES = [
  "src/integrations/supabase/",
  "src/test/",
  "src/__tests__/",
  "src/hooks/useCertificationSEO.ts", // public read-only display hook
];

function walk(d, out = []) {
  let entries;
  try { entries = readdirSync(d); } catch { return out; }
  for (const e of entries) {
    const p = join(d, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(p)) out.push(p);
  }
  return out;
}

let errs = 0;
for (const f of walk("src")) {
  if (ALLOW_FILES.some((a) => f.includes(a))) continue;
  const text = readFileSync(f, "utf8");

  for (const m of text.matchAll(/\.from\(\s*['"`](\w+)['"`]/g)) {
    if (m[1] === FORBIDDEN_TABLE || m[1] === FORBIDDEN_VIEW) {
      // Allow read (.select) only if it's a pure SELECT; we only block mutations.
      const idx = m.index ?? 0;
      const window = text.slice(idx, idx + 400);
      if (/\.(insert|update|upsert|delete)\(/.test(window)) {
        console.error(`❌ Direct mutation on '${m[1]}' in client code: ${f}`);
        errs++;
      }
      if (m[1] === FORBIDDEN_VIEW) {
        console.error(`❌ Direct .from('${FORBIDDEN_VIEW}') — use admin_get_pillar_backfill_candidates RPC: ${f}`);
        errs++;
      }
    }
  }
}

if (errs > 0) {
  console.error(`\n❌ pillar-generation-backfill-guard: ${errs} violation(s).`);
  process.exit(1);
}
console.log("✅ pillar-generation-backfill-guard passed");
