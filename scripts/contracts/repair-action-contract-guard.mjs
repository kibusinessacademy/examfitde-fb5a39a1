#!/usr/bin/env node
/**
 * Repair Action Contract Guard
 * ────────────────────────────
 * Failt CI bei freien Strings für recommended_action / repair_action / payload.action,
 * die nicht in src/contracts/repairActions.ts deklariert sind.
 *
 * Scope:
 *  - src/**\/*.{ts,tsx}
 *  - supabase/functions/**\/*.ts
 *  - supabase/migrations/**\/*.sql (CASE branches, IN-Listen, CHECK constraints)
 *
 * Erlaubte Werte: REPAIR_ACTIONS values + REPAIR_ACTION_ALIASES (bis Stichtag).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

function loadRegistry() {
  const src = readFileSync('src/contracts/repairActions.ts', 'utf8');
  const canonical = new Set(
    [...src.matchAll(/['"]([a-z_]+)['"]/g)]
      .map((m) => m[1])
      .filter((s) => /^[a-z][a-z_]*$/.test(s) && s.length > 4)
  );
  const aliasBlock = src.match(/REPAIR_ACTION_ALIASES[^}]+\}/s)?.[0] ?? '';
  const aliases = new Set([...aliasBlock.matchAll(/(\w+):\s*REPAIR_ACTIONS/g)].map((m) => m[1]));
  const expires = src.match(/ALIAS_EXPIRES_AT\s*=\s*'([^']+)'/)?.[1];
  return { canonical, aliases, expires };
}

function walk(dir, exts, out = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const e of entries) {
    const p = join(dir, e);
    if (p.includes('node_modules') || p.includes('dist') || p.includes('.git')) continue;
    const s = statSync(p);
    if (s.isDirectory()) walk(p, exts, out);
    else if (exts.some((x) => p.endsWith(x))) out.push(p);
  }
  return out;
}

const { canonical, aliases, expires } = loadRegistry();
const aliasesActive = expires && new Date(expires).getTime() > Date.now();

// Strict: only match contexts where the literal is unambiguously an action.
// Avoids false positives on column names like repair_active, repair_attempts.
const PATTERNS = [
  // TS/SQL: recommended_action / repair_action assignment
  /\b(?:recommended_action|repair_action)\s*[:=]\s*['"]([a-z_]+)['"]/g,
  // TS: payload.action === '...'
  /payload\.action\s*===?\s*['"]([a-z_]+)['"]/g,
  // SQL: WHEN 'repair_xxx' THEN ...
  /\bWHEN\s+'(repair_[a-z_]+|enqueue_[a-z_]+_repair)'\s+THEN/g,
  // SQL: IN ('repair_xxx' ...) — only treat as action when other action-y values neighbor
  /\bIN\s*\(\s*'(repair_lf_coverage|repair_exam_pool_quality|repair_exam_pool_competency_coverage|repair_lessons|repair_handbook|repair_oral_exam|repair_minichecks|enqueue_lf_coverage_repair)'/g,
];

const allowSelf = ['src/contracts/repairActions.ts', 'scripts/contracts/repair-action-contract-guard.mjs'];

const files = [
  ...walk('src', ['.ts', '.tsx']),
  ...walk('supabase/functions', ['.ts']),
  ...walk('supabase/migrations', ['.sql']),
];

let fails = 0;
let expiredAliasHits = 0;

for (const f of files) {
  if (allowSelf.includes(f)) continue;
  const txt = readFileSync(f, 'utf8');
  for (const re of PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(txt)) !== null) {
      const value = m[1];
      if (!value) continue;
      if (canonical.has(value)) continue;
      if (aliases.has(value)) {
        if (!aliasesActive) {
          console.error(`✗ EXPIRED ALIAS '${value}' in ${f}`);
          expiredAliasHits++;
        }
        continue;
      }
      console.error(`✗ UNKNOWN repair action '${value}' in ${f}`);
      fails++;
    }
  }
}

if (fails || expiredAliasHits) {
  console.error(`\n✗ repair-action-contract-guard FAILED: ${fails} unknown + ${expiredAliasHits} expired alias hits.`);
  console.error(`  Add to src/contracts/repairActions.ts (or remove expired alias).`);
  process.exit(1);
}
console.log(`✓ repair-action-contract-guard OK (${canonical.size} canonical, ${aliases.size} aliases${aliasesActive ? '' : ' [EXPIRED]'}).`);
