#!/usr/bin/env node

/**
 * Funnel Tracking Smoke Test (pollution-safe)
 * --------------------------------------------------------------
 * Verifiziert, dass Tracking nicht umgangen werden kann, OHNE die
 * Funnel-Integrity-Metriken zu verschmutzen.
 *
 * Härtungen:
 *  - Positive Tests verwenden eine ECHTE published course_packages.id
 *  - Alle erfolgreichen Inserts tragen metadata.smoke_test = true
 *  - v_funnel_integrity_check schließt smoke_test=true permanent aus
 *  - Best-Effort-Cleanup via admin_cleanup_smoke_conversion_events()
 *
 * Tests:
 *  1) RPC track_conversion_event_v2 lehnt strict events OHNE package_id mit 22023 ab
 *  2) RPC akzeptiert quiz_started MIT echter package_id + smoke_test marker
 *  3) Edge Function track-funnel-event lehnt strict events OHNE package_id mit 400 ab
 *
 * Auth: benötigt SUPABASE_SERVICE_ROLE_KEY (Cleanup-RPC + published-Lookup).
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
const WARN = (...m) => console.warn("⚠️ ", ...m);

const STRICT_EVENTS = ["quiz_started", "quiz_completed", "lead_capture_submitted", "checkout_complete"];

async function rest(path, init = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
}

async function callRpc(name, args) {
  return rest(`rpc/${name}`, { method: "POST", body: JSON.stringify(args) });
}

async function callEdge(body) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/track-funnel-event`, {
    method: "POST",
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  return { status: res.status, body: parsed };
}

async function getPublishedPackageId() {
  const r = await rest("course_packages?select=id&status=eq.published&limit=1");
  if (r.status !== 200 || !Array.isArray(r.body) || r.body.length === 0) {
    return null;
  }
  return r.body[0].id;
}

let failures = 0;

async function main() {
  if (!SERVICE_KEY) {
    WARN("SUPABASE_SERVICE_ROLE_KEY missing — running negative tests only (no insert/cleanup).");
  }

  const realPackageId = SERVICE_KEY ? await getPublishedPackageId() : null;
  if (SERVICE_KEY && !realPackageId) {
    FAIL("No published course_package found — cannot run positive insert test safely. Aborting.");
    process.exit(1);
  }
  if (realPackageId) INFO(`Using published package_id=${realPackageId} for positive test`);

  // 1) RPC strict events MUST reject without package_id
  for (const evt of STRICT_EVENTS) {
    const r = await callRpc("track_conversion_event_v2", {
      p_event_type: evt,
      p_anonymous_id: `smoke-${Date.now()}`,
      p_session_id: "smoke",
      p_metadata: { smoke_test: true },
    });
    const msg = JSON.stringify(r.body).toLowerCase();
    if (r.status >= 400 && (msg.includes("package_id required") || msg.includes("22023"))) {
      OK(`RPC rejects ${evt} without package_id (status=${r.status})`);
    } else {
      FAIL(`RPC accepted ${evt} without package_id — VALIDATION BYPASS!`, r);
      failures++;
    }
  }

  // 2) Positive test only with REAL published package_id + smoke_test marker
  if (realPackageId) {
    const r2 = await callRpc("track_conversion_event_v2", {
      p_event_type: "quiz_started",
      p_package_id: realPackageId,
      p_anonymous_id: `smoke-${Date.now()}`,
      p_session_id: "smoke",
      p_persona: "azubi",
      p_source_page: "/smoke",
      p_metadata: { smoke_test: true, source: "funnel-tracking-smoke.mjs" },
    });
    if (r2.status === 200 && typeof r2.body === "string") {
      OK(`RPC accepts quiz_started with real package_id (id=${r2.body.slice(0, 8)}…, smoke_test=true)`);
    } else {
      FAIL("RPC rejected valid quiz_started + real package_id", r2);
      failures++;
    }
  }

  // 3) Edge function strict events MUST reject without package_id
  for (const evt of ["quiz_started", "lead_capture_submitted"]) {
    const r = await callEdge({
      event_type: evt,
      anonymous_id: `smoke-${Date.now()}`,
      session_id: "smoke",
      metadata: { smoke_test: true },
    });
    if (r.status === 400 && JSON.stringify(r.body).includes("package_id_required_for_event")) {
      OK(`Edge rejects ${evt} without package_id (400)`);
    } else {
      FAIL(`Edge accepted ${evt} without package_id — VALIDATION BYPASS!`, r);
      failures++;
    }
  }

  // 4) Best-effort cleanup of stale smoke events (>1h)
  if (SERVICE_KEY) {
    const c = await callRpc("admin_cleanup_smoke_conversion_events", {});
    if (c.status === 200) {
      INFO(`Cleanup: deleted ${c.body} stale smoke event(s) (>1h)`);
    } else {
      WARN("Cleanup RPC failed (non-fatal):", c.status, c.body);
    }
  }

  if (failures > 0) {
    FAIL(`${failures} bypass(es) detected`);
    process.exit(1);
  }
  OK("Funnel tracking smoke GREEN (pollution-safe)");
}

main().catch((e) => { FAIL("Unexpected error:", e?.message || e); process.exit(1); });
