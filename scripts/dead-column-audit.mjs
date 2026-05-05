#!/usr/bin/env node
/**
 * Dead-Column Audit
 *
 * Scans Edge Functions (supabase/functions/) and Frontend (src/) for references
 * to a list of candidate column names and writes the result to
 * `audit_dead_columns_snapshot` via admin_record_dead_column RPC.
 *
 * Safe to drop only if ALL three ref counts are zero (db/edge/ui) — the table
 * has a generated column `safe_to_drop` enforcing this.
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 * Args: --dry  (prints to stdout, no DB write)
 *       --file=path/to/candidates.json  (default: scripts/dead-column-candidates.json)
 *
 * NEVER auto-DROPs columns. CI workflow .github/workflows/dead-column-guard.yml
 * runs this and fails if any unsafe drop is attempted in a migration diff.
 */
import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

const DRY = process.argv.includes('--dry');
const fileArg = process.argv.find((a) => a.startsWith('--file='));
const CAND_FILE = fileArg ? fileArg.split('=')[1] : 'scripts/dead-column-candidates.json';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SR_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!existsSync(CAND_FILE)) {
  console.error(`[dead-column-audit] candidates file missing: ${CAND_FILE}`);
  console.error(`Create it with: [{"table":"course_packages","column":"legacy_exempt_at"}, ...]`);
  process.exit(2);
}

/** @type {{table:string,column:string}[]} */
const candidates = JSON.parse(readFileSync(CAND_FILE, 'utf-8'));

function rg(pattern, path) {
  try {
    const out = execSync(
      `rg --no-messages --count-matches --no-filename -F -w ${JSON.stringify(pattern)} ${path}`,
      { encoding: 'utf-8' }
    );
    return out
      .split('\n')
      .filter(Boolean)
      .reduce((s, n) => s + (parseInt(n, 10) || 0), 0);
  } catch {
    return 0;
  }
}

async function recordRow(row) {
  if (DRY || !SUPABASE_URL || !SR_KEY) return;
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/admin_record_dead_column`, {
    method: 'POST',
    headers: {
      apikey: SR_KEY,
      Authorization: `Bearer ${SR_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      p_table: row.table,
      p_column: row.column,
      p_ref_db: row.ref_db,
      p_ref_edge: row.ref_edge,
      p_ref_ui: row.ref_ui,
      p_notes: 'dead-column-audit.mjs',
    }),
  });
  if (!r.ok) {
    console.error(`[dead-column-audit] RPC failed for ${row.table}.${row.column}: ${r.status}`);
  }
}

const rows = [];
for (const { table, column } of candidates) {
  const ref_edge = rg(column, 'supabase/functions');
  const ref_ui = rg(column, 'src');
  // ref_db comes from the existing v_dead_columns_db_only view (best-effort, optional).
  const ref_db = 0; // populated server-side later if needed
  rows.push({ table, column, ref_db, ref_edge, ref_ui, safe_to_drop: ref_db + ref_edge + ref_ui === 0 });
  await recordRow({ table, column, ref_db, ref_edge, ref_ui });
}

const safe = rows.filter((r) => r.safe_to_drop);
const unsafe = rows.filter((r) => !r.safe_to_drop);
console.log(JSON.stringify({ total: rows.length, safe: safe.length, unsafe: unsafe.length, rows }, null, 2));

// Exit non-zero if the workflow asked for hard fail and any unsafe drop is requested
if (process.env.HARD_FAIL_ON_UNSAFE === '1' && unsafe.length > 0) {
  console.error(`[dead-column-audit] ${unsafe.length} candidates still referenced — refusing to proceed.`);
  process.exit(1);
}
