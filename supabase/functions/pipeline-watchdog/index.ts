import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

async function hasRecentOpenAlert(
  sb: ReturnType<typeof createClient>,
  source: string,
  containsMessage: string,
  minutes: number,
): Promise<boolean> {
  const since = new Date(Date.now() - minutes * 60 * 1000).toISOString();
  const { data } = await sb
    .from("ops_alerts")
    .select("id")
    .eq("source", source)
    .is("acknowledged_at", null)
    .gte("created_at", since)
    .ilike("message", `%${containsMessage}%`)
    .limit(1);
  return !!(data && data.length > 0);
}

/**
 * pipeline-watchdog — Safety-net fallback (runs every 5 minutes via cron)
 *
 * The primary self-healing now happens in acquire_next_package_lease (RPC),
 * which atomically purges expired leases and reclaims orphaned packages.
 *
 * This watchdog only handles edge cases the runner can't:
 * 1. Expire stale steps (no heartbeat within timeout_seconds)
 * 2. Detect pipeline stalls (queued > 0 but nothing processing)
 * 3. Auto-resolve stall alerts when pipeline is healthy
 * 4. Final safety-net: re-queue orphaned building packages (belt-and-suspenders)
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const actions: string[] = [];

  try {
    // ── 1) Expire stale steps (heartbeat-based timeout) ──
    // SAFETY: Before expiring, verify the linked job isn't still active.
    // The RPC only expires steps in 'running' status with stale heartbeats.
    const { data: expiredSteps, error: stepErr } = await sb.rpc(
      "expire_stale_steps",
    );
    if (stepErr) {
      console.error("[watchdog] expire_stale_steps error:", stepErr.message);
    }
    const staleSteps = (expiredSteps as Array<{
      package_id: string;
      step_key: string;
      runner_id: string;
      job_id?: string;
    }>) ?? [];

    for (const s of staleSteps) {
      // Double-check: if the step has a job_id, verify the job isn't still running
      if (s.job_id) {
        const { data: job } = await sb
          .from("job_queue")
          .select("status")
          .eq("id", s.job_id)
          .maybeSingle();

        if (job && (job.status === "processing" || job.status === "pending")) {
          // Job is still alive — revert the timeout, just heartbeat it
          console.log(`[watchdog] Step ${s.step_key} timed out but job ${s.job_id.slice(0, 8)} is ${job.status} — reverting timeout`);
          await sb
            .from("package_steps")
            .update({ status: "running", last_heartbeat_at: new Date().toISOString() })
            .eq("package_id", s.package_id)
            .eq("step_key", s.step_key);
          continue;
        }
      }

      actions.push(
        `Step timeout: ${s.step_key} on pkg ${s.package_id.slice(0, 8)}`,
      );

      // FIX: Reset the timed-out step to 'queued' so the runner can re-enqueue it.
      // Previously, the step stayed in 'timeout' status and the package stayed in 'queued',
      // causing the package to be permanently stuck.
      await sb
        .from("package_steps")
        .update({
          status: "queued",
          job_id: null,
          runner_id: null,
          started_at: null,
          last_error: `Watchdog: step '${s.step_key}' timed out — auto-reset to queued`,
        })
        .eq("package_id", s.package_id)
        .eq("step_key", s.step_key);

      // Ensure the package is in 'building' so the runner picks it up
      await sb
        .from("course_packages")
        .update({
          status: "building",
          last_error: `Watchdog: step '${s.step_key}' timed out — auto-recovered`,
        })
        .eq("id", s.package_id);
    }

    // ── 2) Safety-net: purge any expired leases the runner missed ──
    const { data: expiredLeases, error: leaseErr } = await sb.rpc(
      "expire_stale_leases",
    );
    if (leaseErr) {
      console.error("[watchdog] expire_stale_leases error:", leaseErr.message);
    }
    const staleLeases = (expiredLeases as Array<{
      package_id: string;
      runner_id: string;
    }>) ?? [];

    if (staleLeases.length > 0) {
      actions.push(`Safety-net: purged ${staleLeases.length} expired leases`);
    }

    // ── 2b) Zombie job sweep: fail jobs stuck in 'processing' with no lock ──
    // Tightened to 5min — edge functions timeout at 55s,
    // so anything unlocked for 5min is definitively dead.
    // ALSO catch jobs where locked_at is stale (>20min old) even if non-null.
    // v5.3: Raised from 10→20min to match job-runner lock timeout and prevent
    // premature STALE_LOCK kills on long-running AI jobs (exam-pool, glossary).
    const ZOMBIE_AGE_MINUTES = 5;
    const STALE_LOCK_MINUTES = 20;
    const zombieCutoff = new Date(Date.now() - ZOMBIE_AGE_MINUTES * 60 * 1000).toISOString();
    const staleLockCutoff = new Date(Date.now() - STALE_LOCK_MINUTES * 60 * 1000).toISOString();

    // Type 1: Processing with NO lock at all
    const { data: zombieRows, error: zombieErr } = await sb
      .from("job_queue")
      .update({
        status: "failed",
        last_error: `Watchdog zombie sweep: processing with no lock for >${ZOMBIE_AGE_MINUTES}min`,
        updated_at: new Date().toISOString(),
      })
      .eq("status", "processing")
      .is("locked_at", null)
      .lt("updated_at", zombieCutoff)
      .select("id");

    if (zombieErr) {
      console.error("[watchdog] zombie sweep error:", zombieErr.message);
    }

    // Type 2: Processing with STALE lock (locked_at too old)
    const { data: staleLockRows, error: staleLockErr } = await sb
      .from("job_queue")
      .update({
        status: "failed",
        last_error: `Watchdog: stale lock >${STALE_LOCK_MINUTES}min`,
        locked_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("status", "processing")
      .lt("locked_at", staleLockCutoff)
      .select("id");

    if (staleLockErr) {
      console.error("[watchdog] stale lock sweep error:", staleLockErr.message);
    }

    const zombieJobCount = (zombieRows?.length ?? 0) + (staleLockRows?.length ?? 0);
    if (zombieJobCount > 0) {
      actions.push(`Zombie sweep: failed ${zombieRows?.length ?? 0} unlocked + ${staleLockRows?.length ?? 0} stale-locked jobs`);
    }

    // ── 3) Auto-heal: building without lease or jobs → reset to queued (via RPC) ──
    const { data: healedCount, error: zombieHealErr } = await sb.rpc(
      "auto_heal_building_zombies",
      { zombie_minutes: 30 },
    );
    if (zombieHealErr) {
      console.error("[watchdog] auto_heal_building_zombies error:", zombieHealErr.message);
    }
    const healedZombies = healedCount ?? 0;
    if (healedZombies > 0) {
      actions.push(`Zombie building reset: ${healedZombies} packages via RPC`);
    }

    // ── 4) QG-Failed Auto-Heal ──
    // Detect quality_gate_failed packages and reset them to building
    // with re-queued steps so the pipeline can retry after gap-closing.
    const QG_COOLDOWN_MINUTES = 60; // Don't re-heal within 60 min
    const qgCooldownCutoff = new Date(Date.now() - QG_COOLDOWN_MINUTES * 60 * 1000).toISOString();

    const { data: qgFailedPkgs } = await sb
      .from("course_packages")
      .select("id, title, integrity_report, updated_at")
      .eq("status", "quality_gate_failed")
      .lt("updated_at", qgCooldownCutoff) // Only packages that have been stuck for > cooldown
      .limit(5); // Process max 5 per cycle to avoid overload

    for (const pkg of (qgFailedPkgs || [])) {
      const report = pkg.integrity_report as any;
      const hardFails: string[] = report?.v3?.hard_fail_reasons || [];

      if (hardFails.length === 0) continue; // No known failures, skip

      // Determine which steps need re-queuing based on failure type
      const stepsToReset: string[] = [];
      let healReason = "";

      const hasLfCoverage = hardFails.some((f: string) => f.includes("LF_COVERAGE"));
      const hasPoolIssue = hardFails.some((f: string) => f.includes("EXAM_POOL") || f.includes("TOO_FEW"));

      if (hasLfCoverage || hasPoolIssue) {
        // Need more exam questions → re-queue exam pool generation + downstream
        stepsToReset.push(
          "generate_exam_pool", "validate_exam_pool",
          "build_ai_tutor_index", "validate_tutor_index",
          "generate_oral_exam", "validate_oral_exam",
          "run_integrity_check", "quality_council", "auto_publish",
        );
        healReason = hasLfCoverage ? "LF_COVERAGE_GAP" : "EXAM_POOL_INSUFFICIENT";
      } else {
        // Generic: re-queue from integrity check onwards
        stepsToReset.push("run_integrity_check", "quality_council", "auto_publish");
        healReason = "GENERIC_QG_RETRY";
      }

      // Reset the steps to queued
      for (const stepKey of stepsToReset) {
        await sb
          .from("package_steps")
          .update({
            status: "queued",
            attempts: 0,
            job_id: null,
            runner_id: null,
            started_at: null,
            last_error: `Watchdog QG-heal: reset for ${healReason}`,
          })
          .eq("package_id", pkg.id)
          .eq("step_key", stepKey);
      }

      // Reset package to building
      await sb
        .from("course_packages")
        .update({
          status: "building",
          last_error: `Watchdog QG-heal: ${healReason} — ${hardFails.length} blocker(s) → retry`,
        })
        .eq("id", pkg.id);

      // Cancel any lingering cancelled/failed jobs for this package
      // so the runner can create fresh ones
      await sb
        .from("job_queue")
        .delete()
        .eq("package_id", pkg.id)
        .in("status", ["cancelled", "failed"]);

      actions.push(
        `QG-heal: ${(pkg.title as string).slice(0, 30)} (${healReason}, reset ${stepsToReset.length} steps)`,
      );

      console.log(
        `[watchdog] QG-heal: pkg=${(pkg.id as string).slice(0, 8)} "${pkg.title}" reason=${healReason} fails=${hardFails.join("; ")}`,
      );
    }

    // ── 5) Count active state ──
    const { count: activeLeases } = await sb
      .from("package_leases")
      .select("package_id", { count: "exact", head: true })
      .gt("lease_until", new Date().toISOString());

    const { count: queuedCount } = await sb
      .from("course_packages")
      .select("id", { count: "exact", head: true })
      .eq("status", "queued");

    const { count: buildingCount } = await sb
      .from("course_packages")
      .select("id", { count: "exact", head: true })
      .eq("status", "building");

    // ── 6) Stall detection ──
    const isStalled =
      (queuedCount ?? 0) > 0 &&
      (buildingCount ?? 0) === 0 &&
      (activeLeases ?? 0) === 0;

    if (isStalled) {
      const alreadyAlerted = await hasRecentOpenAlert(
        sb,
        "pipeline-watchdog",
        "PIPELINE_STALLED",
        10,
      );
      if (!alreadyAlerted) {
        try {
          await sb
            .from("ops_alerts")
            .insert({
              source: "pipeline-watchdog",
              severity: "error",
              message: `PIPELINE_STALLED: queued=${queuedCount} building=${buildingCount} leases=${activeLeases}`,
              payload: {
                queued: queuedCount,
                building: buildingCount,
                activeLeases,
                ts: new Date().toISOString(),
              },
            });
        } catch (_) { /* non-critical */ }
        actions.push(
          `PIPELINE_STALLED alert: queued=${queuedCount} building=${buildingCount}`,
        );
      }
    }

    // ── 7) Auto-resolve stall alerts when healthy ──
    const isHealthy = (activeLeases ?? 0) > 0;
    if (isHealthy) {
      try {
        await sb
          .from("ops_alerts")
          .update({ acknowledged_at: new Date().toISOString() })
          .eq("source", "pipeline-watchdog")
          .is("acknowledged_at", null)
          .ilike("message", "%PIPELINE_STALLED%");
      } catch (_) { /* non-critical */ }
    }
    // ── Log cycle ──
    const qgHealedCount = (qgFailedPkgs || []).length;
    try {
      await sb
        .from("auto_heal_log")
        .insert({
          action_type: "pipeline_watchdog_cycle",
          trigger_source: "cron",
          result_status: actions.length > 0 ? "healed" : "noop",
          result_detail: `${actions.length} actions`,
          metadata: {
            actions,
            queued: queuedCount,
            building: buildingCount,
            activeLeases,
            stale_steps: staleSteps.length,
            stale_leases: staleLeases.length,
            zombie_jobs: zombieJobCount,
            zombie_building: healedZombies,
            qg_healed: qgHealedCount,
          },
        });
    } catch (_) { /* non-critical */ }

    console.log(
      `[watchdog] Cycle done: ${actions.length} actions, queued=${queuedCount} building=${buildingCount} leases=${activeLeases}`,
    );

    return json({
      ok: true,
      actions_count: actions.length,
      actions,
      queued: queuedCount,
      building: buildingCount,
      activeLeases,
    });
  } catch (e: unknown) {
    const msg = (e as Error)?.message || String(e);
    console.error("[watchdog] Error:", msg);
    try {
      await sb
        .from("ops_alerts")
        .insert({
          source: "pipeline-watchdog",
          severity: "error",
          message: `Watchdog crash: ${msg.slice(0, 500)}`,
        });
    } catch (_) { /* can't alert about alert failure */ }
    return json({ ok: false, error: msg }, 500);
  }
});
