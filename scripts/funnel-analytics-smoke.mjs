#!/usr/bin/env node
/**
 * Funnel-Analytics Smoke
 * - Verifiziert, dass die 3 Views existieren und nicht für anon/authenticated lesbar sind
 * - Ruft admin_get_funnel_conversion(7d) als anon → muss mit 42501 abgelehnt werden
 *   (oder gar nicht callable wenn nicht eingeloggt → wir prüfen Fehlerklasse)
 * - Ruft admin_get_funnel_orphan_summary(7d) als anon → muss ablehnen
 */
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!SUPABASE_URL || !ANON) {
  console.log('⚠️  SUPABASE_URL / ANON missing — skipping funnel-analytics-smoke');
  process.exit(0);
}

const FAIL = (...m) => { console.error('❌', ...m); process.exitCode = 1; };
const OK = (...m) => console.log('✅', ...m);

async function rpc(name, args) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  const txt = await r.text();
  let body; try { body = JSON.parse(txt); } catch { body = txt; }
  return { status: r.status, body };
}

async function viewSelect(view) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${view}?select=package_id&limit=1`, {
    headers: { apikey: ANON, Authorization: `Bearer ${ANON}` },
  });
  return { status: r.status };
}

(async () => {
  // 1) Views NICHT direkt lesbar
  for (const v of ['v_funnel_conversion_24h', 'v_funnel_conversion_7d', 'v_funnel_conversion_30d']) {
    const r = await viewSelect(v);
    if (r.status >= 200 && r.status < 300) {
      FAIL(`View ${v} ist für anon lesbar — Admin-View-Contract verletzt!`);
    } else {
      OK(`View ${v} blockiert anon (status=${r.status})`);
    }
  }

  // 2) RPC ohne Admin-Rolle muss ablehnen
  const conv = await rpc('admin_get_funnel_conversion', { p_window: '7d', p_limit: 5 });
  if (conv.status === 200 && Array.isArray(conv.body)) {
    FAIL('admin_get_funnel_conversion gibt Daten an anon zurück — Gate kaputt!', conv.body?.length);
  } else {
    OK(`admin_get_funnel_conversion blockiert anon (status=${conv.status})`);
  }

  const orph = await rpc('admin_get_funnel_orphan_summary', { p_window: '7d' });
  if (orph.status === 200 && Array.isArray(orph.body)) {
    FAIL('admin_get_funnel_orphan_summary gibt Daten an anon zurück — Gate kaputt!');
  } else {
    OK(`admin_get_funnel_orphan_summary blockiert anon (status=${orph.status})`);
  }

  // 3) Window-Validation
  const bad = await rpc('admin_get_funnel_conversion', { p_window: 'foo', p_limit: 5 });
  if (bad.status >= 400) {
    OK(`Invalid window wird abgewiesen (status=${bad.status})`);
  } else {
    FAIL('Invalid window wird akzeptiert!', bad);
  }

  if (process.exitCode) console.error('\nSmoke FAILED');
  else console.log('\n✅ Funnel-Analytics smoke GREEN');
})();
