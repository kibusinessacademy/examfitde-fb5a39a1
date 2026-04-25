#!/usr/bin/env node
/**
 * Codemod: replace `Record<string, unknown>` payloads passed to Supabase
 * `.update(...)` calls with the typed `TablesUpdate<'<table>'>` helper.
 *
 * Strategy (intentionally conservative, regex-based — no AST rewrites):
 *   1. Scan all `src/**\/*.{ts,tsx}` files.
 *   2. Detect TWO shapes:
 *      a) Top-level: `const X: Record<string, unknown> = ...`
 *         used in `.from('<table>').update(X` (allow `as never`).
 *      b) Nested: `const X = { ..., data: <Record<…>>, ... }` where the
 *         OUTER object literal field that ends up in `.update(...)` is
 *         typed `Record<string, unknown>`. We rewrite the field annotation
 *         only — never the surrounding scaffolding.
 *   3. Skip non-Supabase objects: only rewrite when a `.from('<table>')`
 *      / `.update(<varName>)` chain exists in the SAME file with matching
 *      identifier, OR when the inline annotation literally appears inside
 *      a `.update({ ... })` call argument.
 *   4. Remove `as never` casts on the `.update(X as never)` call site.
 *
 * Run:
 *   node scripts/codemod-record-update.mjs            # dry run
 *   node scripts/codemod-record-update.mjs --write    # apply changes
 *   node scripts/codemod-record-update.mjs --test     # run regression fixtures
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APPLY = process.argv.includes('--write');
const TEST = process.argv.includes('--test');

/**
 * Pure transform: given a file's source, return the transformed source plus
 * a list of edits performed. Exported for fixture-based regression testing.
 */
export function transform(src) {
  const original = src;
  const edits = [];

  // -------- Pass 1: top-level `const X: Record<string, unknown> = …` --------
  const decls = [...src.matchAll(
    /const\s+(\w+):\s*Record<string,\s*unknown>\s*=/g,
  )];

  for (const m of decls) {
    const varName = m[1];
    const tableMatch = src.match(
      new RegExp(
        String.raw`\.from\(['"]([\w_]+)['"]\)[\s\S]{0,200}?\.update\(\s*${varName}\b`,
      ),
    );
    if (!tableMatch) continue; // Not used in a Supabase update — skip.
    const table = tableMatch[1];

    src = src.replace(
      m[0],
      `const ${varName}: TablesUpdate<'${table}'> =`,
    );
    src = src.replace(
      new RegExp(String.raw`\.update\(\s*${varName}\s+as\s+never\s*\)`, 'g'),
      `.update(${varName})`,
    );
    edits.push({ kind: 'top-level', varName, table });
  }

  // -------- Pass 2: nested `data: { ... } as Record<string, unknown>` --------
  // We rewrite annotations that sit DIRECTLY inside an `.update({ ... })`
  // argument expression. Conservative: only when we can attribute the call
  // to a `.from('<table>')` chain in the same statement window.
  const updateCalls = [...src.matchAll(
    /\.from\(['"]([\w_]+)['"]\)[\s\S]{0,400}?\.update\(\s*\{([\s\S]*?)\}\s*\)/g,
  )];
  for (const u of updateCalls) {
    const table = u[1];
    const body = u[2];
    // Look for `: Record<string, unknown>` annotations on inline fields.
    if (!/Record<string,\s*unknown>/.test(body)) continue;
    const newBody = body.replace(
      /(\b\w+)\s*:\s*([\s\S]+?)\s+as\s+Record<string,\s*unknown>/g,
      (_w, key, inner) => `${key}: ${inner} as TablesUpdate<'${table}'>['${key}']`,
    );
    if (newBody === body) continue;
    src = src.replace(u[0], u[0].replace(body, newBody));
    edits.push({ kind: 'nested', table });
  }

  // -------- Ensure TablesUpdate import if any edit happened --------
  if (edits.length > 0 && !/TablesUpdate/.test(src)) {
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

  return { src, edits, changed: src !== original };
}

// ------------------------- Regression fixtures -------------------------

const FIXTURES = [
  {
    name: 'top-level Record → TablesUpdate',
    input: [
      `import { supabase } from '@/integrations/supabase/client';`,
      `const payload: Record<string, unknown> = { name: 'x' };`,
      `await supabase.from('users').update(payload as never).eq('id', 1);`,
    ].join('\n'),
    expectContains: [
      `const payload: TablesUpdate<'users'> = { name: 'x' };`,
      `.update(payload).eq('id', 1);`,
      `TablesUpdate`,
    ],
    expectNotContains: [`as never`, `Record<string, unknown>`],
  },
  {
    name: 'leaves non-Supabase Record alone',
    input: [
      `const cache: Record<string, unknown> = {};`,
      `localStorage.setItem('k', JSON.stringify(cache));`,
    ].join('\n'),
    expectContains: [`Record<string, unknown>`],
    expectNotContains: [`TablesUpdate`],
  },
  {
    name: 'nested inline cast inside .update()',
    input: [
      `import { supabase } from '@/integrations/supabase/client';`,
      `await supabase.from('settings').update({ data: ({ a: 1 } as Record<string, unknown>) });`,
    ].join('\n'),
    expectContains: [
      `data: ({ a: 1 }) as TablesUpdate<'settings'>['data']`,
    ],
    expectNotContains: [`as Record<string, unknown>`],
  },
  {
    name: 'leaves random object literal alone',
    input: [
      `const opts = { foo: 'bar' as Record<string, unknown> };`,
      `// no supabase here`,
    ].join('\n'),
    expectContains: [`as Record<string, unknown>`],
    expectNotContains: [`TablesUpdate`],
  },
];

function runTests() {
  let pass = 0, fail = 0;
  for (const f of FIXTURES) {
    const { src } = transform(f.input);
    const okContains = f.expectContains.every((s) => src.includes(s));
    const okMissing = f.expectNotContains.every((s) => !src.includes(s));
    if (okContains && okMissing) {
      console.log(`  ✓ ${f.name}`);
      pass++;
    } else {
      console.error(`  ✗ ${f.name}`);
      console.error('    --- output ---');
      console.error(src.split('\n').map((l) => '    ' + l).join('\n'));
      fail++;
    }
  }
  console.log(`\n${pass}/${pass + fail} fixtures passed.`);
  process.exit(fail === 0 ? 0 : 1);
}

if (TEST) {
  runTests();
} else {
  // ------------------------- CLI execution -------------------------
  const files = execSync(
    "rg -l 'Record<string, unknown>' src --glob '*.{ts,tsx}'",
    { encoding: 'utf8' },
  )
    .split('\n')
    .filter(Boolean);

  let totalEdits = 0;
  const report = [];
  for (const file of files) {
    const orig = readFileSync(file, 'utf8');
    const { src, edits, changed } = transform(orig);
    if (changed && APPLY) writeFileSync(file, src);
    if (changed) {
      totalEdits += edits.length;
      for (const e of edits) {
        report.push(
          `  ${file}: ${e.kind === 'top-level'
            ? `${e.varName} → TablesUpdate<'${e.table}'>`
            : `nested cast → TablesUpdate<'${e.table}'>['…']`}`,
        );
      }
    }
  }
  console.log(report.join('\n'));
  console.log(
    `\n${APPLY ? 'Applied' : 'Would apply'} ${totalEdits} edit(s) across ${files.length} candidate file(s).`,
  );
  if (!APPLY) console.log('Re-run with --write to apply, or --test for fixtures.');
}
