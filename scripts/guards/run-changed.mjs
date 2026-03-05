#!/usr/bin/env node
import { execSync, execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function gitChangedFiles() {
  const base = process.env.CI_DIFF_BASE || "origin/main";
  const cmd = `git diff --name-only ${base}...HEAD`;
  try {
    const out = execSync(cmd, { stdio: ["ignore", "pipe", "pipe"] }).toString("utf8");
    return out.split("\n").map(s => s.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

const changed = new Set(gitChangedFiles());

const always = [
  "pipeline-contract-guard.mjs",
  "hard-literal-guard.mjs",
  "edge-import-guard.mjs",
];

const conditional = [
  { file: "ssot-guard.mjs", match: (f) => f.startsWith("src/") || f.includes("frontend") },
  { file: "blueprint-guard.mjs", match: (f) => f.startsWith("src/") || f.includes("edge") || f.includes("functions") },
  { file: "curriculum-freeze-guard.mjs", match: (f) => f.includes("supabase/migrations") || f.includes("curriculum") || f.includes("ssot") },
  { file: "integrity-track-aware-guard.mjs", match: (f) => f.includes("package-run-integrity-check") || f.includes("integrity") },
];

function run(file) {
  const p = path.join(__dirname, file);
  execFileSync("node", [p], { stdio: "inherit" });
}

try {
  for (const g of always) run(g);
  for (const c of conditional) {
    const hit = [...changed].some(c.match);
    if (hit) run(c.file);
  }
  console.log("\n✅ Changed-file guard set passed.");
} catch (e) {
  console.error("\n❌ Guard failed.");
  process.exit(1);
}
