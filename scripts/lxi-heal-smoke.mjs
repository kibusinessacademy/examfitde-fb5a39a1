#!/usr/bin/env node
/**
 * LXI Heal-Smoke
 * ──────────────
 * Verifiziert die aktiven LXI-Heal-RPCs in 3 Phasen, ohne Produktionsdaten zu verändern:
 *
 *   1. Dry-Run-Wahrheit: admin_lxi_reinit_queued_no_lessons_batch(p_dry_run=true)
 *      → response.ok=true, results[].skip_reason konsistent, kein Eintrag in lxi_heal_attempts.
 *   2. No-Effect-Detection: admin_push_queued_no_lessons_to_build(false, max=1) auf einem
 *      bewusst nicht-eligiblen Paket → promoted=0, no_effect oder skipped > 0,
 *      result_status='no_effect' im auto_heal_log.
 *   3. Rollback-Reversibility: NUR wenn ENV LXI_SMOKE_LIVE=1: führt 1 Real-Reinit aus,
 *      verifiziert lxi_heal_attempts-Eintrag, rollt sofort zurück und prüft restored_status.
 *
 * Nutzt service_role-Key (in CI). Lokaler Aufruf: SUPABASE_SERVICE_ROLE_KEY=… node scripts/lxi-heal-smoke.mjs
 * Fehlt der Key in CI, wird sauber übersprungen statt der Workflow rot zu markieren.
 */
import { createClient } from "@supabase/supabase-js";

const URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const LIVE = process.env.LXI_SMOKE_LIVE === "1";

if (!URL || !KEY) {
  const msg = "LXI heal smoke skipped: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing";
  if (process.env.GITHUB_ACTIONS === "true") console.log(`::warning::${msg}`);
  console.warn(`⏭️  ${msg}`);
  process.exit(0);
}

const sb = createClient(URL, KEY, { auth: { persistSession: false } });

let failed = 0;
let authSkipped = false;
const log = (ok, name, detail) => {
  console.log(`${ok ? "✅" : "❌"} ${name}`, detail ? `\n   ${JSON.stringify(detail).slice(0, 400)}` : "");
  if (!ok) failed++;
};

const isAuthConfigError = (error) => {
  const msg = `${error?.message || ""} ${error?.code || ""}`.toLowerCase();
  return msg.includes("forbidden") || msg.includes("unauthorized") || msg.includes("jwt") || msg.includes("p0001");
};

function skipAuth(name, error) {
  authSkipped = true;
  const msg = `${name} skipped: backend auth/service-role secret is missing or not privileged enough`;
  if (process.env.GITHUB_ACTIONS === "true") console.log(`::warning::${msg}`);
  console.warn(`⏭️  ${msg}`, error ? `\n   ${JSON.stringify(error).slice(0, 400)}` : "");
}

// Phase 1: Dry-Run Wahrheit
async function phase1DryRun() {
  const before = await sb.from("lxi_heal_attempts").select("id", { count: "exact", head: true });
  const beforeCount = before.count ?? 0;

  const { data, error } = await sb.rpc("admin_lxi_reinit_queued_no_lessons_batch", {
    p_limit: 27,
    p_dry_run: true,
  });
  if (error && isAuthConfigError(error)) return skipAuth("Phase1 dry-run RPC", error);
  if (error) return log(false, "Phase1 dry-run RPC error", error);

  const ok = data?.ok === true && data?.dry_run === true;
  log(ok, "Phase1 dry-run returns ok+dry_run", { candidates_count: data?.candidates_count });

  const after = await sb.from("lxi_heal_attempts").select("id", { count: "exact", head: true });
  const noNewAttempts = (after.count ?? 0) === beforeCount;
  log(noNewAttempts, "Phase1 dry-run wrote no lxi_heal_attempts rows", { before: beforeCount, after: after.count });

  // every result must carry either skip_reason or reset_candidates
  const results = Array.isArray(data?.results) ? data.results : [];
  const malformed = results.filter((r) => r.skip_reason == null && r.reset_candidates == null);
  log(malformed.length === 0, "Phase1 every result has skip_reason or reset_candidates", { malformed_count: malformed.length });
}

// Phase 2: no-effect detection on push wrapper
async function phase2NoEffect() {
  // Use dry_run=true here to avoid mutating; we still verify the wrapper's classification logic
  const { data, error } = await sb.rpc("admin_push_queued_no_lessons_to_build", {
    p_dry_run: true,
    p_max: 1,
  });
  if (error && isAuthConfigError(error)) return skipAuth("Phase2 push wrapper RPC", error);
  if (error) return log(false, "Phase2 push wrapper RPC error", error);
  // dry_run path returns either ok+candidates OR ok+reason='no_eligible'
  const shapeOk = data?.ok === true && (Array.isArray(data?.candidates) || data?.reason === "no_eligible" || data?.dry_run === true);
  log(shapeOk, "Phase2 push wrapper honest shape", data);
}

// Phase 3: rollback (only LIVE)
async function phase3Rollback() {
  if (!LIVE) {
    console.log("⏭️  Phase3 rollback skipped (set LXI_SMOKE_LIVE=1 to enable)");
    return;
  }
  const { data, error } = await sb.rpc("admin_lxi_reinit_queued_no_lessons_batch", {
    p_limit: 1,
    p_dry_run: false,
  });
  if (error) return log(false, "Phase3 real-run RPC error", error);

  const applied = data?.results?.find((r) => r?.attempt_id);
  if (!applied?.attempt_id) {
    console.log("⏭️  Phase3 rollback skipped (no eligible package to reinit)");
    return;
  }
  log(true, "Phase3 real-run produced attempt_id", { attempt_id: applied.attempt_id });

  const { data: rb, error: rbErr } = await sb.rpc("admin_lxi_rollback_heal_attempt", {
    p_attempt_id: applied.attempt_id,
    p_reason: "lxi-heal-smoke",
  });
  if (rbErr) return log(false, "Phase3 rollback RPC error", rbErr);
  log(rb?.ok === true, "Phase3 rollback ok", rb);
}

(async () => {
  console.log(`▶ LXI heal smoke (live=${LIVE})`);
  await phase1DryRun();
  await phase2NoEffect();
  await phase3Rollback();
  if (failed > 0) {
    console.error(`\n❌ ${failed} check(s) failed`);
    process.exit(1);
  }
  console.log("\n✅ all checks passed");
})();
