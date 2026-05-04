#!/usr/bin/env node
/**
 * guard-client-table-access
 * Static check: src/ React code may not directly .from('<internal>') tables.
 * Internal tables must be wrapped in views/RPCs (SSOT principle, Rule 17).
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const FORBIDDEN_TABLES = new Set([
  "job_queue", "package_steps", "auto_heal_log", "ops_job_type_registry",
  "step_dag_edges", "step_job_mapping", "heal_permanent_fix_tasks",
  "exam_questions", "user_roles",
]);
const ALLOW_FILES = [
  "src/integrations/supabase/", "src/lib/contracts/", "src/test/", "src/__tests__/",
];

function walk(d, out = []) {
  let entries; try { entries = readdirSync(d); } catch { return out; }
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
    if (FORBIDDEN_TABLES.has(m[1])) {
      console.error(`❌ Direct .from('${m[1]}') in client code: ${f}`);
      errs++;
    }
  }
}
if (errs > 0) { console.error(`\n❌ guard-client-table-access: ${errs} violation(s).`); process.exit(1); }
console.log("✅ guard-client-table-access passed");
