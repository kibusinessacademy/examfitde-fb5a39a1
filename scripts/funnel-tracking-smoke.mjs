#!/usr/bin/env node

/**
 * Funnel Tracking Smoke Test
 * --------------------------------------------------------------
 * Verifiziert, dass das Tracking nicht umgangen werden kann:
 *  1) RPC track_conversion_event_v2 lehnt strict events OHNE package_id mit 22023 ab.
 *  2) RPC akzeptiert strict events MIT package_id (via Param) und schreibt sie.
 *  3) Edge Function track-funnel-event lehnt strict events OHNE package_id mit 400 ab.
 *
 * Auth: bevorzugt SUPABASE_SERVICE_ROLE_KEY. Skip wenn keine Keys vorhanden.
 */

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const KEY = SERVICE_KEY || ANON_KEY;

if (!SUPABASE_URL || !KEY) {
  console.log("⚠️  SUPABASE_URL / KEY missing — skipping funnel-tracking-smoke");
  process.exit(0);
}

const FAIL = (...m) => console.error("❌", ...m);
const OK = (...m) => console.log("✅", ...m);
const INFO = (...m) => console.log("•", ...m);

const STRICT_EVENTS = ["quiz_started", "quiz_completed", "lead_capture_submitted", "checkout_complete"];
const FAKE_PKG = "00000000-0000-0000-0000-000000000001";

async function callRpc(args) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/track_conversion_event_v2`, {
    method: "POST",
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(args),
  });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
}

async function callEdge(body) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/track-funnel-event`, {
    method: "POST",
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  return { status: res.status, body: parsed };
}

let failures = 0;

async function main() {
  // 1) RPC strict events MUST reject without package_id
  for (const evt of STRICT_EVENTS) {
    const r = await callRpc({
      p_event_type: evt,
      p_anonymous_id: `smoke-${Date.now()}`,
      p_session_id: "smoke",
    });
    const msg = JSON.stringify(r.body).toLowerCase();
    if (r.status >= 400 && (msg.includes("package_id required") || msg.includes("22023"))) {
      OK(`RPC rejects ${evt} without package_id (status=${r.status})`);
    } else {
      FAIL(`RPC accepted ${evt} without package_id — VALIDATION BYPASS!`, r);
      failures++;
    }
  }

  // 2) RPC accepts strict event WITH package_id (via param)
  const r2 = await callRpc({
    p_event_type: "quiz_started",
    p_package_id: FAKE_PKG,
    p_anonymous_id: `smoke-${Date.now()}`,
    p_session_id: "smoke",
    p_persona: "azubi",
    p_source_page: "/smoke",
  });
  if (r2.status === 200 && typeof r2.body === "string") {
    OK(`RPC accepts quiz_started with package_id (id=${r2.body.slice(0, 8)}…)`);
  } else {
    FAIL("RPC rejected valid quiz_started + package_id", r2);
    failures++;
  }

  // 3) Edge function strict events MUST reject without package_id
  for (const evt of ["quiz_started", "lead_capture_submitted"]) {
    const r = await callEdge({
      event_type: evt,
      anonymous_id: `smoke-${Date.now()}`,
      session_id: "smoke",
    });
    if (r.status === 400 && JSON.stringify(r.body).includes("package_id_required_for_event")) {
      OK(`Edge rejects ${evt} without package_id (400)`);
    } else {
      FAIL(`Edge accepted ${evt} without package_id — VALIDATION BYPASS!`, r);
      failures++;
    }
  }

  if (failures > 0) {
    FAIL(`${failures} bypass(es) detected`);
    process.exit(1);
  }
  INFO("All tracking validation gates enforced.");
  OK("Funnel tracking smoke GREEN");
}

main().catch((e) => { FAIL("Unexpected error:", e?.message || e); process.exit(1); });
