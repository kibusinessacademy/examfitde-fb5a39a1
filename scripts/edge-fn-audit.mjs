#!/usr/bin/env node
/**
 * Orphan Edge-Function Audit
 *
 * Scans supabase/functions/* and counts external references in:
 *   - src/                     (UI invokes via supabase.functions.invoke('name') or fetch)
 *   - supabase/functions/      (function-to-function via invoke / fetch / functions/v1/)
 *   - supabase/migrations/     (cron jobs / SQL net.http_post calls)
 *
 * Self-references inside the function's own folder are excluded.
 * Functions with ref_count == 0 are reported as orphan candidates.
 *
 * Snapshots written via admin_record_orphan_function RPC (service_role).
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 * Args: --dry  (no DB write, prints JSON summary to stdout)
 */
import { readdirSync, statSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';

const DRY = process.argv.includes('--dry');
const SUPABASE_URL = process.env.SUPABASE_URL;
const SR_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const FN_DIR = 'supabase/functions';
if (!existsSync(FN_DIR)) {
  console.error(`[edge-fn-audit] ${FN_DIR} not found`);
  process.exit(2);
}

// Discover function names (skip _shared and any leading-underscore folder)
const functions = readdirSync(FN_DIR).filter((name) => {
  if (name.startsWith('_') || name.startsWith('.')) return false;
  try {
    return statSync(join(FN_DIR, name)).isDirectory();
  } catch {
    return false;
  }
});

function countRefs(name, scopes) {
  // Match: 'name', "name", `name`, /name(/|$|?), name (whole-word)
  // Use fixed-string + word boundary via -F -w; for path/quoted matches, also do plain string.
  let total = 0;
  for (const scope of scopes) {
    if (!existsSync(scope.path)) continue;
    try {
      const out = execSync(
        `rg --no-messages --count-matches --no-filename ${scope.glob ?? ''} ${JSON.stringify(name)} ${scope.path}`,
        { encoding: 'utf-8' },
      );
      total += out.split('\n').filter(Boolean).reduce((s, n) => s + (parseInt(n, 10) || 0), 0);
    } catch {
      /* no matches */
    }
  }
  return total;
}

const rows = [];
for (const name of functions) {
  // Search src/ and migrations/ — and supabase/functions/ but exclude own folder.
  const own = join(FN_DIR, name);
  const otherFns = `--glob '${FN_DIR}/!(${name})/**'`;
  const refs =
    countRefs(name, [{ path: 'src' }]) +
    countRefs(name, [{ path: 'supabase/migrations' }]) +
    countRefs(name, [{ path: FN_DIR, glob: otherFns }]);
  rows.push({ function_name: name, ref_count: refs, orphan: refs === 0, own_path: own });
}

const orphans = rows.filter((r) => r.orphan);
console.log(JSON.stringify({
  scanned: rows.length,
  orphan_count: orphans.length,
  orphans: orphans.map((o) => o.function_name),
}, null, 2));

if (DRY) process.exit(orphans.length > 0 ? 0 : 0);

if (!SUPABASE_URL || !SR_KEY) {
  console.error('[edge-fn-audit] missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — skip DB write');
  process.exit(0);
}

let written = 0;
for (const r of rows) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/admin_record_orphan_function`, {
    method: 'POST',
    headers: {
      apikey: SR_KEY,
      Authorization: `Bearer ${SR_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      p_function_name: r.function_name,
      p_ref_count: r.ref_count,
      p_notes: r.orphan ? 'orphan' : null,
    }),
  });
  if (!res.ok) {
    console.error(`[edge-fn-audit] RPC failed ${r.function_name}: ${res.status} ${await res.text().catch(() => '')}`);
  } else {
    written++;
  }
}
console.log(`[edge-fn-audit] wrote ${written}/${rows.length} snapshot rows`);
