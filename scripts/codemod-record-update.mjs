#!/usr/bin/env node
/**
 * Codemod: replace `Record<string, unknown>` payloads passed to Supabase
 * `.update(...)` calls with the typed `TablesUpdate<'<table>'>` helper.
 *
 * Strategy (intentionally conservative, regex-based — no AST rewrites):
 *   1. Scan all `src/**\/*.{ts,tsx}` files.
 *   2. For each line that declares `const X: Record<string, unknown> = ...`
 *      AND the file later contains `supabase.from('<table>').update(X` or
 *      `.from('<table>')\n  .update(X`, rewrite the declaration to
 *      `const X: TablesUpdate<'<table>'> = ...` and ensure the
 *      `TablesUpdate` import is present.
 *   3. Also remove `as never` casts immediately following the variable in the
 *      `.update(X as never)` call.
 *
 * Run:
 *   node scripts/codemod-record-update.mjs            # dry run
 *   node scripts/codemod-record-update.mjs --write    # apply changes
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const APPLY = process.argv.includes('--write');

const files = execSync(
  "rg -l 'Record<string, unknown>' src --glob '*.{ts,tsx}'",
  { encoding: 'utf8' },
)
  .split('\n')
  .filter(Boolean);

let totalEdits = 0;
const report = [];

for (const file of files) {
  let src = readFileSync(file, 'utf8');
  const original = src;

  // Find variable declarations of shape:
  //   const NAME: Record<string, unknown> = ...
  const decls = [...src.matchAll(
    /const\s+(\w+):\s*Record<string,\s*unknown>\s*=/g,
  )];

  for (const m of decls) {
    const varName = m[1];
    // Look for `.from('<table>')...update(<varName>` (allow `as never`)
    const tableMatch = src.match(
      new RegExp(
        String.raw`\.from\(['"]([\w_]+)['"]\)[\s\S]{0,200}?\.update\(\s*${varName}\b`,
      ),
    );
    if (!tableMatch) continue;
    const table = tableMatch[1];

    // Replace declaration
    src = src.replace(
      m[0],
      `const ${varName}: TablesUpdate<'${table}'> =`,
    );
    // Remove `as never` cast on the call
    src = src.replace(
      new RegExp(String.raw`\.update\(\s*${varName}\s+as\s+never\s*\)`, 'g'),
      `.update(${varName})`,
    );
    totalEdits += 1;
    report.push(`  ${file}: ${varName} → TablesUpdate<'${table}'>`);
  }

  if (src !== original) {
    // Ensure TablesUpdate import
    if (!/TablesUpdate/.test(src)) {
      // Insert near other supabase type imports if present
      if (/from ['"]@\/integrations\/supabase\/types['"]/.test(src)) {
        src = src.replace(
          /(import\s+(?:type\s+)?\{[^}]*?)\}(\s+from\s+['"]@\/integrations\/supabase\/types['"])/,
          (_w, head, tail) => `${head}, TablesUpdate}${tail}`,
        );
      } else {
        src =
          `import type { TablesUpdate } from '@/integrations/supabase/types';\n` +
          src;
      }
    }
    if (APPLY) writeFileSync(file, src);
  }
}

console.log(report.join('\n'));
console.log(
  `\n${APPLY ? 'Applied' : 'Would apply'} ${totalEdits} edit(s) across ${files.length} candidate file(s).`,
);
if (!APPLY) console.log('Re-run with --write to apply.');
