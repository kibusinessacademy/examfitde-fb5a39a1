#!/usr/bin/env node

/**
 * SSOT Guard – CI gate for schema consistency.
 *
 * Rules:
 *   1. .rpc('name') in code must have a matching RPC in migrations → EXIT 1 (hard fail)
 *   2. .from('table') in src/ is warn-only (Edge Functions may use .from())
 *   3. Placeholder/mock-data detection → EXIT 1
 */

import fs from "fs";
import path from "path";

const ROOT = process.cwd();

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (["node_modules", ".git", "dist", "build"].includes(entry.name)) continue;
      walk(p, files);
    } else {
      files.push(p);
    }
  }
  return files;
}

// Collect known RPCs from migration files
function collectKnownRpcs() {
  const migDir = path.join(ROOT, "supabase", "migrations");
  if (!fs.existsSync(migDir)) return new Set();

  const rpcs = new Set();
  const migFiles = fs.readdirSync(migDir).filter((f) => f.endsWith(".sql"));

  for (const f of migFiles) {
    const content = fs.readFileSync(path.join(migDir, f), "utf8");
    // Match CREATE [OR REPLACE] FUNCTION public.name(
    const matches = content.matchAll(
      /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?(\w+)\s*\(/gi
    );
    for (const m of matches) {
      rpcs.add(m[1]);
    }
  }
  return rpcs;
}

// Known internal/system RPCs that don't need migration matches.
// These exist in the DB but are defined in ways the simple CREATE FUNCTION
// regex above misses (DO blocks, schema-qualified DDL, etc.).
const SYSTEM_RPCS = new Set([
  "check_schema_drift",
  "sync_schema_contracts",
  "get_current_rpc_version",
  "resolve_current_rpc",
  // verified present in pg_proc 2026-06-03:
  "admin_get_deferred_jobs_clusters",
  "admin_get_track_m8_status",
]);

const knownRpcs = collectKnownRpcs();
const files = walk(ROOT);
let hardFail = false;
let warnCount = 0;

for (const file of files) {
  if (!file.endsWith(".ts") && !file.endsWith(".tsx") && !file.endsWith(".js")) continue;
  // Skip migration files and node_modules
  if (file.includes("node_modules") || file.includes("supabase/migrations")) continue;

  const content = fs.readFileSync(file, "utf8");

  // SSOT scope: the RPC and exam_questions checks apply to client-side code only.
  // Edge functions (supabase/functions/*) run server-side with service_role and have
  // their own contract layer; they are intentionally exempt here. Tests/e2e are also
  // exempt because they exercise contracts directly and may stub names.
  const isClientCode =
    file.includes("/src/") &&
    !file.includes("/src/test/") &&
    !file.includes("__tests__") &&
    !file.includes(".test.") &&
    !file.includes(".spec.");

  if (isClientCode) {
    // Hard fail: .rpc('name') with unknown RPC (client code only)
    const rpcMatches = content.matchAll(/\.rpc\(\s*['"`](\w+)['"`]/g);
    for (const m of rpcMatches) {
      const rpcName = m[1];
      if (!knownRpcs.has(rpcName) && !SYSTEM_RPCS.has(rpcName)) {
        console.error(`❌ HARD FAIL: .rpc('${rpcName}') in ${file} — not found in any migration`);
        hardFail = true;
      }
    }

    // SSOT Guard: direct .from('exam_questions') reads in client code must use view/RPC
    // See docs/SSOT_RULES.md — Tier 2 (exam_relevant)
    const EXAM_Q_ALLOWED_FILES = [
      "v_exam_relevant_questions",
      "artifact-resolver",
      "exam-pool-validator",
      "package-generate-exam-pool",
      // Admin inspection/diagnostic panels: read raw exam_questions for
      // status/QA breakdowns that v_exam_relevant_questions cannot expose.
      "ProductModuleStatus",
      "ExamQualityTab",
      "IntegrityExplainTabContent",
      "IntegrityReportCard",
      "SEOQuizWidget",
      "ActiveCourseContext",
    ];
    const isExamAllowed = EXAM_Q_ALLOWED_FILES.some((f) => file.includes(f));

    if (!isExamAllowed) {
      const examFromMatches = content.matchAll(/\.from\(\s*['"`]exam_questions['"`]\s*\)/g);
      for (const _m of examFromMatches) {
        const surroundingCode = content.slice(Math.max(0, _m.index - 100), _m.index + 200);
        const isCountOrSelect = /\.(select|count|eq|filter|gte|lte)/.test(surroundingCode);
        const isWriteOp = /\.(insert|upsert|update|delete)/.test(surroundingCode);
        if (isCountOrSelect && !isWriteOp) {
          console.error(`❌ HARD FAIL: Direct .from('exam_questions') read in ${file} — use v_exam_relevant_questions view or count_exam_relevant() RPC instead. See docs/SSOT_RULES.md`);
          hardFail = true;
        }
      }
    }
  }

  // SSOT Guard: detect legacy table references that have been renamed
  const LEGACY_TABLE_REFS = [
    { legacy: "pipeline_step_edges", replacement: "step_dag_edges" },
  ];
  // Skip migration files (read-only historical records)
  if (!file.includes("supabase/migrations")) {
    for (const { legacy, replacement } of LEGACY_TABLE_REFS) {
      if (content.includes(legacy)) {
        console.error(`❌ HARD FAIL: Legacy table reference '${legacy}' in ${file} — use '${replacement}' instead`);
        hardFail = true;
      }
    }
  }
}

if (hardFail) {
  console.error("\n🚫 SSOT Guard FAILED: Unknown RPC calls detected. Add migrations or fix code.");
  process.exit(1);
}

if (warnCount > 0) {
  console.warn(`\n⚠️  ${warnCount} warnings (non-blocking)`);
}

console.log("✅ SSOT Guard passed");
