#!/usr/bin/env node
/**
 * Phase 2B Content Graph Smoke Runner.
 * Executes _smoke_growth_content_graph() via service_role and fails CI on fail>0.
 */
const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://ubdvvvsiryenhrfmqsvw.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SERVICE_KEY) {
  console.warn('[content-graph-smoke] SUPABASE_SERVICE_ROLE_KEY missing – skipping (warn-only).');
  process.exit(0);
}

(async () => {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/_smoke_growth_content_graph`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: '{}',
  });
  const txt = await res.text();
  if (!res.ok) {
    console.error(`[content-graph-smoke] RPC error ${res.status}: ${txt}`);
    process.exit(1);
  }
  let result;
  try { result = JSON.parse(txt); } catch { result = { raw: txt }; }
  console.log('=== Content Graph Smoke (T1–T7) ===');
  console.log(`pass: ${result.pass}`);
  console.log(`fail: ${result.fail}`);
  console.log('failures:', JSON.stringify(result.failures || [], null, 2));
  if ((result.fail ?? 1) > 0) {
    console.error('\n❌ Smoke FAILED – blocking.');
    process.exit(1);
  }
  console.log('\n✅ All 7 acceptance tests green.');
  process.exit(0);
})().catch((e) => { console.error('[content-graph-smoke] crash:', e); process.exit(1); });
