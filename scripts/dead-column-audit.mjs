import { existsSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const DRY = process.argv.includes('--dry');
const fileArg = process.argv.find(a => a.startsWith('--file='));
const CAND_FILE = fileArg ? fileArg.split('=')[1] : 'scripts/dead-column-candidates.json';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SR_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!existsSync(CAND_FILE)) {
  console.error(`[dead-column-audit] candidates file missing: ${CAND_FILE}`);
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
    return out.split('\n').filter(Boolean).reduce((s, n) => s + (parseInt(n, 10) || 0), 0);
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
    const txt = await r.text().catch(() => '');
    throw new Error(`[dead-column-audit] RPC failed ${row.table}.${row.column}: ${r.status} ${txt}`);
  }
}

const rows = [];

for (const { table, column } of candidates) {
  const row = {
    table,
    column,
    ref_db: rg(column, 'supabase'),
    ref_edge: rg(column, 'supabase/functions'),
    ref_ui: rg(column, 'src'),
  };

  rows.push(row);
  await recordRow(row);
}

console.table(rows);

const unsafe = rows.filter(r => r.ref_db > 0 || r.ref_edge > 0 || r.ref_ui > 0);

if (unsafe.length > 0) {
  console.error(`[dead-column-audit] ${unsafe.length} candidate(s) still referenced.`);
  process.exit(1);
}

console.log('[dead-column-audit] all candidates appear safe.');
