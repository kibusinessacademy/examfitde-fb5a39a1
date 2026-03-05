#!/usr/bin/env node
/**
 * Hard Literal Guard: Block suspicious numeric literals outside config files.
 * Numbers like 500, 1000 etc. must live in centralized config/track-mappings.
 */
import fs from "node:fs";
import { globSync } from "glob";

const files = globSync([
  "src/**/*.{ts,tsx,js,jsx}",
  "supabase/functions/**/*.{ts,js}",
], { nodir: true });

const FORBIDDEN_NUMBERS = [500, 1000, 313];

const ALLOW_FILES_CONTAINS = [
  "config/",
  "constants",
  "pipeline-graph",
  "track-mapping",
  "quality-constraints",
  "node_modules",
  ".test.",
  ".spec.",
  "test/",
  "__tests__",
  // UI components showing numbers in labels/text are OK
  "recharts",
  "Chart",
];

let hits = [];

for (const f of files) {
  const lower = f.toLowerCase().replaceAll("\\", "/");
  const allow = ALLOW_FILES_CONTAINS.some(a => lower.includes(a));
  if (allow) continue;

  const txt = fs.readFileSync(f, "utf8");
  const lines = txt.split("\n");

  for (const n of FORBIDDEN_NUMBERS) {
    const re = new RegExp(`\\b${n}\\b`);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (re.test(line)) {
        // Skip comments and string literals that are clearly UI text
        const trimmed = line.trim();
        if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) continue;
        // Skip pagination limits, HTTP status codes, timeouts
        if (trimmed.includes("status") && n === 500) continue;
        if (trimmed.includes("limit") && (n === 500 || n === 1000)) continue;
        if (trimmed.includes("timeout") || trimmed.includes("delay") || trimmed.includes("ms")) continue;

        hits.push({ f, n, line: i + 1, content: trimmed.substring(0, 100) });
      }
    }
  }
}

if (hits.length) {
  console.error("\n❌ Hard Literal Guard: suspicious numeric literals found outside config.\n");
  for (const h of hits.slice(0, 40)) {
    console.error(`  - ${h.f}:${h.line} → literal ${h.n} ("${h.content}")`);
  }
  console.error("\nFix: move these numbers into a centralized config (track mappings / constraints).\n");
  process.exit(1);
}

console.log("✅ Hard Literal Guard passed.");
