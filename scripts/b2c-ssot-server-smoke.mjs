#!/usr/bin/env node
/**
 * B2C SSOT Server-Smoke (CI-Gate, Live-Mode-sicher)
 * --------------------------------------------------
 * Ruft die b2c-ssot-smoke Edge Function via service-role auf.
 * Diese Function:
 *   - legt eine pending Order + order_items an,
 *   - flippt sie auf paid,
 *   - lässt den DB-Trigger (trg_orders_paid_grant) Bridge ziehen
 *     (invoices, invoice_items, payments, ledger_entries,
 *      learner_course_grants, entitlements),
 *   - re-runned admin_smoke_replay_order_fulfillment für Idempotenz,
 *   - liefert checks{} + failures[] zurück.
 *
 * Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 * Optional env: SMOKE_USER_ID, SMOKE_PRODUCT_ID, SMOKE_CLEANUP=true
 *
 * Exit 0 = grün, Exit 1 = mind. 1 failure oder Artefakt fehlt.
 */
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const body = {
  user_id: process.env.SMOKE_USER_ID || null,
  product_id: process.env.SMOKE_PRODUCT_ID || null,
  cleanup: process.env.SMOKE_CLEANUP === 'true',
};

console.log('[server-smoke] invoking b2c-ssot-smoke', { body });

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
try {
  json = JSON.parse(text);
} catch {
  console.error('[server-smoke] non-JSON response:', text);
  process.exit(1);
}

console.log('[server-smoke] response:', JSON.stringify(json, null, 2));

const failures = json.failures || [];
const checks = json.checks || {};
const idemp = json.idempotency || {};

// Pflichtfelder
const required = [
  'order',
  'order_items',
  'invoices',
  'invoice_items',
  'payments',
  'ledger_entries',
  'learner_course_grants',
  'entitlements',
];

const missing = required.filter((k) => {
  const v = checks[k];
  if (typeof v === 'number') return v < 1;
  if (typeof v === 'object' && v !== null) return v.count != null ? v.count < 1 : !v.ok;
  return !v;
});

if (!json.ok || failures.length || missing.length) {
  console.error('[server-smoke] ❌ FAILED', {
    ok: json.ok,
    failures,
    missing,
  });
  process.exit(1);
}

if (idemp && idemp.ok === false) {
  console.error('[server-smoke] ❌ IDEMPOTENCY FAILED', idemp);
  process.exit(1);
}

console.log('[server-smoke] ✅ all 8 artefacts present + idempotent');
console.log('[server-smoke] order_id:', json.order_id);
process.exit(0);
