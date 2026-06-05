#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const guards = [
  "ssot-guard.mjs",
  "blueprint-guard.mjs",
  "curriculum-freeze-guard.mjs",
  "edge-import-guard.mjs",
  "hard-literal-guard.mjs",
  "pipeline-contract-guard.mjs",
  "integrity-track-aware-guard.mjs",
  "no-nano-learning-content-guard.mjs",
  "auto-publish-postcondition-guard.mjs",
  "no-legacy-entitlement-rpc-guard.mjs",
  "dag-parity-guard.mjs",
  "edge-deploy-drift-guard.mjs",
  "handler-registry-parity-guard.mjs",
  "payload-key-contract-guard.mjs",
  "payload-schema-contract-report.mjs --check",
  "no-direct-done-write-guard.mjs",
  "completion-helper-guard.mjs",
  "no-legacy-org-members-guard.mjs",
  "trigger-function-parity-guard.mjs",
  "sql-discipline-guard.mjs",
  "guard-package-status-demotes.mjs",
  // P0.2 root-cause guard: vercel.json must hold an explicit rewrite for every
  // prerendered SSOT route, otherwise the SPA catch-all hijacks cold-loads and
  // serves the homepage HTML — see scripts/guards/vercel-prerender-rewrites-parity.mjs.
  "vercel-prerender-rewrites-parity.mjs",
];

function run(entry) {
  const parts = entry.split(" ");
  const file = parts[0];
  const args = parts.slice(1);
  const p = path.join(__dirname, file);
  execFileSync("node", [p, ...args], { stdio: "inherit" });
}

try {
  for (const g of guards) run(g);
  console.log("\n✅ All ExamFit guards passed.");
} catch (e) {
  console.error("\n❌ ExamFit guard failed.");
  process.exit(1);
}
