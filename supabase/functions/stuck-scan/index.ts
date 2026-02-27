import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

async function safeRpc(
  sb: ReturnType<typeof createClient>,
  fn: string,
  params: Record<string, unknown>,
) {
  try {
    const result = await sb.rpc(fn, params);
    if (result.error) {
      console.warn(`[stuck-scan] RPC ${fn} returned error:`, result.error.message);
    }
    return result;
  } catch (e) {
    console.error(`[stuck-scan] RPC ${fn} threw:`, (e as Error).message);
    return { data: null, error: e };
  }
}

/**
 * stuck-scan v3 – Hardened production watchdog
 *
 * Changes from v2:
 * - Zombie detection uses age guard (>5 min) + cancels stale processing jobs via RPC
 * - Escalation breaker scoped to validate_* steps only; generate_* → needs_manual_review
 * - All job cancellation uses deterministic RPCs instead of .contains()
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  try {
    // Load policy for timeouts
    const { data: policyRow } = await sb
      .from("triage_policy")
      .select("policy_json")
      .eq("is_active", true)
      .maybeSingle();

    const policy = policyRow?.policy_json as Record<string, unknown> | null;
    const stuckConfig = (policy as any)?.production_specific?.stuck_detection ?? {};
    const heartbeatTimeout = stuckConfig.job_processing_heartbeat_timeout_seconds ?? 600;
    const packageTimeout = stuckConfig.package_no_progress_timeout_minutes ?? 90;

    // Job-type-specific stale thresholds (seconds)
    const JOB_TYPE_STALE_OVERRIDES: Record<string, number> = {
      package_generate_exam_pool: 240,
      package_generate_lessons: 300,
      package_generate_flashcards: 300,
      package_elite_harden: 240,
    };

    // ══════════════════════════════════════════════════════
    // 1) Clean stale processing jobs (no heartbeat)
    // ══════════════════════════════════════════════════════
    const { data: processingJobs } = await sb
      .from("job_queue")
      .select("id, attempts, max_attempts, job_type, locked_at")
      .eq("status", "processing");

    const now = Date.now();
    const staleJobs = (processingJobs || []).filter(job => {
      const threshold = JOB_TYPE_STALE_OVERRIDES[job.job_type] ?? heartbeatTimeout;
      const cutoff = now - threshold * 1000;
      return job.locked_at && new Date(job.locked_at).getTime() < cutoff;
    });

    let staleCount = 0;
    let failedFromStale = 0;
    for (const sj of staleJobs) {
      const newAttempts = (sj.attempts || 0) + 1;
      const maxAttempts = sj.max_attempts || 3;
      const effectiveThreshold = JOB_TYPE_STALE_OVERRIDES[sj.job_type] ?? heartbeatTimeout;

      if (newAttempts >= maxAttempts) {
        await sb.from("job_queue").update({
          status: "failed",
          locked_at: null,
          locked_by: null,
          last_error: `Stale lock (>${effectiveThreshold}s, type=${sj.job_type}) — max attempts (${maxAttempts}) reached`,
          last_error_code: "STALE_LOCK_EXHAUSTED",
          attempts: newAttempts,
          completed_at: new Date().toISOString(),
        }).eq("id", sj.id);
        failedFromStale++;
      } else {
        await sb.from("job_queue").update({
          status: "pending",
          locked_at: null,
          locked_by: null,
          scheduled_at: new Date(Date.now() + 30_000).toISOString(),
          last_error: `Stale lock (>${effectiveThreshold}s, type=${sj.job_type}) — attempt ${newAttempts}/${maxAttempts}`,
          last_error_code: "STALE_LOCK",
          attempts: newAttempts,
        }).eq("id", sj.id);
      }
      staleCount++;
    }

    // ══════════════════════════════════════════════════════
    // 1b) ZOMBIE STEP DETECTION (with age guard)
    // Steps in "running" with meta.ok=true — worker completed but step never finalized.
    // Only auto-fix if running > 5 minutes (not a fresh step).
    // ══════════════════════════════════════════════════════
    const ZOMBIE_MIN_AGE_MS = 5 * 60 * 1000;
    const { data: zombieSteps } = await sb
      .from("package_steps")
      .select("package_id, step_key, meta, attempts, started_at")
      .eq("status", "running");

    const zombieResults: Array<{ package_id: string; step_key: string; action: string }> = [];
    for (const zs of zombieSteps || []) {
      const meta = (zs.meta ?? {}) as Record<string, unknown>;
      if (meta.ok !== true && meta.batch_complete !== true) continue;

      const age = zs.started_at ? Date.now() - new Date(zs.started_at).getTime() : Infinity;
      if (age <= ZOMBIE_MIN_AGE_MS) continue;

      // 1) Finalize step
      await sb.from("package_steps").update({
        status: "done",
        finished_at: new Date().toISOString(),
        last_error: null,
      }).eq("package_id", zs.package_id).eq("step_key", zs.step_key).eq("status", "running");

      // 2) Cancel pending/failed jobs via RPC
      await safeRpc(sb, "cancel_jobs_for_package", {
        p_package_id: zs.package_id,
        p_reason: `stuck-scan zombie finalize: cleanup for step ${zs.step_key}`,
      });

      // 3) Cancel stale processing jobs via RPC
      await safeRpc(sb, "cancel_stale_processing_jobs_for_package", {
        p_package_id: zs.package_id,
        p_stale_minutes: 15,
        p_reason: `stuck-scan zombie finalize: cleanup stale processing for step ${zs.step_key}`,
      });

      // 4) Log
      await sb.from("auto_heal_log").insert({
        action_type: "zombie_step_auto_finalize",
        trigger_source: "stuck-scan",
        target_type: "package_step",
        target_id: zs.package_id,
        result_status: "applied",
        result_detail: `Step ${zs.step_key} was running with meta.ok=${meta.ok} for ${Math.round(age / 60000)}min — forced to done + jobs cancelled`,
        metadata: { step_key: zs.step_key, meta, age_min: Math.round(age / 60000) },
      });

      zombieResults.push({ package_id: zs.package_id, step_key: zs.step_key, action: "forced to done + jobs cancelled" });
    }

    if (zombieResults.length > 0) {
      console.log(`[stuck-scan] 🧟 Fixed ${zombieResults.length} zombie step(s)`);
    }

    // ══════════════════════════════════════════════════════
    // 1c) ESCALATION LOOP DETECTION (scoped by step type)
    // - validate_* steps: skip + notify (safe to skip)
    // - generate_* / other steps: mark package needs_manual_review (NOT skip)
    // ══════════════════════════════════════════════════════
    const ESCALATION_MAX = 10;
    const { data: escalatedSteps } = await sb
      .from("package_steps")
      .select("package_id, step_key, attempts, status")
      .gte("attempts", ESCALATION_MAX)
      .not("status", "in", '("done","skipped","blocked")');

    const escalationResults: Array<{ package_id: string; step_key: string; action: string }> = [];
    for (const es of escalatedSteps || []) {
      const isValidation = es.step_key.startsWith("validate_");

      if (isValidation) {
        // Safe to skip validation steps — content exists, just validation is looping
        await sb.from("package_steps").update({
          status: "skipped",
          finished_at: new Date().toISOString(),
          last_error: `stuck-scan: escalation breaker after ${es.attempts} attempts`,
        }).eq("package_id", es.package_id).eq("step_key", es.step_key);

        // Cancel related jobs via RPC
        await safeRpc(sb, "cancel_jobs_for_package", {
          p_package_id: es.package_id,
          p_statuses: ["pending", "failed"],
          p_reason: `stuck-scan escalation breaker: skip ${es.step_key}`,
        });

        escalationResults.push({ package_id: es.package_id, step_key: es.step_key, action: "skipped (validation loop)" });
        console.warn(`[stuck-scan] 🛑 Escalation breaker: skipped ${es.step_key} for ${es.package_id.slice(0, 8)} after ${es.attempts} attempts`);
      } else {
        // NOT safe to skip generate_* or other critical steps — flag for manual review
        await sb.from("course_packages").update({
          stuck_reason: `Escalation loop: step ${es.step_key} has ${es.attempts} attempts — manual review required`,
        }).eq("id", es.package_id);

        // Cancel related jobs to stop the loop
        await safeRpc(sb, "cancel_jobs_for_package", {
          p_package_id: es.package_id,
          p_statuses: ["pending", "failed"],
          p_reason: `stuck-scan escalation breaker: halt ${es.step_key}`,
        });

        escalationResults.push({ package_id: es.package_id, step_key: es.step_key, action: "flagged for manual review (non-validation)" });
        console.warn(`[stuck-scan] 🛑 Escalation: ${es.step_key} for ${es.package_id.slice(0, 8)} flagged for manual review after ${es.attempts} attempts`);
      }
    }

    // ══════════════════════════════════════════════════════
    // 2) Find building packages with no progress
    // ══════════════════════════════════════════════════════
    const stuckSince = new Date(Date.now() - packageTimeout * 60_000).toISOString();
    const { data: stuckPackages } = await sb
      .from("course_packages")
      .select("id, title, last_progress_at, stuck_reason, course_id")
      .eq("status", "building")
      .lt("last_progress_at", stuckSince);

    const results: Array<{ package_id: string; retried: number; reason: string }> = [];

    for (const pkg of stuckPackages || []) {
      // Check package_steps FIRST (SSOT for pipeline state)
      const { count: activeSteps } = await sb
        .from("package_steps")
        .select("step_key", { count: "exact", head: true })
        .eq("package_id", pkg.id)
        .in("status", ["running", "enqueued"]);

      if ((activeSteps ?? 0) > 0) {
        if (pkg.stuck_reason) {
          await sb.from("course_packages").update({ stuck_reason: null }).eq("id", pkg.id);
        }
        results.push({ package_id: pkg.id, retried: 0, reason: `Skipped: ${activeSteps} active steps in package_steps` });
        continue;
      }

      // Check active leases
      const { count: activeLeases } = await sb
        .from("package_leases")
        .select("package_id", { count: "exact", head: true })
        .eq("package_id", pkg.id)
        .gt("lease_until", new Date().toISOString());

      if ((activeLeases ?? 0) > 0) {
        if (pkg.stuck_reason) {
          await sb.from("course_packages").update({ stuck_reason: null }).eq("id", pkg.id);
        }
        results.push({ package_id: pkg.id, retried: 0, reason: `Skipped: active lease exists` });
        continue;
      }

      // Check for queued/failed steps that can be retried
      const { count: retryableSteps } = await sb
        .from("package_steps")
        .select("step_key", { count: "exact", head: true })
        .eq("package_id", pkg.id)
        .in("status", ["queued", "failed"]);

      if ((retryableSteps ?? 0) > 0) {
        if (pkg.stuck_reason) {
          await sb.from("course_packages").update({ stuck_reason: null }).eq("id", pkg.id);
        }
        results.push({ package_id: pkg.id, retried: 0, reason: `Has ${retryableSteps} retryable steps — will be picked up by runner` });
        continue;
      }

      // Auto-retry recoverable jobs
      const { data: retried } = await sb.rpc("auto_retry_stuck_package", { p_package_id: pkg.id });
      const retriedCount = retried ?? 0;

      if (retriedCount === 0) {
        // Check if ALL steps are done — package should be published
        const { count: totalSteps } = await sb
          .from("package_steps")
          .select("step_key", { count: "exact", head: true })
          .eq("package_id", pkg.id);

        const { count: doneSteps } = await sb
          .from("package_steps")
          .select("step_key", { count: "exact", head: true })
          .eq("package_id", pkg.id)
          .in("status", ["done", "skipped"]);

        if ((totalSteps ?? 0) > 0 && (doneSteps ?? 0) === (totalSteps ?? 0)) {
          await sb.from("course_packages")
            .update({ status: "published", stuck_reason: null, build_progress: 100 })
            .eq("id", pkg.id);
          results.push({ package_id: pkg.id, retried: 0, reason: `All ${totalSteps} steps done — promoted to published` });
        } else {
          await sb.rpc("mark_package_stuck", {
            p_id: pkg.id,
            p_reason: `No progress for ${packageTimeout}min, no retryable steps or jobs`,
          });
          results.push({ package_id: pkg.id, retried: 0, reason: `Marked stuck: no retryable steps or jobs` });
        }
      } else {
        results.push({ package_id: pkg.id, retried: retriedCount, reason: `Auto-retried ${retriedCount} jobs` });
      }
    }

    // ══════════════════════════════════════════════════════
    // 3) Orphan detection
    // ══════════════════════════════════════════════════════
    const { data: buildingPkgs } = await sb
      .from("course_packages")
      .select("id, title, build_progress, updated_at, course_id")
      .eq("status", "building")
      .is("stuck_reason", null);

    const orphanResults: Array<{ package_id: string; action: string }> = [];
    for (const pkg of buildingPkgs || []) {
      const { count: activeSteps } = await sb
        .from("package_steps")
        .select("step_key", { count: "exact", head: true })
        .eq("package_id", pkg.id)
        .in("status", ["running", "enqueued", "queued", "failed"]);

      if ((activeSteps ?? 0) > 0) continue;

      const { count: totalSteps } = await sb
        .from("package_steps")
        .select("step_key", { count: "exact", head: true })
        .eq("package_id", pkg.id);

      const { count: doneSteps } = await sb
        .from("package_steps")
        .select("step_key", { count: "exact", head: true })
        .eq("package_id", pkg.id)
        .in("status", ["done", "skipped"]);

      if ((totalSteps ?? 0) > 0 && (doneSteps ?? 0) === (totalSteps ?? 0)) {
        await sb.from("course_packages")
          .update({ status: "published", build_progress: 100, stuck_reason: null })
          .eq("id", pkg.id);
        orphanResults.push({ package_id: pkg.id, action: "All steps done — promoted to published" });
        continue;
      }

      if ((totalSteps ?? 0) === 0) {
        orphanResults.push({ package_id: pkg.id, action: "No steps yet — waiting for runner bootstrap" });
        continue;
      }

      await sb.from("course_packages").update({
        stuck_reason: "No actionable steps remaining",
      }).eq("id", pkg.id);
      orphanResults.push({ package_id: pkg.id, action: "marked stuck (no actionable steps)" });
    }

    // ══════════════════════════════════════════════════════
    // 4) Alert if stuck packages detected
    // ══════════════════════════════════════════════════════
    const allStuck = [
      ...results.filter(r => r.reason.includes("Marked stuck")),
      ...orphanResults.filter(o => o.action.includes("stuck")),
      ...escalationResults,
    ];
    if (allStuck.length > 0) {
      await sb.from("admin_notifications").insert({
        title: `${allStuck.length} Package(s) stuck/escalated`,
        body: `Pakete ohne Fortschritt, verwaiste Builds oder Eskalations-Loops erkannt.`,
        category: "ops",
        severity: "warning",
        metadata: { details: allStuck },
      });
    }

    console.log(`[stuck-scan] ${results.length} timeout-checked, ${orphanResults.length} orphan-checked, ${staleCount} stale jobs reset (${failedFromStale} permanently failed), ${zombieResults.length} zombie steps fixed, ${escalationResults.length} escalation loops handled`);

    return json({
      ok: true,
      config: { heartbeat_timeout_s: heartbeatTimeout, package_timeout_min: packageTimeout },
      stuck_packages: results,
      orphan_packages: orphanResults,
      stale_jobs_reset: staleCount,
      stale_jobs_permanently_failed: failedFromStale,
      zombie_steps_fixed: zombieResults,
      escalation_loops: escalationResults,
    });
  } catch (e: unknown) {
    const msg = (e as Error)?.message || String(e);
    console.error("[stuck-scan] Error:", msg);
    return json({ ok: false, error: msg }, 500);
  }
});
