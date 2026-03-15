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

const ALLOWED_FILES = [
  "_shared/ai-client.ts",
  "ai-healthcheck/index.ts",
  "generate-image/index.ts",
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
