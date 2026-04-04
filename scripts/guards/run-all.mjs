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
];

function run(file) {
  const p = path.join(__dirname, file);
  execFileSync("node", [p], { stdio: "inherit" });
}

try {
  for (const g of guards) run(g);
  console.log("\n✅ All ExamFit guards passed.");
} catch (e) {
  console.error("\n❌ ExamFit guard failed.");
  process.exit(1);
}
