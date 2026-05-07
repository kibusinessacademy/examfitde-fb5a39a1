#!/usr/bin/env node
/**
 * Growth OS Phase 2B – Content Graph Orphan Guard (warn-only).
 *
 * Calls admin_get_content_graph_orphans() and reports nodes that are
 * missing inbound, outbound, funnel_next or money_page edges.
 *
 * Exit code is always 0 in warn-only mode (set STRICT=1 to fail on orphans).
 */

const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  process.env.VITE_SUPABASE_URL ||
  'https://ubdvvvsiryenhrfmqsvw.supabase.co';

const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

const STRICT = process.env.STRICT === '1';

if (!SERVICE_KEY) {
  console.warn('[content-graph-orphan-guard] SUPABASE_SERVICE_ROLE_KEY missing – skipping (warn-only).');
  process.exit(0);
}

async function rpc(fn, body = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`${fn} -> ${res.status} ${t}`);
  }
  return res.json();
}

(async () => {
  try {
    const summary = await rpc('admin_get_content_graph_summary');
    const orphansResult = await rpc('admin_get_content_graph_orphans');
    const orphans = orphansResult?.orphans || [];

    console.log('=== Content Graph Summary ===');
    console.log(JSON.stringify(summary, null, 2));
    console.log(`\n=== Orphans: ${orphans.length} ===`);

    const byReason = {
      missing_inbound: 0,
      missing_outbound: 0,
      missing_funnel_next: 0,
      missing_money_page: 0,
    };
    for (const o of orphans) {
      for (const k of Object.keys(byReason)) if (o[k]) byReason[k]++;
    }
    console.log('Counts:', byReason);

    for (const o of orphans.slice(0, 25)) {
      const flags = Object.keys(byReason).filter((k) => o[k]).join(',');
      console.log(`  [${o.asset_type}] ${o.node_slug} :: ${flags}`);
    }
    if (orphans.length > 25) console.log(`  ... +${orphans.length - 25} more`);

    if (STRICT && orphans.length > 0) {
      console.error(`\n[STRICT] ${orphans.length} orphan node(s) detected.`);
      process.exit(1);
    }
    console.log('\n[warn-only] no failure raised.');
    process.exit(0);
  } catch (e) {
    console.warn('[content-graph-orphan-guard] error (warn-only):', e.message);
    process.exit(0);
  }
})();
