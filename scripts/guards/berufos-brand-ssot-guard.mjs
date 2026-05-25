#!/usr/bin/env node
/**
 * BerufOS Brand-SSOT Guard.
 *
 * Verbietet Hardcoded "BerufOS"-Strings außerhalb der SSOT-Dateien.
 * Erlaubt: src/lib/berufos/**, src/components/berufos/**, src/pages/BerufOSHub.tsx,
 * src/pages/berufos/**, supabase/functions/berufos-*/**, scripts/guards/berufos-*,
 * .lovable/memory/**, Markdown-Docs.
 *
 * Warn-only in Phase 1. Hard-fail erst nach Bridge-Migration.
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const ALLOW_PATTERNS = [
  /^src\/lib\/berufos\//,
  /^src\/components\/berufos\//,
  /^src\/pages\/BerufOSHub\.tsx$/,
  /^src\/pages\/berufos\//,
  /^supabase\/functions\/berufos-/,
  /^scripts\/guards\/berufos-/,
  /^\.lovable\//,
  /\.md$/,
  /^docs\//,
];

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", ".git", "dist", "build", "coverage"].includes(entry.name)) continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|js|jsx)$/.test(entry.name)) out.push(p);
  }
  return out;
}

const files = walk(path.join(ROOT, "src")).concat(
  fs.existsSync(path.join(ROOT, "supabase/functions"))
    ? walk(path.join(ROOT, "supabase/functions"))
    : [],
);

let warns = 0;
for (const file of files) {
  const rel = path.relative(ROOT, file);
  if (ALLOW_PATTERNS.some((p) => p.test(rel))) continue;
  const content = fs.readFileSync(file, "utf8");
  // Match "BerufOS" as standalone token, ignore inside comments-only lines is fine
  const matches = content.match(/\bBerufOS\b/g);
  if (matches && matches.length > 0) {
    console.warn(`⚠️  ${rel}: ${matches.length}× hardcoded "BerufOS" — please import from @/lib/berufos/brand`);
    warns += matches.length;
  }
}

if (warns > 0) {
  console.warn(`\n⚠️  BerufOS SSOT-Guard: ${warns} warnings (non-blocking in Phase 1)`);
} else {
  console.log("✅ BerufOS SSOT-Guard passed");
}
process.exit(0);
