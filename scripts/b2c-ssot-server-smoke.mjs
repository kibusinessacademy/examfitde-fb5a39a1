#!/usr/bin/env node
/**
 * B2C SSOT Server-Smoke (CI-Gate, Live-Mode-sicher)
 * --------------------------------------------------
 * Ruft die b2c-ssot-smoke Edge Function via service-role auf.
 *
 * Modi (env SMOKE_MODES, default "single,bundle,refund"):
 *   - single: 1 product → 7 Artefakte + Replay-Idempotenz
 *   - bundle: N products in 1 Order → N grants, N entitlements, 1 invoice
 *   - refund: paid order → fn_revoke_grant_on_refund → grants/ents revoked + audit
 *
 * Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 * Optional env: SMOKE_USER_ID, SMOKE_PRODUCT_ID, SMOKE_CLEANUP=true, SMOKE_MODES=...
 *
 * Exit 0 = alle Modi grün, Exit 1 = mind. 1 Failure.
 */
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const MODES = (process.env.SMOKE_MODES || 'single,bundle,refund,access_e2e')
  .split(',').map((s) => s.trim()).filter(Boolean);

const baseBody = {
  user_id: process.env.SMOKE_USER_ID || null,
  product_id: process.env.SMOKE_PRODUCT_ID || null,
  cleanup: process.env.SMOKE_CLEANUP === 'true',
};

async function runMode(mode) {
  const body = { ...baseBody, mode };
  if (mode === 'access_e2e') {
    if (process.env.SMOKE_ACCESS_DROP_ENTITLEMENT === 'true') body.drop_entitlement = true;
    if (process.env.SMOKE_ACCESS_DRIFT_DENY !== 'false') body.assert_drift_denies = true;
  }
  console.log(`\n[server-smoke] === MODE: ${mode} ===`);
  const res = await fetch(`${SUPABASE_URL}/functions/v1/b2c-ssot-smoke`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${SERVICE_KEY}`,
      apikey: SERVICE_KEY,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); }
  catch {
    console.error(`[server-smoke:${mode}] non-JSON response:`, text);
    return { ok: false, mode, http: res.status };
  }
  console.log(`[server-smoke:${mode}] response:`, JSON.stringify(json, null, 2));

  const failures = json.failures || [];
  if (mode === 'single') {
    const required = ['order_items','invoices','invoice_items','payments','ledger_entries','learner_course_grants','entitlements'];
    const checks = json.checks || {};
    const missing = required.filter((k) => (checks[k] ?? 0) < 1);
    if (missing.length) failures.push(`missing artefacts: ${missing.join(',')}`);
  }
  if (mode === 'access_e2e') {
    const b = json.baseline || {};
    const feats = ['learning_course','exam_trainer','ai_tutor','oral_trainer'];
    for (const f of feats) if (b[f] !== true) failures.push(`access ${f}!=true`);
    if (b?.tutor?.allowed !== true) failures.push(`tutor allowed!=true (reason=${b?.tutor?.reason})`);
    if (b?.tutor?.reason === 'no_entitlement') failures.push(`tutor reason=no_entitlement`);
    if (b?.storage !== true) failures.push(`storage!=true`);
    if (b?.product !== true) failures.push(`product!=true`);
    // Optional drift-deny assertion (when SMOKE_ACCESS_DRIFT_DENY=true)
    if (json.drift_denied) {
      const d = json.drift_denied;
      for (const f of feats) if (d[f] !== false) failures.push(`drift_deny ${f} expected=false got=${d[f]}`);
      if (d?.tutor?.allowed === true) failures.push(`drift_deny tutor still allowed`);
      if (d?.storage !== false) failures.push(`drift_deny storage expected=false`);
      if (d?.product !== false) failures.push(`drift_deny product expected=false`);
    }
  }
  return { ok: json.ok && failures.length === 0, mode, failures, order_id: json.order_id };
}

const results = [];
for (const mode of MODES) {
  results.push(await runMode(mode));
}

console.log('\n[server-smoke] === SUMMARY ===');
let anyFail = false;
for (const r of results) {
  const tag = r.ok ? '✅' : '❌';
  console.log(`${tag} ${r.mode}  order=${r.order_id || '-'}  failures=${(r.failures||[]).join('|') || 'none'}`);
  if (!r.ok) anyFail = true;
}
process.exit(anyFail ? 1 : 0);
