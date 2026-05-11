#!/usr/bin/env node
/**
 * Cron-Drift Guard
 * ──────────────────────────────────────────────────────────────────
 * Blocks pg_cron jobs whose command references `current_setting('app.settings.…')`.
 *
 * Background: 2026-05-11 standstill — 9 cron jobs broke because they used
 *   `current_setting('app.settings.supabase_url', true)`
 * which returns NULL when the GUC is not configured (the typical case for
 * Lovable Cloud projects). The fix is to hardcode the URL + bearer-anon-key
 * directly in the cron command. This guard prevents the regression.
 *
 * Soft-skip if no DB credentials in env (local dev).
 */

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;

if (!url || !key) {
  console.warn("[cron-drift-guard] SKIP — SUPABASE_URL / SERVICE_ROLE_KEY not set.");
  process.exit(0);
}

async function rpc(fn, body = {}) {
  const res = await fetch(`${url}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${fn} → ${res.status} ${await res.text()}`);
  return res.json();
}

const rows = await rpc("admin_list_cron_drift_candidates").catch(() => null);

if (!rows) {
  console.warn("[cron-drift-guard] admin_list_cron_drift_candidates RPC missing — guard inactive.");
  process.exit(0);
}

const offenders = (rows ?? []).filter((r) => r.is_drift === true);

if (offenders.length) {
  console.error(`❌ Cron-Drift Guard FAILED — ${offenders.length} jobs use app.settings.* (broken on prod):`);
  for (const o of offenders) {
    console.error(`  - jobid=${o.jobid} jobname=${o.jobname}`);
    console.error(`    snippet: ${(o.command ?? "").slice(0, 160)}`);
  }
  process.exit(1);
}

console.log(`✅ Cron-Drift Guard OK (${rows.length} cron jobs scanned, 0 drift).`);
