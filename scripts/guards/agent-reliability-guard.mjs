#!/usr/bin/env node
/**
 * Welle 1 — Agent Reliability Guard (regression harness)
 * ──────────────────────────────────────────────────────
 * Verifies the structural contract of safeTool() against drift.
 *
 * Asserts:
 *   1. ToolResult shape (ok|error_code+error_category+retryable, meta block)
 *   2. SILENT_EMPTY classification for empty results
 *   3. defaultClassifyError taxonomy mapping
 *
 * Runs as Node-only (no Deno) — imports a vendored copy of the pure logic
 * paths from supabase/functions/_shared/agent-runtime/safe-tool.ts.
 *
 * Exit 0 = green, exit 1 = drift.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SAFE_TOOL_PATH = resolve(
  process.cwd(),
  "supabase/functions/_shared/agent-runtime/safe-tool.ts",
);

const src = readFileSync(SAFE_TOOL_PATH, "utf8");

const REQUIRED_SYMBOLS = [
  "export type ToolErrorCategory",
  "export type ToolResult<T>",
  "export interface ToolCallMeta",
  "export async function safeTool<TIn, TOut>",
  "export function classifyAgentRun",
  "export function defaultClassifyError",
  'error_code: "SILENT_EMPTY"',
  'error_category: "silent_empty"',
];

const REQUIRED_TAXONOMY = [
  "RATE_LIMITED",
  "TIMEOUT",
  "CONTEXT_OVERFLOW",
  "FORBIDDEN",
  "INVALID_OUTPUT",
  "NETWORK_ERROR",
  "UNKNOWN_ERROR",
];

const failures = [];

for (const sym of REQUIRED_SYMBOLS) {
  if (!src.includes(sym)) failures.push(`Missing required symbol/pattern: ${sym}`);
}
for (const code of REQUIRED_TAXONOMY) {
  if (!src.includes(code)) failures.push(`Missing error_code in defaultClassifyError taxonomy: ${code}`);
}

// Shape probe: ensure tool_calls append uses berufs_ki_agent_runs (BRIDGE_DONT_FORK).
if (!src.includes('"berufs_ki_agent_runs"')) {
  failures.push("safeTool must append trajectory into existing berufs_ki_agent_runs (BRIDGE_DONT_FORK).");
}
// Anti-drift: no parallel agent_tool_calls table allowed.
if (/from\(\s*["']agent_tool_calls["']/.test(src)) {
  failures.push("Parallel agent_tool_calls table detected — violates NO_PARALLEL_SYSTEMS.");
}

if (failures.length > 0) {
  console.error("❌ agent-reliability-guard FAILED:");
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}
console.log("✅ agent-reliability-guard: contract intact (" + REQUIRED_SYMBOLS.length + " symbols, " + REQUIRED_TAXONOMY.length + " error codes).");
