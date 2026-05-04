#!/usr/bin/env node
/**
 * guard-failure-reporter
 * Wraps any guard command, captures stdout/stderr, and on failure emits a
 * structured report with: cause, files, suggested fix.
 *
 * Usage:
 *   node scripts/guards/guard-failure-reporter.mjs --id=schema.legacy-columns -- node scripts/guards/guard-schema-legacy-columns.mjs
 */
import { spawnSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";

const args = process.argv.slice(2);
const idArg = args.find((a) => a.startsWith("--id="));
const dashIdx = args.indexOf("--");
if (!idArg || dashIdx === -1) { console.error("usage: --id=<guard.id> -- <cmd> <args...>"); process.exit(2); }
const guardId = idArg.split("=")[1];
const [cmd, ...cmdArgs] = args.slice(dashIdx + 1);

const res = spawnSync(cmd, cmdArgs, { encoding: "utf8" });
const stdout = res.stdout || "";
const stderr = res.stderr || "";
const log = stdout + "\n" + stderr;
process.stdout.write(stdout);
process.stderr.write(stderr);

if (res.status === 0) process.exit(0);

const lines = log.split(/\r?\n/);
const errLines = lines.filter((l) => l.startsWith("❌")).slice(0, 25);
const files = Array.from(new Set(log.match(/[\w./-]+\.(ts|tsx|sql|mjs|js)/g) || [])).slice(0, 25);

const HINTS = {
  "schema.legacy-columns": "Replace the legacy column reference with the canonical replacement (see scripts/guards/guard-schema-legacy-columns.mjs BLOCKED list).",
  "ssot.lane-contract": "Update either supabase/functions/_shared/runner-lanes.ts OR derive_job_lane() in a new migration so both buckets agree. Re-run admin_test_lane_classification to verify.",
  "ssot.step-job-contract": "Add the missing job_type to ops_job_type_registry via migration, or remove the orphan step_key from package_steps via admin_step_reset_detailed.",
  "security.rpc-execute-rights": "REVOKE EXECUTE ON FUNCTION public.<name>(<args>) FROM PUBLIC, anon, authenticated; GRANT EXECUTE … TO service_role;",
  "runtime.governance-artifact-truth": "Re-open the offending step via admin_step_reset_detailed and let the worker rebuild the artifact (verdict / publish_state / approved questions).",
  "runtime.queue-claimability": "If stale_processing>0 → run fn_reap_stale_processing_jobs. If pricing_blocked → check products+product_prices. If schema_drift_blocked → see migration history.",
};

const report = [
  `# ❌ Guard failed: ${guardId}`, "",
  `**Time:** ${new Date().toISOString()}`,
  `**Command:** \`${cmd} ${cmdArgs.join(" ")}\``,
  "",
  "## Cause",
  ...(errLines.length ? errLines.map((l) => `- ${l.replace(/^❌\s*/, "")}`) : ["(no ❌-prefixed errors captured — see log)"]),
  "",
  "## Affected files",
  ...(files.length ? files.map((f) => `- \`${f}\``) : ["(none detected)"]),
  "",
  "## Suggested fix",
  HINTS[guardId] || "Re-read the guard source for diagnostic detail. Run locally with `node scripts/guards/<file>.mjs`.",
  "",
  "<details><summary>Last 50 log lines</summary>",
  "",
  "```",
  ...lines.slice(-50),
  "```",
  "</details>",
].join("\n");

mkdirSync(".lovable/guard-reports", { recursive: true });
const file = `.lovable/guard-reports/${guardId.replace(/\W/g, "_")}.md`;
writeFileSync(file, report);
console.error(`\n📝 Guard-failure report written to ${file}`);
process.exit(res.status);
