#!/usr/bin/env node
/**
 * On-Deploy SSOT Payload Verification (P2)
 *
 * Runs after every migration deploy.
 * Fails CI if package_* jobs in the last 10 minutes lack mandatory SSOT fields.
 *
 * Required env for live verification: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 * Fehlt der Service-Role-Key in CI, wird sauber übersprungen statt rot zu failen.
 */
import { resolveSupabaseEnv, isAuthStatus, ciWarn } from './_lib/supabase-skip.mjs';

const SCRIPT = 'ssot-payload-on-deploy-check';
const env = resolveSupabaseEnv({ requireServiceKey: true, scriptName: SCRIPT });
if (env.skip) process.exit(0);
const URL = env.url;
const KEY = env.serviceKey;

const WINDOW_MIN = parseInt(process.env.SSOT_WINDOW_MIN || '10', 10);
const STRICT = process.env.SSOT_STRICT === '1';

async function rpc(name, body) {
  const r = await fetch(`${URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
    },
    body: JSON.stringify(body),
  });
  if (isAuthStatus(r.status)) {
    ciWarn(`${SCRIPT} → ${name} returned HTTP ${r.status} — service-role key not privileged; skipping`);
    process.exit(0);
  }
  if (!r.ok) throw new Error(`${name} HTTP ${r.status}: ${await r.text()}`);
  return r.json();
}

(async () => {
  console.log(`▶ SSOT Payload Verification (window: ${WINDOW_MIN}min, strict: ${STRICT})`);
  const v = await rpc('admin_ssot_payload_verification', { p_minutes: WINDOW_MIN });
  console.log(JSON.stringify(v, null, 2));

  const fails = {
    missing_pkg_col:     v.missing_pkg_col ?? 0,
    missing_pkg_payload: v.missing_pkg_payload ?? 0,
    missing_curriculum:  v.missing_curriculum ?? 0,
    missing_step_key:    v.missing_step_key ?? 0,
    missing_source:      v.missing_source ?? 0,
  };
  const total = v.total ?? 0;
  const failTotal = Object.values(fails).reduce((s, n) => s + n, 0);

  if (total === 0) {
    console.log('⚠ No package_* inserts in window — cannot verify producers.');
    process.exit(0);
  }

  // Critical: curriculum_id and package_id (column + payload) must always be set.
  const critical = fails.missing_pkg_col + fails.missing_pkg_payload + fails.missing_curriculum;
  if (critical > 0) {
    console.error(`✗ CRITICAL: ${critical} jobs without curriculum_id/package_id`);
    process.exit(1);
  }

  // Auto-derived fields (step_key, enqueue_source) only fail strict mode.
  if (STRICT && (fails.missing_step_key + fails.missing_source) > 0) {
    console.error(`✗ STRICT FAIL: missing step_key=${fails.missing_step_key}, source=${fails.missing_source}`);
    process.exit(1);
  }

  console.log(`✓ PASSED — total=${total}, fails=${failTotal} (auto-derived OK)`);
})();
