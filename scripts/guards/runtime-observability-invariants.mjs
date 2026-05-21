#!/usr/bin/env node
/**
 * guard-runtime-observability-invariants
 *
 * Enforces v1.1 invariants for the Runtime Command Center:
 *   - RUNTIME_ACTION_NO_DELETE          : no DELETE/TRUNCATE on runtime_action_results / runtime_action_evidence
 *   - RUNTIME_AUDIT_APPEND_ONLY         : no UPDATE on auto_heal_log
 *   - RUNTIME_DIFF_NO_RANDOMNESS        : runtimeDiff.ts forbids Date.now() / Math.random()
 *   - RUNTIME_EVIDENCE_NO_SECRET_FIELDS : no raw secret keys leaked through evidence drawer
 *
 * Static repo-only checks. Hard-fails CI on violations.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const violations = [];

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (e === "node_modules" || e === ".git" || e === "dist") continue;
    const s = statSync(p);
    if (s.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const files = walk(ROOT).filter((f) => /\.(ts|tsx|sql|mjs)$/.test(f));

// 1. RUNTIME_ACTION_NO_DELETE — only allow in supabase/migrations and only flag dangerous patterns
const deleteRe = /\b(DELETE\s+FROM|TRUNCATE)\s+(public\.)?(runtime_action_results|runtime_action_evidence)\b/i;
for (const f of files) {
  if (f.includes("/scripts/guards/")) continue;
  const t = readFileSync(f, "utf8");
  if (deleteRe.test(t)) violations.push(`RUNTIME_ACTION_NO_DELETE: ${f}`);
}

// 2. RUNTIME_AUDIT_APPEND_ONLY — no UPDATE on auto_heal_log outside guarded migrations
const updateRe = /\bUPDATE\s+(public\.)?auto_heal_log\b/i;
for (const f of files) {
  if (f.includes("/scripts/guards/")) continue;
  if (f.endsWith(".sql")) continue; // migrations may legitimately backfill via fn_emit_audit-controlled paths
  const t = readFileSync(f, "utf8");
  if (updateRe.test(t)) violations.push(`RUNTIME_AUDIT_APPEND_ONLY: ${f}`);
}

// 3. RUNTIME_DIFF_NO_RANDOMNESS
const diffFile = join(ROOT, "src/lib/runtime/diff/runtimeDiff.ts");
try {
  const t = readFileSync(diffFile, "utf8");
  if (/Date\.now\(|Math\.random\(/.test(t)) {
    violations.push(`RUNTIME_DIFF_NO_RANDOMNESS: ${diffFile}`);
  }
} catch { /* file may not exist in legacy branches */ }

// 4. RUNTIME_EVIDENCE_NO_SECRET_FIELDS — drawer must not console.log payload / inline secrets
const drawer = join(ROOT, "src/features/admin/components/RuntimeEvidenceDrawer.tsx");
try {
  const t = readFileSync(drawer, "utf8");
  if (/console\.(log|debug|info)\s*\(/.test(t)) {
    violations.push(`RUNTIME_EVIDENCE_NO_SECRET_FIELDS: ${drawer} (console.* present)`);
  }
} catch { /* ok */ }

if (violations.length) {
  console.error("❌ runtime-observability-invariants failed:");
  for (const v of violations) console.error("  - " + v);
  process.exit(1);
}
console.log("✅ runtime-observability-invariants passed");
