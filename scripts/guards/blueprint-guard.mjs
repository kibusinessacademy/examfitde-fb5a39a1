#!/usr/bin/env node
/**
 * Blueprint Guard: Block "free generation" without blueprint context.
 * All question/content generation MUST be blueprint-based (SSOT).
 */
import fs from "node:fs";
import { globSync } from "glob";

const GLOBS = [
  "src/**/*.{ts,tsx,js,jsx}",
  "supabase/functions/**/*.{ts,js}",
];

const FORBIDDEN = [
  "generateQuestion(",
  "generate_exam_question",
  "free_generate",
  "openEndedGenerate",
  "promptOnlyQuestion",
];

const REQUIRED_WHEN_GENERATING = [
  "blueprint_id",
  "question_blueprints",
  "blueprint",
];

let hits = [];

for (const pattern of GLOBS) {
  for (const file of globSync(pattern, { nodir: true })) {
    const txt = fs.readFileSync(file, "utf8");
    const hasForbidden = FORBIDDEN.some(k => txt.includes(k));
    if (!hasForbidden) continue;

    const hasBlueprintContext = REQUIRED_WHEN_GENERATING.some(k => txt.includes(k));
    if (!hasBlueprintContext) {
      hits.push(file);
    }
  }
}

if (hits.length) {
  console.error("\n❌ Blueprint Guard: generation code without blueprint context.\n");
  for (const f of hits.slice(0, 40)) console.error(`  - ${f}`);
  console.error("\nFix: generation MUST be blueprint-based (SSOT). Ensure blueprint_id is required.\n");
  process.exit(1);
}

console.log("✅ Blueprint Guard passed.");
