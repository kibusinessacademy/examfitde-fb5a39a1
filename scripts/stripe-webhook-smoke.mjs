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
const SUPABASE_URL = (process.env.SUPABASE_URL || "").trim();
const SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();

const RED = "\x1b[31m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

const missing = [];
if (!SUPABASE_URL) missing.push("SUPABASE_URL");
else if (!/^https:\/\/[a-z0-9]+\.supabase\.co\/?$/i.test(SUPABASE_URL)) {
  console.error(`${RED}${BOLD}✗ SUPABASE_URL hat ungültiges Format${RESET}`);
  console.error(`  ${DIM}Erwartet: https://<project-ref>.supabase.co${RESET}`);
  console.error(`  ${DIM}Erhalten: ${SUPABASE_URL.slice(0, 60)}${RESET}`);
  process.exit(1);
}
if (!SERVICE_KEY) missing.push("SUPABASE_SERVICE_ROLE_KEY");
else if (SERVICE_KEY.length < 40) {
  console.error(`${RED}${BOLD}✗ SUPABASE_SERVICE_ROLE_KEY ist verdächtig kurz${RESET} (${SERVICE_KEY.length} chars)`);
  console.error(`  ${DIM}Erwartet: JWT (eyJ…) oder sb_secret_… mit mind. 40 Zeichen${RESET}`);
  process.exit(1);
}

if (missing.length > 0) {
  console.error(`\n${RED}${BOLD}✗ stripe-webhook-smoke: Pflicht-Secrets fehlen${RESET}\n`);
  for (const name of missing) {
    console.error(`  ${RED}✗ ${name}${RESET} ${DIM}— nicht gesetzt oder leer${RESET}`);
  }
  console.error(`\n${BOLD}So fixen:${RESET}`);
  console.error(`  1. Lovable Cloud → Backend → Project Settings → API Keys`);
  console.error(`     - Project URL    → ${BOLD}SUPABASE_URL${RESET} (oder Fallback ${BOLD}VITE_SUPABASE_URL${RESET})`);
  console.error(`     - service_role   → ${BOLD}SUPABASE_SERVICE_ROLE_KEY${RESET} ${DIM}(NIE mit VITE_ prefixen!)${RESET}`);
  console.error(`  2. GitHub → Repo → Settings → Secrets and variables → Actions → New repository secret`);
  console.error(`  3. Workflow re-run\n`);
  console.error(`${DIM}Hinweis: Der validate-db-secrets Step davor sollte das bereits abfangen.`);
  console.error(`Wenn dieser Fehler hier auftritt, ist das YAML-env-Mapping im Workflow defekt.${RESET}\n`);
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
