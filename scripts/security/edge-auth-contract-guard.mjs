#!/usr/bin/env node
/**
 * edge-auth-contract-guard
 *
 * Blocks PRs introducing edge-function bypass patterns.
 *
 * Rules per supabase/functions/<name>/index.ts:
 *   1. If the file uses SUPABASE_SERVICE_ROLE_KEY, it MUST also reference one of:
 *        - assertAdmin                          (preferred, _shared/edgeAuthContract.ts)
 *        - requireAdmin                         (legacy _shared/adminGuard.ts)
 *        - validateAuth                         (legacy _shared/auth.ts)
 *        - EDGE_INTERNAL_SHARED_SECRET          (raw internal-secret check)
 *      OR be on the PUBLIC_FUNCTION_ALLOWLIST (e.g. webhooks with signature).
 *
 *   2. Forbidden patterns (HARD FAIL anywhere in supabase/functions/):
 *        - authHeader.includes(serviceKey)
 *        - authHeader.includes(SERVICE_ROLE)
 *        - trustedSources.includes(
 *        - body?.source === "ci"  /  body.source === "cron" without admin gate
 *        - mode === "simulate" without admin gate (heuristic: mode==='simulate' AND no assertAdmin/requireAdmin)
 */
import fs from "node:fs";
import path from "node:path";

const FN_DIR = "supabase/functions";
const BASELINE_PATH = "scripts/security/edge-auth-contract-baseline.json";

// Functions known to predate the contract (legacy debt). New violations beyond
// this set HARD FAIL. Removing a name (i.e. fixing it) is always allowed.
const BASELINE = new Set(
  fs.existsSync(BASELINE_PATH) ? JSON.parse(fs.readFileSync(BASELINE_PATH, "utf-8")) : [],
);

// Webhooks / public endpoints that intentionally do not require admin auth.
// Each MUST validate signatures or be otherwise safe.
const PUBLIC_FUNCTION_ALLOWLIST = new Set([
  "stripe-webhook",
  "stripe-webhook-test",
  "indexnow-submit",
  "send-contact-email",
  "newsletter-signup",
  "lead-capture",
  "track-event",
  "share-track",
]);

const FORBIDDEN_PATTERNS = [
  { name: "authHeader.includes(serviceKey)", re: /authHeader\s*\.\s*includes\s*\(\s*(serviceKey|SERVICE_ROLE|SUPABASE_SERVICE_ROLE_KEY)/ },
  { name: "trustedSources allowlist", re: /trustedSources\s*\.\s*includes\s*\(/ },
  { name: 'body.source === "ci" / "cron" bypass', re: /body[?.]*\.source\s*===\s*["'](ci|cron|cron_nightly|nightly)["']/ },
];

function listFunctions() {
  if (!fs.existsSync(FN_DIR)) return [];
  return fs.readdirSync(FN_DIR).filter((d) => {
    if (d.startsWith("_") || d.startsWith(".")) return false;
    const p = path.join(FN_DIR, d, "index.ts");
    return fs.existsSync(p);
  });
}

const violations = [];
const warnings = [];

for (const name of listFunctions()) {
  const file = path.join(FN_DIR, name, "index.ts");
  const src = fs.readFileSync(file, "utf-8");

  // Forbidden patterns
  for (const p of FORBIDDEN_PATTERNS) {
    if (p.re.test(src)) {
      violations.push(`❌ ${file}: forbidden pattern → ${p.name}`);
    }
  }

  // mode === "simulate" without admin gate
  if (/mode\s*===\s*["']simulate["']/.test(src)) {
    const guarded = /(assertAdmin|requireAdmin|validateAuth|EDGE_INTERNAL_SHARED_SECRET)/.test(src);
    if (!guarded) {
      violations.push(`❌ ${file}: mode==="simulate" without admin/internal-secret gate`);
    }
  }

  // Service-role usage requires a guard
  const usesServiceRole = /SUPABASE_SERVICE_ROLE_KEY|SERVICE_ROLE_KEY/.test(src);
  if (!usesServiceRole) continue;
  if (PUBLIC_FUNCTION_ALLOWLIST.has(name)) continue;

  const hasGuard = /(assertAdmin|requireAdmin|validateAuth|EDGE_INTERNAL_SHARED_SECRET)/.test(src);
  if (!hasGuard) {
    const msg = `${file}: uses SERVICE_ROLE_KEY without assertAdmin / requireAdmin / validateAuth / EDGE_INTERNAL_SHARED_SECRET`;
    if (BASELINE.has(name)) {
      warnings.push(`⚠️  baseline: ${msg}`);
    } else {
      violations.push(`❌ NEW: ${msg}`);
    }
  } else if (BASELINE.has(name)) {
    warnings.push(`ℹ️  baseline-fixed (remove from edge-auth-contract-baseline.json): ${name}`);
  }
}

if (violations.length > 0) {
  console.error("\n=== Edge Auth Contract Guard FAILED ===\n");
  for (const v of violations) console.error(v);
  console.error(`\n${violations.length} violation(s).`);
  console.error("Fix by importing assertAdmin from supabase/functions/_shared/edgeAuthContract.ts");
  console.error("or add the function to PUBLIC_FUNCTION_ALLOWLIST with justification.\n");
  process.exit(1);
}

if (warnings.length > 0) {
  console.warn(`\n${warnings.length} baseline warning(s) (non-blocking, fix gradually):`);
  for (const w of warnings.slice(0, 20)) console.warn(w);
  if (warnings.length > 20) console.warn(`  …and ${warnings.length - 20} more.`);
}

console.log(`\n✅ edge-auth-contract-guard: ${listFunctions().length} functions checked, no NEW violations (${BASELINE.size} legacy baseline entries).`);
