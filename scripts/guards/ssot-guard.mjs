#!/usr/bin/env node
/**
 * SSOT Guard: Block direct Supabase .from() reads in client/frontend code.
 * All DB access must go through Edge Functions / server layer.
 */
import fs from "node:fs";
import path from "node:path";
import { globSync } from "glob";

const ROOT = process.cwd();
const FRONT_GLOBS = [
  "src/**/*.{ts,tsx,js,jsx}",
];

const ALLOWLIST_PATTERNS = [
  "/integrations/supabase/",
  "/supabase/functions/",
  "/edge/",
  "/server/",
  "/api/",
  "/hooks/use",       // React Query hooks that wrap supabase calls are OK
  "/lib/supabase",    // centralized supabase helpers
  "/test/",
  ".test.",
  ".spec.",
];

const FORBIDDEN = [
  { needle: ".from(", context: "Direct table read via .from()" },
];

function isAllowlisted(file) {
  const p = file.replaceAll("\\", "/");
  return ALLOWLIST_PATTERNS.some(a => p.includes(a));
}

let violations = [];

for (const g of FRONT_GLOBS) {
  for (const file of globSync(g, { nodir: true })) {
    if (isAllowlisted(file)) continue;
    const txt = fs.readFileSync(path.join(ROOT, file), "utf8");
    for (const { needle, context } of FORBIDDEN) {
      if (txt.includes(needle)) {
        // Check it's actually a supabase call, not e.g. Array.from()
        if (needle === ".from(" && !txt.includes("supabase")) continue;
        violations.push({ file, context });
      }
    }
  }
}

if (violations.length) {
  console.error("\n❌ SSOT Guard: direct Supabase access detected in client code.\n");
  for (const v of violations.slice(0, 40)) {
    console.error(`  - ${v.file}  (${v.context})`);
  }
  console.error("\nFix: move DB reads to Edge Functions / server layer. No client table reads.\n");
  process.exit(1);
}

console.log("✅ SSOT Guard passed.");
