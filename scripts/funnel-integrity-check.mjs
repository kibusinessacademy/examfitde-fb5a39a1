#!/usr/bin/env node

/**
 * Funnel Integrity Regression Guard
 *
 * Source of truth: public.v_funnel_integrity_check (7-Tage-Fenster).
 *
 * Fail-Modi (Exit 1):
 *   - status === 'red'  (mind. eine Sub-Ampel rot)
 *   - View fehlt
 *
 * Warn-Modi (Exit 0, Console-Warning):
 *   - status === 'yellow'
 *
 * Auth: bevorzugt SUPABASE_SERVICE_ROLE_KEY. Skip wenn Anon (kein RLS-Zugriff).
 */

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.log("⚠️  SUPABASE_URL / SUPABASE_*_KEY not set — skipping funnel-integrity-check");
  process.exit(0);
}

async function restGet(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      Accept: "application/json",
    },
  });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
}

function isPermissionDenied(body) {
  if (!body || typeof body !== "object") return false;
  const code = body.code || body.error_code;
  const msg = (body.message || body.msg || "").toString().toLowerCase();
  return code === "42501" || msg.includes("permission denied");
}

const FAIL = (...m) => console.error("❌", ...m);
const WARN = (...m) => console.warn("⚠️ ", ...m);
const OK = (...m) => console.log("✅", ...m);
const INFO = (...m) => console.log("•", ...m);

async function main() {
  const r = await restGet("v_funnel_integrity_check?select=*&limit=1");

  if (r.status === 404) {
    FAIL("View v_funnel_integrity_check missing — Migration nicht angewandt");
    process.exit(1);
  }
  if (isPermissionDenied(r.body) || r.status === 401) {
    console.log("⚠️  No permission for v_funnel_integrity_check (anon key) — skipping. Provide SUPABASE_SERVICE_ROLE_KEY in CI.");
    process.exit(0);
  }
  if (r.status >= 400 || !Array.isArray(r.body)) {
    FAIL("Unexpected response:", r);
    process.exit(1);
  }
  const row = r.body[0];
  if (!row) { FAIL("v_funnel_integrity_check returned no rows"); process.exit(1); }

  INFO(
    `Status=${row.status}  events_7d=${row.events_total_7d}  ` +
    `tracking=${row.tracking_completeness_status}(${row.tracking_completeness_pct}%)  ` +
    `continuity=${row.funnel_continuity_status}  ` +
    `attribution=${row.attribution_quality_status}  ` +
    `[lead_magnet=${row.s1_lead_magnet} quiz_started=${row.s2_quiz_started} quiz_complete=${row.s3_quiz_completed} lead_capture=${row.s4_lead_capture} checkout=${row.s5_checkout}]`
  );

  if (row.status === "red") {
    FAIL("Funnel integrity RED — mind. eine Sub-Ampel rot");
    if (row.tracking_completeness_status === "red") FAIL(`  • tracking_completeness=${row.tracking_completeness_pct}% (<50%)`);
    if (row.funnel_continuity_status === "red") FAIL(`  • funnel_continuity: Pflicht-Event fehlt`);
    if (row.attribution_quality_status === "red") FAIL(`  • attribution_quality: source/persona <50%`);
    process.exit(1);
  }
  if (row.status === "yellow") {
    WARN("Funnel integrity YELLOW — Drift, aber nicht kritisch");
    process.exit(0);
  }
  OK("Funnel integrity GREEN");
}

main().catch((err) => { FAIL("Unexpected error:", err?.message || err); process.exit(1); });
