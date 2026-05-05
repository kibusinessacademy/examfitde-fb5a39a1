#!/usr/bin/env node
/**
 * Status-Revert Guard (CI)
 * Blockt neue unsichere Status-Demotes auf course_packages.status.
 * Erlaubt sind nur Updates die einen expliziten Admin-Source setzen
 *   (set_config('app.transition_source', 'admin_*', true))
 * oder die im Allowlist-Set stehen.
 *
 * Scant: supabase/functions/**, src/**, scripts/** (außer migrations + node_modules + dist + this guard).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOTS = ["supabase/functions", "src", "scripts"];
const SKIP = ["node_modules", "dist", "migrations", "build", ".next"];
const SELF = "scripts/guards/status-revert-guard.mjs";

// Patterns that indicate a status-demote write
const DEMOTE_RE =
  /course_packages[^;]{0,400}?status['"\s:=]+['"](queued|draft|building|blocked)['"]/i;
// Allow if file also contains explicit admin transition source setter
const ADMIN_OK_RE =
  /(app\.transition_source['"\s,]+['"]?(admin_manual|admin_soft_reset|admin_force_rebuild|admin_force_publish))|@allow-status-demote/;

function* walk(dir) {
  let entries;
  try { entries = readdirSync(dir); } catch { return; }
  for (const e of entries) {
    if (SKIP.includes(e)) continue;
    const p = join(dir, e);
    let s;
    try { s = statSync(p); } catch { continue; }
    if (s.isDirectory()) yield* walk(p);
    else if (/\.(ts|tsx|js|mjs|cjs)$/.test(e)) yield p;
  }
}

const violations = [];
for (const root of ROOTS) {
  for (const file of walk(root)) {
    if (file.endsWith(SELF)) continue;
    const src = readFileSync(file, "utf8");
    if (!DEMOTE_RE.test(src)) continue;
    if (ADMIN_OK_RE.test(src)) continue;
    // Allow files that only call our pre-check helper
    if (/fn_can_demote_package_status/.test(src)) continue;
    violations.push(file);
  }
}

if (violations.length) {
  console.error("❌ status-revert-guard: unsafe course_packages.status demote(s) found:");
  for (const v of violations) console.error("  -", v);
  console.error(
    "\nFix: call public.fn_can_demote_package_status(pkg, target, source) before the UPDATE,\n" +
    "     or set_config('app.transition_source','admin_*',true) for legitimate admin paths,\n" +
    "     or add an `// @allow-status-demote: <reason>` comment if the write is provably safe."
  );
  process.exit(1);
}
console.log("✅ status-revert-guard: no unsafe status demotes detected");
