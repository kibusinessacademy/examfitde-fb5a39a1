#!/usr/bin/env node
/**
 * edge-auth-contract-guard
 *
 * Hard-fails PRs that introduce edge-function auth bypass patterns.
 *
 * Two layers:
 *   - FORBIDDEN_PATTERNS: hard fail anywhere in supabase/functions/ (no baseline escape).
 *   - SERVICE_ROLE_KEY usage requires one of: assertAdmin / requireAdmin /
 *     validateAuth / EDGE_INTERNAL_SHARED_SECRET. Otherwise hard fail unless
 *     the function name is in the legacy baseline or PUBLIC_FUNCTION_ALLOWLIST.
 *
 * Pure scanning logic is exported as `scanSource()` for unit tests.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FN_DIR = "supabase/functions";
const BASELINE_PATH = "scripts/security/edge-auth-contract-baseline.json";

export const PUBLIC_FUNCTION_ALLOWLIST = new Set([
  "stripe-webhook",
  "stripe-webhook-test",
  "indexnow-submit",
  "send-contact-email",
  "newsletter-signup",
  "lead-capture",
  "track-event",
  "share-track",
]);

/**
 * Hard-fail patterns. Match anywhere in source — no baseline escape.
 * Add new patterns here when new bypass techniques surface.
 */
export const FORBIDDEN_PATTERNS = [
  {
    name: "authHeader.includes(serviceKey|SERVICE_ROLE|sk)",
    re: /(authHeader|authorization|Authorization|req\.headers\.get\(\s*["']authorization["']\s*\))\s*[?]?\.\s*includes\s*\(\s*(serviceKey|SERVICE_ROLE|SUPABASE_SERVICE_ROLE_KEY|sk|SK|adminKey|ADMIN_KEY)/,
  },
  { name: "trustedSources allowlist", re: /trustedSources\s*\.\s*includes\s*\(/ },
  {
    name: 'body.source === "ci"|"cron"|"dashboard"|"admin" bypass',
    re: /body[?.]*\.\s*source\s*===\s*["'](ci|cron|cron_nightly|nightly|dashboard|admin|internal|trusted)["']/,
  },
  {
    name: 'inline { source: "dashboard"|"ci" } bypass check',
    re: /\bsource\s*:\s*["'](ci|cron|cron_nightly|nightly|dashboard|admin|internal|trusted)["']\s*[,}]/,
  },
  {
    name: "x-admin-bypass / x-bypass-auth header check",
    re: /req\.headers\.get\(\s*["'](x-admin-bypass|x-bypass-auth|x-skip-auth)["']/i,
  },
];

const GUARD_TOKENS = /(assertAdmin|requireAdmin|validateAuth|EDGE_INTERNAL_SHARED_SECRET)/;

/**
 * Pure scanner — used by both CLI and tests.
 * @param {string} name function directory name
 * @param {string} src file source
 * @param {{ baseline?: Set<string>, allowlist?: Set<string> }} [opts]
 * @returns {{ violations: string[], warnings: string[] }}
 */
export function scanSource(name, src, opts = {}) {
  const baseline = opts.baseline ?? new Set();
  const allowlist = opts.allowlist ?? PUBLIC_FUNCTION_ALLOWLIST;
  const violations = [];
  const warnings = [];
  const tag = `supabase/functions/${name}/index.ts`;

  for (const p of FORBIDDEN_PATTERNS) {
    if (p.re.test(src)) violations.push(`❌ ${tag}: forbidden pattern → ${p.name}`);
  }

  if (/mode\s*===\s*["']simulate["']/.test(src) && !GUARD_TOKENS.test(src)) {
    violations.push(`❌ ${tag}: mode==="simulate" without admin/internal-secret gate`);
  }

  const usesServiceRole = /SUPABASE_SERVICE_ROLE_KEY|SERVICE_ROLE_KEY/.test(src);
  if (usesServiceRole && !allowlist.has(name)) {
    if (!GUARD_TOKENS.test(src)) {
      const msg = `${tag}: uses SERVICE_ROLE_KEY without assertAdmin / requireAdmin / validateAuth / EDGE_INTERNAL_SHARED_SECRET`;
      if (baseline.has(name)) warnings.push(`⚠️  baseline: ${msg}`);
      else violations.push(`❌ NEW: ${msg}`);
    } else if (baseline.has(name)) {
      warnings.push(`ℹ️  baseline-fixed (remove from edge-auth-contract-baseline.json): ${name}`);
    }
  }

  return { violations, warnings };
}

function listFunctions() {
  if (!fs.existsSync(FN_DIR)) return [];
  return fs.readdirSync(FN_DIR).filter((d) => {
    if (d.startsWith("_") || d.startsWith(".")) return false;
    return fs.existsSync(path.join(FN_DIR, d, "index.ts"));
  });
}

function runCli() {
  const baseline = new Set(
    fs.existsSync(BASELINE_PATH) ? JSON.parse(fs.readFileSync(BASELINE_PATH, "utf-8")) : [],
  );
  const fns = listFunctions();
  const allViolations = [];
  const allWarnings = [];

  for (const name of fns) {
    const file = path.join(FN_DIR, name, "index.ts");
    const src = fs.readFileSync(file, "utf-8");
    const { violations, warnings } = scanSource(name, src, { baseline });
    allViolations.push(...violations);
    allWarnings.push(...warnings);
  }

  if (allViolations.length > 0) {
    console.error("\n=== Edge Auth Contract Guard FAILED ===\n");
    for (const v of allViolations) console.error(v);
    console.error(`\n${allViolations.length} violation(s).`);
    console.error("Fix by importing assertAdmin from supabase/functions/_shared/edgeAuthContract.ts");
    console.error("or add the function to PUBLIC_FUNCTION_ALLOWLIST with justification.\n");
    process.exit(1);
  }

  if (allWarnings.length > 0) {
    console.warn(`\n${allWarnings.length} baseline warning(s) (non-blocking, fix gradually):`);
    for (const w of allWarnings.slice(0, 20)) console.warn(w);
    if (allWarnings.length > 20) console.warn(`  …and ${allWarnings.length - 20} more.`);
  }

  console.log(
    `\n✅ edge-auth-contract-guard: ${fns.length} functions checked, no NEW violations (${baseline.size} legacy baseline entries).`,
  );
}

const isCli = (() => {
  try {
    return process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
  } catch {
    return false;
  }
})();
if (isCli) runCli();
