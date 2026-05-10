#!/usr/bin/env node
/**
 * access-rpc-grants-aware-guard
 *
 * Hard-fails PRs that introduce *new* access RPCs / functions which only read
 * `entitlements` (or only call entitlement RPCs) without also honoring
 * `learner_course_grants` (Loop-C SSOT). Grants are issued by
 * trg_orders_paid_grant on `orders.status='paid'` and must be a first-class
 * access source — otherwise grant-only buyers get blocked from Tutor / Storage
 * / etc. (the P0 we just patched on 2026-05-10).
 *
 * Detection is scoped to *new* migration files introducing access-shaped
 * functions, identified by name pattern. A function is considered grants-aware
 * when its body either:
 *   - references `learner_course_grants` directly, or
 *   - delegates to an SSOT resolver:
 *       check_product_access_by_curriculum
 *       can_access_product
 *       has_storage_entitlement
 *       tutor_access_check
 *
 * Allowlist baseline lives at scripts/guards/access-rpc-grants-aware-baseline.json
 * (legacy functions which intentionally remain entitlement-only — currently empty).
 *
 * Exit 0 = clean / 1 = NEW violation.
 */
import fs from "node:fs";
import path from "node:path";

const MIG_DIR = "supabase/migrations";
const BASELINE_PATH = "scripts/guards/access-rpc-grants-aware-baseline.json";

const ACCESS_NAME_RE =
  /\b(check_[a-z_]*access[a-z_]*|can_access_[a-z_]+|has_[a-z_]*entitlement[a-z_]*|tutor_access_check|[a-z_]*_access_check)\b/g;

const SSOT_DELEGATES = [
  "check_product_access_by_curriculum",
  "can_access_product",
  "has_storage_entitlement",
  "tutor_access_check",
];

const baseline = new Set(
  fs.existsSync(BASELINE_PATH) ? JSON.parse(fs.readFileSync(BASELINE_PATH, "utf-8")) : [],
);

function listMigrations() {
  if (!fs.existsSync(MIG_DIR)) return [];
  return fs.readdirSync(MIG_DIR).filter((f) => f.endsWith(".sql")).map((f) => path.join(MIG_DIR, f));
}

/**
 * Extract CREATE OR REPLACE FUNCTION blocks. Returns [{ name, body }].
 */
export function extractFunctions(sql) {
  const out = [];
  // Match CREATE [OR REPLACE] FUNCTION public.name(...) ... AS $...$ <body> $...$
  const re =
    /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?([a-z_][a-z0-9_]*)\s*\([^)]*\)[\s\S]*?AS\s+(\$[a-zA-Z_]*\$)([\s\S]*?)\2/gi;
  let m;
  while ((m = re.exec(sql)) !== null) {
    out.push({ name: m[1], body: m[3] });
  }
  return out;
}

export function isAccessShaped(name) {
  ACCESS_NAME_RE.lastIndex = 0;
  return ACCESS_NAME_RE.test(name);
}

export function isGrantsAware(body) {
  if (/learner_course_grants/i.test(body)) return true;
  for (const d of SSOT_DELEGATES) {
    const re = new RegExp(`\\b${d}\\s*\\(`, "i");
    if (re.test(body)) return true;
  }
  return false;
}

export function readsEntitlementsOnly(body) {
  // Touches entitlements / check_user_entitlement but NOT grants/SSOT delegates.
  const touchesEnt =
    /\bentitlements\b/i.test(body) || /\bcheck_user_entitlement\s*\(/i.test(body);
  return touchesEnt && !isGrantsAware(body);
}

const violations = [];
const inspected = [];

for (const file of listMigrations()) {
  const sql = fs.readFileSync(file, "utf-8");
  const fns = extractFunctions(sql);
  for (const fn of fns) {
    if (!isAccessShaped(fn.name)) continue;
    inspected.push({ file, name: fn.name });
    if (baseline.has(fn.name)) continue;
    if (readsEntitlementsOnly(fn.body)) {
      violations.push(
        `❌ ${file}: function ${fn.name}() reads entitlements without honoring learner_course_grants. ` +
          `Either reference learner_course_grants directly or delegate to one of: ${SSOT_DELEGATES.join(", ")}.`,
      );
    }
  }
}

if (violations.length > 0) {
  console.error("\n=== access-rpc-grants-aware-guard FAILED ===\n");
  for (const v of violations) console.error(v);
  console.error(
    `\n${violations.length} violation(s). New access RPCs MUST be grants-aware (Loop-C SSOT).`,
  );
  console.error(`If this is an intentional legacy function, add its name to ${BASELINE_PATH}.`);
  process.exit(1);
}

console.log(
  `✅ access-rpc-grants-aware-guard: ${inspected.length} access-shaped function(s) inspected, all grants-aware.`,
);
