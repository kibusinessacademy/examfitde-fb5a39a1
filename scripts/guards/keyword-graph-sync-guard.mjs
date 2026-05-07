#!/usr/bin/env node
/**
 * Growth OS Phase 3 — Keyword Registry <-> Content Graph Sync Guard (warn-only).
 *
 * Reads:
 *   - admin_check_keyword_graph_sync()
 *
 * Metrics:
 *   - nodes_with_keyword_slug
 *   - keywords_registered
 *   - missing_keyword_registry
 *   - keyword_owner_mismatch
 *   - duplicate_active_keyword_owner
 *   - ok_count
 *
 * Default warn-only (exit 0). Thresholds via env:
 *   - TH_MISSING_KEYWORD_REGISTRY        (default 0)
 *   - TH_KEYWORD_OWNER_MISMATCH          (default 0)
 *   - TH_DUPLICATE_ACTIVE_KEYWORD_OWNER  (default 0)
 *
 * STRICT=1 → exit 1 on breach. No DB writes. No auto-fix.
 */

const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  process.env.VITE_SUPABASE_URL ||
  'https://ubdvvvsiryenhrfmqsvw.supabase.co';

const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

const STRICT = process.env.STRICT === '1';

const TH = {
  MISSING_KEYWORD_REGISTRY: Number(process.env.TH_MISSING_KEYWORD_REGISTRY ?? 0),
  KEYWORD_OWNER_MISMATCH: Number(process.env.TH_KEYWORD_OWNER_MISMATCH ?? 0),
  DUPLICATE_ACTIVE_KEYWORD_OWNER: Number(process.env.TH_DUPLICATE_ACTIVE_KEYWORD_OWNER ?? 0),
};

if (!SERVICE_KEY) {
  console.warn('[keyword-graph-sync-guard] SUPABASE_SERVICE_ROLE_KEY missing – skipping (warn-only).');
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
    const result = await rpc('admin_check_keyword_graph_sync');
    const m = result?.metrics || {};
    const samples = result?.samples || {};

    console.log('=== Keyword Graph Sync ===');
    console.log(JSON.stringify(m, null, 2));

    const breaches = [];
    if ((m.missing_keyword_registry ?? 0) > TH.MISSING_KEYWORD_REGISTRY) {
      breaches.push(`missing_keyword_registry ${m.missing_keyword_registry} > ${TH.MISSING_KEYWORD_REGISTRY}`);
    }
    if ((m.keyword_owner_mismatch ?? 0) > TH.KEYWORD_OWNER_MISMATCH) {
      breaches.push(`keyword_owner_mismatch ${m.keyword_owner_mismatch} > ${TH.KEYWORD_OWNER_MISMATCH}`);
    }
    if ((m.duplicate_active_keyword_owner ?? 0) > TH.DUPLICATE_ACTIVE_KEYWORD_OWNER) {
      breaches.push(
        `duplicate_active_keyword_owner ${m.duplicate_active_keyword_owner} > ${TH.DUPLICATE_ACTIVE_KEYWORD_OWNER}`,
      );
    }

    if (breaches.length === 0) {
      console.log('\n✅ Keyword Graph in sync.');
      process.exit(0);
    }

    console.warn('\n⚠️  Sync drift detected:');
    for (const b of breaches) console.warn(`  - ${b}`);

    console.warn('\nSamples (top 10 each):');
    console.warn(JSON.stringify(samples, null, 2));

    if (STRICT) {
      console.error('\n[STRICT] failing build.');
      process.exit(1);
    }
    console.log('\n[warn-only] no failure raised. Set STRICT=1 to enforce.');
    process.exit(0);
  } catch (e) {
    console.warn('[keyword-graph-sync-guard] error (warn-only):', e.message);
    process.exit(0);
  }
})();
