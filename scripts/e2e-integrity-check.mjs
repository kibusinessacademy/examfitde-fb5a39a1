#!/usr/bin/env node
/**
 * E2E Pipeline Integrity Smoke
 * Source: public.v_platform_integrity (e2e_pipeline_status)
 *
 * Fail (exit 1):
 *   - e2e_pipeline_status === 'red'   (mind. 1 nicht auto-heilbarer Drift)
 *   - View fehlt
 * Warn (exit 0):
 *   - e2e_pipeline_status === 'yellow'
 *
 * Auth: bevorzugt SUPABASE_SERVICE_ROLE_KEY; ohne Permission → skip.
 */
const URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  || process.env.SUPABASE_ANON_KEY
  || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!URL || !KEY) { console.log("⚠️  SUPABASE_URL / KEY not set — skipping"); process.exit(0); }

async function get(path) {
  const r = await fetch(`${URL}/rest/v1/${path}`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, Accept: "application/json" },
  });
  const t = await r.text();
  let b; try { b = JSON.parse(t); } catch { b = t; }
  return { status: r.status, body: b };
}

const FAIL = (...m) => console.error("❌", ...m);
const OK = (...m) => console.log("✅", ...m);
const WARN = (...m) => console.warn("⚠️ ", ...m);
const INFO = (...m) => console.log("•", ...m);

(async () => {
  const r = await get("v_platform_integrity?select=*&limit=1");
  if (r.status === 404) { FAIL("v_platform_integrity missing — migration not applied"); process.exit(1); }
  const msg = JSON.stringify(r.body || "").toLowerCase();
  if (r.status === 401 || msg.includes("permission denied")) {
    console.log("⚠️  No permission (anon) — skipping. Provide SUPABASE_SERVICE_ROLE_KEY in CI.");
    process.exit(0);
  }
  if (r.status >= 400 || !Array.isArray(r.body) || !r.body[0]) { FAIL("unexpected response", r); process.exit(1); }
  const row = r.body[0];

  INFO(`platform=${row.platform_status}  e2e=${row.e2e_pipeline_status}  ` +
    `red=${row.e2e_red_count}  yellow=${row.e2e_yellow_count}  green=${row.e2e_green_count}  ` +
    `auto_healable=${row.e2e_auto_healable_count}  manual=${row.e2e_manual_count}`);

  if (row.e2e_pipeline_status === "red") {
    FAIL(`E2E pipeline RED — ${row.e2e_manual_count} package(s) need manual review`);
    process.exit(1);
  }
  if (row.e2e_pipeline_status === "yellow") { WARN("E2E pipeline YELLOW — drift detected"); process.exit(0); }
  OK("E2E pipeline GREEN");
})().catch(e => { FAIL("unexpected", e?.message || e); process.exit(1); });
