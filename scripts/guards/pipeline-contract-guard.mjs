#!/usr/bin/env node
/**
 * Pipeline Contract Guard: Ensure STEP_KEYS SSOT doc exists and is valid.
 * All pipeline step keys must be centrally documented.
 */
import fs from "node:fs";

const CONTRACT_FILE = "docs/pipeline/STEP_KEYS.md";

if (!fs.existsSync(CONTRACT_FILE)) {
  console.error(`\n❌ Pipeline Contract Guard: missing ${CONTRACT_FILE}\n`);
  console.error("Fix: create docs/pipeline/STEP_KEYS.md as the canonical SSOT for pipeline step keys.\n");
  process.exit(1);
}

const text = fs.readFileSync(CONTRACT_FILE, "utf8");
if (!text.includes("SSOT") || !text.includes("step_key")) {
  console.error(`\n❌ Pipeline Contract Guard: ${CONTRACT_FILE} looks incomplete.\n`);
  console.error("Fix: include SSOT marker and list of step_key values.\n");
  process.exit(1);
}

console.log("✅ Pipeline Contract Guard passed.");
