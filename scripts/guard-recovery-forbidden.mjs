#!/usr/bin/env node
/**
 * CI Guard — forbid hard mutations of the Publish-Gate in pipelineRecovery/*
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOTS = [
  "src/lib/pipelineRecovery",
  "supabase/functions/_shared/pipelineRecovery",
];

const FORBIDDEN_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: "integrity_passed assignment", re: /integrity_passed\s*[:=]\s*true/i },
  { name: "council_approved assignment", re: /council_approved\s*[:=]\s*true/i },
  { name: "is_published assignment", re: /is_published\s*[:=]\s*true/i },
  { name: "direct course_packages.update", re: /\.from\(['"]course_packages['"]\)\s*\.update/ },
];

function walk(p: string, out: string[] = []): string[] {
  let st;
  try { st = statSync(p); } catch { return out; }
  if (st.isDirectory()) for (const f of readdirSync(p)) walk(join(p, f), out);
  else if (/\.(ts|tsx|mjs|js)$/.test(p)) out.push(p);
  return out;
}

let failures = 0;
for (const root of ROOTS) {
  for (const file of walk(root)) {
    const txt = readFileSync(file, "utf8");
    for (const { name, re } of FORBIDDEN_PATTERNS) {
      if (re.test(txt)) {
        console.error(`✖ ${file}: forbidden pattern → ${name}`);
        failures++;
      }
    }
  }
}

if (failures > 0) {
  console.error(`\nguard-recovery-forbidden: ${failures} violation(s)`);
  process.exit(1);
}
console.log("guard-recovery-forbidden: OK");
