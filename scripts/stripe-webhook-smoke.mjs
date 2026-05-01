#!/usr/bin/env node
/**
 * Stripe-Webhook Smoke (signed-event handler test)
 * ------------------------------------------------
 * Calls the stripe-webhook-smoke Edge Function with service-role.
 * That function HMAC-signs synthetic checkout.session.completed +
 * charge.refunded events with STRIPE_WEBHOOK_TEST_SECRET and verifies
 * DB side-effects (orders, learner_course_grants, entitlements, audit).
 *
 * Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 * Optional env: SMOKE_MODE=checkout|refund|both (default both), SMOKE_CLEANUP=true
 */
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const body = {
  mode: process.env.SMOKE_MODE || "both",
  cleanup: process.env.SMOKE_CLEANUP !== "false",
};

const res = await fetch(`${SUPABASE_URL}/functions/v1/stripe-webhook-smoke`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${SERVICE_KEY}`,
    apikey: SERVICE_KEY,
  },
  body: JSON.stringify(body),
});

const text = await res.text();
let json;
try { json = JSON.parse(text); }
catch {
  console.error("[webhook-smoke] non-JSON response:", text);
  process.exit(1);
}

console.log("[webhook-smoke] response:", JSON.stringify(json, null, 2));

const ok = json.ok === true && (json.results || []).every((r) => r.ok);
if (!ok) {
  const failed = (json.results || []).filter((r) => !r.ok).map((r) => `${r.mode}:${(r.failures || []).join("|")}`);
  console.error("[webhook-smoke] FAILED:", failed.join(" ; "));
  process.exit(1);
}
console.log("[webhook-smoke] ✅ all modes green");
