#!/usr/bin/env node
/**
 * CI guard: forbid `Record<string, unknown>` (or `Record<string, any>`)
 * payloads inside Supabase `.update(...)` calls.
 *
 * Detects two patterns:
 *   1. Inline:  `.update({ ... } as Record<string, unknown>)` or `as never`
 *   2. Variable: `const X: Record<string, unknown> = ...` followed in the same
 *      file by `.update(X)` or `.update(X as never)`.
 *
 * Exits non-zero on violation. Suggest using `TablesUpdate<'table'>` from
 * `@/integrations/supabase/types` (or the `updateTable()` helper in
 * `src/integrations/supabase/typedUpdate.ts`).
 */
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const files = execSync(
  "rg -l '\\.update\\(' src --glob '*.{ts,tsx}'",
  { encoding: 'utf8' },
)
  .split('\n')
  .filter(Boolean);

const violations = [];

for (const file of files) {
  const src = readFileSync(file, 'utf8');

  // Pattern A: `.update(<expr> as Record<string, unknown>)` or `as never`
  const inlineRecord = [...src.matchAll(
    /\.update\([^)]*as\s+Record<string,\s*(?:unknown|any)>[^)]*\)/g,
  )];
  for (const m of inlineRecord) {
    violations.push({
      file,
      kind: 'inline-record-cast',
      snippet: m[0].slice(0, 120),
    });
  }

  // Pattern B: variable typed Record<string, unknown> later passed to .update
  const decls = [...src.matchAll(
    /const\s+(\w+):\s*Record<string,\s*(?:unknown|any)>\s*=/g,
  )];
  for (const m of decls) {
    const varName = m[1];
    if (
      new RegExp(String.raw`\.update\(\s*${varName}\b`).test(src)
    ) {
      violations.push({
        file,
        kind: 'record-typed-update-payload',
        snippet: `const ${varName}: Record<...> = ... → .update(${varName})`,
      });
    }
  }
}

if (violations.length === 0) {
  console.log('✓ No Record<string, unknown> payloads found in Supabase .update() calls.');
  process.exit(0);
}

console.error('✗ Forbidden Record<string, unknown> in Supabase .update() calls:\n');
for (const v of violations) {
  console.error(`  [${v.kind}] ${v.file}`);
  console.error(`     ${v.snippet}`);
}
console.error(
  `\nUse TablesUpdate<'<table_name>'> from @/integrations/supabase/types,`,
);
console.error(
  `or call updateTable('<table_name>', id, payload) from src/integrations/supabase/typedUpdate.ts.`,
);
process.exit(1);
