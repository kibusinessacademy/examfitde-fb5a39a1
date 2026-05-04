#!/usr/bin/env node
/**
 * Guard Registry — central runner for ExamFit guard contract system.
 *
 * Phases:
 *   pre-commit  → fast static checks (lint-class)
 *   pr          → contract checks (schema, lane, dag, security)
 *   nightly     → live drift checks (require SUPABASE_SERVICE_ROLE_KEY)
 *
 * Usage:
 *   node scripts/guards/guard-registry.mjs --phase=pr
 *   node scripts/guards/guard-registry.mjs --only=schema.legacy-columns
 *   node scripts/guards/guard-registry.mjs --severity=error
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @typedef {{id:string,severity:'error'|'warn'|'info',owner:string,phase:'pre-commit'|'pr'|'nightly',command:string,description:string}} Guard */

/** @type {Guard[]} */
export const GUARDS = [
  // ===== P0: Schema =====
  { id: "schema.legacy-columns", severity: "error", owner: "platform", phase: "pre-commit",
    command: "node scripts/guards/guard-schema-legacy-columns.mjs",
    description: "Block forbidden legacy columns (e.g. product_prices.billing_interval)." },
  { id: "schema.contract-product-prices", severity: "error", owner: "platform", phase: "nightly",
    command: "node scripts/guards/schema-contract-product-prices.mjs",
    description: "Live DB schema contract for product_prices." },

  // ===== P0: SSOT =====
  { id: "ssot.lane-contract", severity: "error", owner: "queue", phase: "pr",
    command: "node scripts/guards/guard-lane-contract.mjs",
    description: "Code runner-lanes match DB derive_job_lane()." },
  { id: "ssot.step-job-contract", severity: "error", owner: "pipeline", phase: "pr",
    command: "node scripts/guards/guard-step-job-contract.mjs",
    description: "step_key ↔ job_type mapping integrity." },
  { id: "ssot.rpc-contracts", severity: "error", owner: "platform", phase: "pr",
    command: "node scripts/guards/guard-rpc-contracts.mjs",
    description: "All .rpc() calls in code resolve to a known migration RPC with matching signature." },

  // ===== P0: Runtime / Artifact-Truth =====
  { id: "runtime.governance-artifact-truth", severity: "error", owner: "pipeline", phase: "nightly",
    command: "node scripts/guards/guard-governance-artifact-truth.mjs",
    description: "run_integrity_check / quality_council / auto_publish done ⇒ artifact exists." },
  { id: "runtime.queue-claimability", severity: "warn", owner: "queue", phase: "nightly",
    command: "node scripts/guards/guard-queue-claimability.mjs",
    description: "Live drift in v_ops_queue_claimability (false control-lane reaps prevention)." },

  // ===== P0: Security =====
  { id: "security.rpc-execute-rights", severity: "error", owner: "security", phase: "pr",
    command: "node scripts/guards/guard-rpc-execute-rights.mjs",
    description: "Internal RPCs are not granted to anon/authenticated; service_role only." },

  // ===== Existing guards (re-exposed via registry) =====
  { id: "schema.ssot-guard", severity: "error", owner: "platform", phase: "pr",
    command: "node scripts/guards/ssot-guard.mjs", description: "Legacy SSOT guard." },
  { id: "ssot.canonical-identity", severity: "error", owner: "platform", phase: "pr",
    command: "node scripts/guards/canonical-identity-contract-guard.mjs", description: "Identity contract." },
  { id: "regression.no-direct-done-write", severity: "error", owner: "pipeline", phase: "pr",
    command: "node scripts/guards/no-direct-done-write-guard.mjs", description: "No direct status='done' writes." },

  // ===== P1 =====
  { id: "p1.client-table-access", severity: "error", owner: "platform", phase: "pr",
    command: "node scripts/guards/guard-client-table-access.mjs",
    description: "No direct .from('<internal>') in client code." },
  { id: "p1.pricing-publish-gate", severity: "warn", owner: "platform", phase: "nightly",
    command: "node scripts/guards/guard-pricing-publish-gate.mjs",
    description: "Untracked pricing-orphan packages aging > 2h." },
  { id: "p1.artifact-materialization", severity: "error", owner: "pipeline", phase: "nightly",
    command: "node scripts/guards/guard-artifact-materialization.mjs",
    description: "generate_* done ⇒ artifact rows exist." },

  // ===== P2 =====
  { id: "p2.seo-cluster", severity: "warn", owner: "growth", phase: "nightly",
    command: "node scripts/seo/quality-gate.mjs",
    description: "SEO copy / cluster drift." },
];

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { phase: null, only: null, severity: null };
  for (const a of args) {
    if (a.startsWith("--phase=")) out.phase = a.split("=")[1];
    else if (a.startsWith("--only=")) out.only = a.split("=")[1];
    else if (a.startsWith("--severity=")) out.severity = a.split("=")[1];
  }
  return out;
}

function selectGuards({ phase, only, severity }) {
  let g = GUARDS;
  if (only) g = g.filter((x) => x.id === only);
  if (phase) g = g.filter((x) => x.phase === phase);
  if (severity) g = g.filter((x) => x.severity === severity);
  return g;
}

function runGuard(g) {
  const [cmd, ...args] = g.command.split(" ");
  process.stdout.write(`\n▶︎ ${g.id}  (${g.severity}, ${g.phase}, owner=${g.owner})\n`);
  try {
    execFileSync(cmd, args, { stdio: "inherit", cwd: path.resolve(__dirname, "../..") });
    return { id: g.id, ok: true };
  } catch (e) {
    return { id: g.id, ok: false, severity: g.severity };
  }
}

function main() {
  const opts = parseArgs();
  const guards = selectGuards(opts);
  if (guards.length === 0) {
    console.log("No guards matched filters:", opts);
    process.exit(0);
  }
  console.log(`Running ${guards.length} guard(s)…`);
  const results = guards.map(runGuard);
  const errors = results.filter((r) => !r.ok && r.severity === "error");
  const warns = results.filter((r) => !r.ok && r.severity === "warn");

  console.log("\n=== Guard Registry Summary ===");
  for (const r of results) console.log(`  ${r.ok ? "✅" : "❌"} ${r.id}`);
  if (errors.length) {
    console.error(`\n❌ ${errors.length} ERROR-level guard(s) failed.`);
    process.exit(1);
  }
  if (warns.length) console.warn(`\n⚠️  ${warns.length} WARN-level guard(s) failed (non-blocking).`);
  console.log("\n✅ All ERROR-level guards passed.");
}

if (import.meta.url === `file://${process.argv[1]}`) main();
