#!/usr/bin/env node
/**
 * Edge Import Guard: Block forbidden remote imports in Edge Functions.
 * All deps must use npm: specifier — no esm.sh, deno.land/x, skypack.
 */
import fs from "node:fs";
import { globSync } from "glob";

const files = globSync([
  "supabase/functions/**/*.{ts,js}",
], { nodir: true });

const FORBIDDEN = [
  { pattern: "https://esm.sh/", label: "esm.sh" },
  { pattern: "skypack.dev", label: "skypack" },
];

// Allow: deno.land/std (standard lib is OK), jsr: imports
const ALLOWLIST = [
  "jsr:@supabase/functions-js",
  "https://deno.land/std",
];

let bad = [];

for (const f of files) {
  const txt = fs.readFileSync(f, "utf8");
  for (const { pattern, label } of FORBIDDEN) {
    if (txt.includes(pattern)) {
      // Check if it's in an allowlisted context
      const isAllowed = ALLOWLIST.some(a => txt.includes(a) && pattern === a);
      if (!isAllowed) {
        bad.push({ f, label });
      }
    }
  }
}

if (bad.length) {
  console.error("\n❌ Edge Import Guard: forbidden remote imports detected.\n");
  for (const b of bad.slice(0, 40)) console.error(`  - ${b.f} contains ${b.label} import`);
  console.error("\nFix: use npm: imports (e.g. npm:@supabase/supabase-js@2.45.4). No remote URLs.\n");
  process.exit(1);
}

console.log("✅ Edge Import Guard passed.");
