#!/usr/bin/env node
/**
 * CI Guard: Block direct fetch() calls to LLM provider APIs.
 * All LLM calls MUST go through the shared ai-client wrapper.
 *
 * Allowed exceptions:
 *   - _shared/ai-client.ts (the wrapper itself)
 *   - ai-healthcheck/ (synthetic probe — intentionally direct)
 *   - generate-image/ (Images API, not chat completions)
 */
import fs from "node:fs";
import { globSync } from "glob";

const files = globSync("supabase/functions/**/*.ts", { nodir: true });

const PATTERNS = [

  { regex: /fetch\(\s*["'`]https:\/\/api\.openai\.com\/v1\/chat/g, label: "direct OpenAI chat fetch" },
  { regex: /fetch\(\s*["'`]https:\/\/api\.anthropic\.com/g, label: "direct Anthropic fetch" },
  { regex: /fetch\(\s*["'`]https:\/\/generativelanguage\.googleapis\.com/g, label: "direct Google Generative-Language fetch" },
  { regex: /\.messages\.create\(/g, label: "Anthropic SDK messages.create" },
  { regex: /\.chat\.completions\.create\(/g, label: "OpenAI SDK completions.create" },
];

/**
 * Phase 2 patterns: block callAIWithFailover / callAIJSON outside allowed modules.
 * These must go through the AI Generation Gateway for routing, caching, and cost control.
 */
const PHASE2_PATTERNS = [
  { regex: /\bcallAIWithFailover\s*\(/g, label: "callAIWithFailover (must use Gateway)" },
  { regex: /\bcallAIJSON\s*\(/g, label: "callAIJSON (must use Gateway)" },
];

const ALLOWED_FILES = [
  "_shared/ai-client.ts",
  "ai-healthcheck/index.ts",
  "generate-image/index.ts",
  "ai-generation-gateway/index.ts",
];

/**
 * Files allowed to use callAIWithFailover / callAIJSON directly.
 * These are either the shared wrapper itself, or legacy producers that
 * have not yet been migrated to the Gateway.
 *
 * When migrating a function to the Gateway, REMOVE it from this list.
 */
const PHASE2_ALLOWED_FILES = [
  "_shared/ai-client.ts",
  "_shared/lesson-gen/llm-runner.ts",
  "ai-healthcheck/index.ts",
  "generate-image/index.ts",
  "ai-generation-gateway/index.ts",
  // Legacy — scheduled for Gateway migration:
  "create-song-texts/index.ts",
  "package-generate-lesson-minichecks/index.ts",
  "enrich-mfa-competencies/index.ts",
  "compliance-council-remediate/index.ts",
  "elite-hardening/index.ts",
  "generate-questions/index.ts",
];

const violations = [];
const phase2Violations = [];

for (const f of files) {
  const txt = fs.readFileSync(f, "utf8");

  // Phase 1: Direct provider fetch (hard block)
  if (!ALLOWED_FILES.some(a => f.endsWith(a))) {
    for (const { regex, label } of PATTERNS) {
      regex.lastIndex = 0;
      if (regex.test(txt)) {
        violations.push({ file: f, label });
      }
    }
  }

  // Phase 2: callAI wrapper usage outside Gateway-approved modules
  if (!PHASE2_ALLOWED_FILES.some(a => f.endsWith(a))) {
    for (const { regex, label } of PHASE2_PATTERNS) {
      regex.lastIndex = 0;
      if (regex.test(txt)) {
        phase2Violations.push({ file: f, label });
      }
    }
  }
}

let exitCode = 0;

if (violations.length) {
  console.error("\n❌ Phase 1 — Direct LLM Fetch Guard: bypasses detected!\n");
  console.error("All LLM calls MUST go through callAI/callAIWithFailover in _shared/ai-client.ts.\n");
  for (const v of violations) {
    console.error(`  - ${v.file}: ${v.label}`);
  }
  console.error("\nFix: refactor to use the shared ai-client wrapper.\n");
  exitCode = 1;
}

if (phase2Violations.length) {
  console.error("\n❌ Phase 2 — Gateway Bypass Guard: direct callAI usage detected!\n");
  console.error("New functions MUST use the AI Generation Gateway instead of callAIWithFailover/callAIJSON.\n");
  console.error("If this is a legacy function, add it to PHASE2_ALLOWED_FILES in the guard script.\n");
  for (const v of phase2Violations) {
    console.error(`  - ${v.file}: ${v.label}`);
  }
  exitCode = 1;
}

if (exitCode) process.exit(exitCode);

console.log("✅ No direct LLM fetch bypasses detected.");
console.log(`   Phase 2: ${PHASE2_ALLOWED_FILES.length - 3} legacy functions still allowed (pending Gateway migration).`);
