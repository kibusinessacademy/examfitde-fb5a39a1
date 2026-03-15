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

for (const f of files) {
  if (ALLOWED_FILES.some(a => f.endsWith(a))) continue;

  const txt = fs.readFileSync(f, "utf8");
  for (const { regex, label } of PATTERNS) {
    regex.lastIndex = 0;
    if (regex.test(txt)) {
      violations.push({ file: f, label });
    }
  }
}

if (violations.length) {
  console.error("\n❌ Direct LLM Fetch Guard: bypasses detected!\n");
  console.error("All LLM calls MUST go through callAI/callAIWithFailover in _shared/ai-client.ts.\n");
  for (const v of violations) {
    console.error(`  - ${v.file}: ${v.label}`);
  }
  console.error("\nFix: refactor to use the shared ai-client wrapper.\n");
  process.exit(1);
}

console.log("✅ No direct LLM fetch bypasses detected.");
