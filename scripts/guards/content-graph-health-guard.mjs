#!/usr/bin/env node
/**
 * Growth OS Phase 2H – Content Graph Health Guard (warn-only).
 *
 * Reads:
 *   - admin_get_content_graph_summary()
 *   - admin_get_content_graph_orphans()
 *
 * Computes:
 *   - nodes_total, edges_total, orphan_count
 *   - missing_money_page, missing_funnel_next
 *   - orphan_rate (orphan_count / nodes_total)
 *
 * Warn thresholds (default warn-only, exit 0):
 *   - orphan_rate          > 0.50
 *   - missing_money_page   > 0
 *   - missing_funnel_next  > 20
 *
 * STRICT=1 → exit 1 when any threshold is breached.
 * No DB writes.
 */

const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  process.env.VITE_SUPABASE_URL ||
  'https://ubdvvvsiryenhrfmqsvw.supabase.co';

const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

const STRICT = process.env.STRICT === '1';

const TH = {
  ORPHAN_RATE: Number(process.env.TH_ORPHAN_RATE ?? 0.5),
  MISSING_MONEY_PAGE: Number(process.env.TH_MISSING_MONEY_PAGE ?? 0),
  MISSING_FUNNEL_NEXT: Number(process.env.TH_MISSING_FUNNEL_NEXT ?? 20),
};

if (!SERVICE_KEY) {
  console.warn('[content-graph-health-guard] SUPABASE_SERVICE_ROLE_KEY missing – skipping (warn-only).');
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

function num(v, fb = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}

(async () => {
  try {
    const [summary, orphansResult] = await Promise.all([
      rpc('admin_get_content_graph_summary'),
      rpc('admin_get_content_graph_orphans'),
    ]);

    const orphans = orphansResult?.orphans || [];

    // Summary shape is permissive — try common keys with fallbacks.
    const nodes_total = num(
      summary?.nodes_total ?? summary?.total_nodes ?? summary?.nodes ?? 0,
    );
    const edges_total = num(
      summary?.edges_total ?? summary?.total_edges ?? summary?.edges ?? 0,
    );

    let missing_money_page = 0;
    let missing_funnel_next = 0;
    for (const o of orphans) {
      if (o.missing_money_page) missing_money_page++;
      if (o.missing_funnel_next) missing_funnel_next++;
    }
    const orphan_count = orphans.length;
    const orphan_rate = nodes_total > 0 ? orphan_count / nodes_total : 0;

    const metrics = {
      nodes_total,
      edges_total,
      orphan_count,
      missing_money_page,
      missing_funnel_next,
      orphan_rate: Number(orphan_rate.toFixed(4)),
    };

    console.log('=== Content Graph Health ===');
    console.log(JSON.stringify(metrics, null, 2));

    const breaches = [];
    if (orphan_rate > TH.ORPHAN_RATE) {
      breaches.push(
        `orphan_rate ${(orphan_rate * 100).toFixed(1)}% > ${(TH.ORPHAN_RATE * 100).toFixed(0)}%`,
      );
    }
    if (missing_money_page > TH.MISSING_MONEY_PAGE) {
      breaches.push(`missing_money_page ${missing_money_page} > ${TH.MISSING_MONEY_PAGE}`);
    }
    if (missing_funnel_next > TH.MISSING_FUNNEL_NEXT) {
      breaches.push(`missing_funnel_next ${missing_funnel_next} > ${TH.MISSING_FUNNEL_NEXT}`);
    }

    if (breaches.length === 0) {
      console.log('\n✅ All health thresholds within limits.');
      process.exit(0);
    }

    console.warn('\n⚠️  Threshold breaches:');
    for (const b of breaches) console.warn(`  - ${b}`);

    if (STRICT) {
      console.error('\n[STRICT] failing build.');
      process.exit(1);
    }
    console.log('\n[warn-only] no failure raised. Set STRICT=1 to enforce.');
    process.exit(0);
  } catch (e) {
    console.warn('[content-graph-health-guard] error (warn-only):', e.message);
    process.exit(0);
  }
})();
