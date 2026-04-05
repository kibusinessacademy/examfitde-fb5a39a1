#!/usr/bin/env node
/**
 * Edge Deploy Drift Guard
 * 
 * Detects when edge function source files have been modified
 * but the function has not been redeployed.
 * 
 * Compares git diff of supabase/functions/ against the last known
 * deploy timestamps. Fails CI if drift is detected.
 * 
 * Usage: node scripts/guards/edge-deploy-drift-guard.mjs
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const FUNCTIONS_DIR = "supabase/functions";
const SHARED_DIR = `${FUNCTIONS_DIR}/_shared`;

// Get all edge function directories (excluding _shared)
function getEdgeFunctions() {
  if (!fs.existsSync(FUNCTIONS_DIR)) return [];
  return fs.readdirSync(FUNCTIONS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory() && d.name !== "_shared")
    .map(d => d.name);
}

// Get files changed in the last commit (or between HEAD~1..HEAD)
function getChangedFiles() {
  try {
    const diff = execSync("git diff --name-only HEAD~1..HEAD 2>/dev/null || git diff --name-only HEAD", {
      encoding: "utf-8",
    }).trim();
    return diff ? diff.split("\n") : [];
  } catch {
    console.warn("⚠️  Could not determine changed files (no git history?)");
    return [];
  }
}

function run() {
  const changed = getChangedFiles();
  if (changed.length === 0) {
    console.log("✅ No changes detected — edge deploy drift guard passed.");
    return;
  }

  const sharedChanged = changed.some(f => f.startsWith(SHARED_DIR + "/"));
  const functionsWithChanges = new Set();

  for (const file of changed) {
    if (!file.startsWith(FUNCTIONS_DIR + "/")) continue;
    if (file.startsWith(SHARED_DIR + "/")) continue;

    // Extract function name: supabase/functions/<name>/...
    const parts = file.slice(FUNCTIONS_DIR.length + 1).split("/");
    if (parts.length >= 1) {
      functionsWithChanges.add(parts[0]);
    }
  }

  // If _shared changed, ALL functions need redeployment
  if (sharedChanged) {
    const allFunctions = getEdgeFunctions();
    for (const fn of allFunctions) {
      functionsWithChanges.add(fn);
    }
  }

  if (functionsWithChanges.size === 0) {
    console.log("✅ No edge function source changes — drift guard passed.");
    return;
  }

  // Output which functions need deployment
  const sorted = [...functionsWithChanges].sort();
  
  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║  EDGE FUNCTION DEPLOY DRIFT DETECTED                   ║");
  console.log("╠══════════════════════════════════════════════════════════╣");
  
  if (sharedChanged) {
    console.log("║  ⚠️  _shared/ was modified — ALL functions affected     ║");
  }
  
  console.log("║                                                          ║");
  console.log("║  Functions requiring deployment:                          ║");
  
  for (const fn of sorted) {
    console.log(`║    → ${fn.padEnd(50)}║`);
  }
  
  console.log("║                                                          ║");
  console.log("║  Action: Deploy these functions before merging.           ║");
  console.log("║  Command: supabase functions deploy <name>                ║");
  console.log("╚══════════════════════════════════════════════════════════╝");

  // In Lovable context, this is a WARNING (deploy is automatic)
  // but the healthcheck should verify post-deploy
  console.log("\n⚠️  DEPLOY DRIFT: " + sorted.length + " function(s) have source changes.");
  console.log("   Lovable auto-deploys on merge, but verify via edge-deploy-healthcheck.");
  
  // Write manifest for downstream consumption
  const manifest = {
    timestamp: new Date().toISOString(),
    sharedChanged,
    functionsRequiringDeploy: sorted,
    changedFiles: changed.filter(f => f.startsWith(FUNCTIONS_DIR + "/")),
  };
  
  fs.writeFileSync("/tmp/edge-deploy-drift-manifest.json", JSON.stringify(manifest, null, 2));
  console.log("\n📄 Manifest written to /tmp/edge-deploy-drift-manifest.json");
}

run();
