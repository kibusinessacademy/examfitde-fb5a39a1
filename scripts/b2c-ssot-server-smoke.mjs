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

// Pfad C: canonical mode is `complete` (formerly `bundle`). `bundle` still
// works as deprecated alias and emits a warning audit.
const MODES = (process.env.SMOKE_MODES || 'single,complete,refund,access_e2e')
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

/**
 * Post-Purchase Delivery Assurance v1 — SLA 2 min.
 * Polls orders.delivery_status via PostgREST (service-role) up to 150s
 * (worker + SLA cron run every 2 min). Pass = delivery_status='confirmed'.
 */
async function assertDeliveryConfirmed(orderId, mode, { timeoutMs = 150_000, intervalMs = 5_000 } = {}) {
  if (!orderId) return { ok: true, mode, skipped: true, reason: 'no_order_id' };
  const url = `${SUPABASE_URL}/rest/v1/orders?id=eq.${orderId}&select=delivery_status,delivery_blocking_reasons,delivery_confirmed_at,status`;
  const headers = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    const res = await fetch(url, { headers });
    const rows = await res.json().catch(() => []);
    last = Array.isArray(rows) && rows[0] ? rows[0] : null;
    if (last?.delivery_status === 'confirmed') {
      const elapsed = Math.round((timeoutMs - (deadline - Date.now())) / 1000);
      console.log(`[delivery:${mode}] ✅ confirmed in ~${elapsed}s order=${orderId}`);
      return { ok: true, mode, order_id: orderId, delivery_status: 'confirmed', elapsed_s: elapsed };
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  console.error(`[delivery:${mode}] ❌ NOT confirmed within ${timeoutMs/1000}s — last=`, last);
  return {
    ok: false,
    mode,
    order_id: orderId,
    failures: [`delivery_not_confirmed_within_${timeoutMs/1000}s status=${last?.delivery_status ?? 'null'} reasons=${(last?.delivery_blocking_reasons ?? []).join('|')}`],
  };
}

const results = [];
for (const mode of MODES) {
  results.push(await runMode(mode));
}

// Post-Purchase Delivery Assurance v1 — assert delivery_confirmed for single+bundle modes.
// Skipped automatically when SMOKE_SKIP_DELIVERY_ASSERT=true (e.g. CI in cold-start).
if (process.env.SMOKE_SKIP_DELIVERY_ASSERT !== 'true') {
  for (const r of results) {
    if (!r.ok) continue;
    if (!['single', 'complete', 'bundle'].includes(r.mode)) continue;
    const dr = await assertDeliveryConfirmed(r.order_id, r.mode);
    if (!dr.ok) {
      r.ok = false;
      r.failures = [...(r.failures || []), ...(dr.failures || [])];
    } else if (!dr.skipped) {
      r.delivery_elapsed_s = dr.elapsed_s;
    }
  }
}

console.log('\n[server-smoke] === SUMMARY ===');
let anyFail = false;
for (const r of results) {
  const tag = r.ok ? '✅' : '❌';
  console.log(`${tag} ${r.mode}  order=${r.order_id || '-'}  failures=${(r.failures||[]).join('|') || 'none'}`);
  if (!r.ok) anyFail = true;
}
process.exit(anyFail ? 1 : 0);
