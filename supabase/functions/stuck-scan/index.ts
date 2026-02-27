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

/**
 * stuck-scan v2 – Policy-driven stuck detection
 * 
 * CRITICAL FIX: Now checks package_steps (the SSOT for pipeline state)
 * instead of only job_queue. Previously, packages with active steps
 * in package_steps but no jobs in job_queue were falsely marked as stuck/failed.
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
    // Heavy LLM jobs like exam_pool timeout at 180s edge-function limit,
    // so waiting 600s for stale detection wastes ~7min per zombie.
    const JOB_TYPE_STALE_OVERRIDES: Record<string, number> = {
      package_generate_exam_pool: 240,
      package_generate_lessons: 300,
      package_generate_flashcards: 300,
      package_elite_harden: 240,
    };

    // 1) Clean stale processing jobs (no heartbeat)
    // First handle job-type-specific shorter thresholds
    const defaultStaleThreshold = new Date(Date.now() - heartbeatTimeout * 1000).toISOString();

    // Fetch ALL processing jobs with their job_type to apply per-type thresholds
    const { data: processingJobs } = await sb
      .from("job_queue")
      .select("id, attempts, max_attempts, job_type, locked_at")
      .eq("status", "processing");

    // Filter to truly stale jobs using per-type thresholds
    const now = Date.now();
    const staleJobs = (processingJobs || []).filter(job => {
      const threshold = JOB_TYPE_STALE_OVERRIDES[job.job_type] ?? heartbeatTimeout;
      const cutoff = now - threshold * 1000;
      return job.locked_at && new Date(job.locked_at).getTime() < cutoff;
    });

    let staleCount = 0;
    let failedFromStale = 0;
    for (const sj of staleJobs || []) {
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

    // 1b) ZOMBIE STEP DETECTION: steps in "running" with meta.ok=true
    // These are steps where the worker completed but the step was never finalized.
    const { data: zombieSteps } = await sb
      .from("package_steps")
      .select("package_id, step_key, meta, attempts, started_at")
      .eq("status", "running");

    const zombieResults: Array<{ package_id: string; step_key: string; action: string }> = [];
    for (const zs of zombieSteps || []) {
      const meta = (zs.meta ?? {}) as Record<string, unknown>;
      if (meta.ok === true || meta.batch_complete === true) {
        // Check age — only auto-fix if running > 5 min (not a fresh step)
        const age = zs.started_at ? Date.now() - new Date(zs.started_at).getTime() : Infinity;
        if (age > 5 * 60 * 1000) {
          await sb.from("package_steps").update({
            status: "done",
            finished_at: new Date().toISOString(),
            last_error: null,
          }).eq("package_id", zs.package_id).eq("step_key", zs.step_key).eq("status", "running");

          await sb.from("auto_heal_log").insert({
            action_type: "zombie_step_auto_finalize",
            trigger_source: "stuck-scan",
            target_type: "package_step",
            target_id: zs.package_id,
            result_status: "applied",
            result_detail: `Step ${zs.step_key} was running with meta.ok=${meta.ok} for ${Math.round(age / 60000)}min — forced to done`,
            metadata: { step_key: zs.step_key, meta, age_min: Math.round(age / 60000) },
          });

          zombieResults.push({ package_id: zs.package_id, step_key: zs.step_key, action: "forced to done" });
        }
      }
    }

    if (zombieResults.length > 0) {
      console.log(`[stuck-scan] 🧟 Fixed ${zombieResults.length} zombie step(s)`);
    }

    // 1c) ESCALATION LOOP DETECTION: steps with attempts >= 10 still not done
    const { data: escalatedSteps } = await sb
      .from("package_steps")
      .select("package_id, step_key, attempts, status")
      .gte("attempts", 10)
      .not("status", "in", '("done","skipped","blocked")');

    for (const es of escalatedSteps || []) {
      await sb.from("package_steps").update({
        status: "skipped",
        finished_at: new Date().toISOString(),
        last_error: `stuck-scan: escalation breaker after ${es.attempts} attempts`,
      }).eq("package_id", es.package_id).eq("step_key", es.step_key);

      // Cancel related jobs
      await sb.from("job_queue").update({
        status: "cancelled", completed_at: new Date().toISOString(),
        error: `stuck-scan: escalation breaker for step ${es.step_key}`,
      }).eq("status", "pending")
       .contains("payload" as any, { package_id: es.package_id });

      console.warn(`[stuck-scan] 🛑 Escalation breaker: skipped ${es.step_key} for ${es.package_id.slice(0, 8)} after ${es.attempts} attempts`);
    }

    // 2) Find building packages with no progress
    const stuckSince = new Date(Date.now() - packageTimeout * 60_000).toISOString();
    const { data: stuckPackages } = await sb
      .from("course_packages")
      .select("id, title, last_progress_at, stuck_reason, course_id")
      .eq("status", "building")
      .lt("last_progress_at", stuckSince);

    const results: Array<{ package_id: string; retried: number; reason: string }> = [];

    for (const pkg of stuckPackages || []) {
      // ── FIX: Check package_steps FIRST (SSOT for pipeline state) ──
      // If the package has active steps (running/enqueued), it's NOT stuck
      const { count: activeSteps } = await sb
        .from("package_steps")
        .select("step_key", { count: "exact", head: true })
        .eq("package_id", pkg.id)
        .in("status", ["running", "enqueued"]);

      if ((activeSteps ?? 0) > 0) {
        // Package has active pipeline steps — NOT stuck, clear any false stuck_reason
        if (pkg.stuck_reason) {
          await sb.from("course_packages")
            .update({ stuck_reason: null })
            .eq("id", pkg.id);
        }
        results.push({
          package_id: pkg.id,
          retried: 0,
          reason: `Skipped: ${activeSteps} active steps in package_steps`,
        });
        continue;
      }

      // ── FIX: Check active leases ──
      const { count: activeLeases } = await sb
        .from("package_leases")
        .select("package_id", { count: "exact", head: true })
        .eq("package_id", pkg.id)
        .gt("lease_until", new Date().toISOString());

      if ((activeLeases ?? 0) > 0) {
        if (pkg.stuck_reason) {
          await sb.from("course_packages")
            .update({ stuck_reason: null })
            .eq("id", pkg.id);
        }
        results.push({
          package_id: pkg.id,
          retried: 0,
          reason: `Skipped: active lease exists`,
        });
        continue;
      }

      // ── Check for queued/failed steps that can be retried ──
      const { count: retryableSteps } = await sb
        .from("package_steps")
        .select("step_key", { count: "exact", head: true })
        .eq("package_id", pkg.id)
        .in("status", ["queued", "failed"]);

      if ((retryableSteps ?? 0) > 0) {
        // Package has retryable steps but no active processing — it will be picked up
        // by the next pipeline-runner invocation. Don't mark as stuck.
        if (pkg.stuck_reason) {
          await sb.from("course_packages")
            .update({ stuck_reason: null })
            .eq("id", pkg.id);
        }
        results.push({
          package_id: pkg.id,
          retried: 0,
          reason: `Has ${retryableSteps} retryable steps — will be picked up by runner`,
        });
        continue;
      }

      // Auto-retry recoverable jobs in job_queue
      const { data: retried } = await sb.rpc("auto_retry_stuck_package", {
        p_package_id: pkg.id,
      });

      const retriedCount = retried ?? 0;

      if (retriedCount === 0) {
        // Check if ALL steps are done — package should be published, not stuck
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
          // All steps done but status is still "building" — fix to published
          await sb.from("course_packages")
            .update({ status: "published", stuck_reason: null, build_progress: 100 })
            .eq("id", pkg.id);
          results.push({
            package_id: pkg.id,
            retried: 0,
            reason: `All ${totalSteps} steps done — promoted to published`,
          });
        } else {
          await sb.rpc("mark_package_stuck", {
            p_id: pkg.id,
            p_reason: `No progress for ${packageTimeout}min, no retryable steps or jobs`,
          });
          results.push({
            package_id: pkg.id,
            retried: 0,
            reason: `Marked stuck: no retryable steps or jobs`,
          });
        }
      } else {
        results.push({
          package_id: pkg.id,
          retried: retriedCount,
          reason: `Auto-retried ${retriedCount} jobs`,
        });
      }
    }

    // 3) Orphan detection: packages "building" with ZERO active steps AND ZERO active jobs
    const { data: buildingPkgs } = await sb
      .from("course_packages")
      .select("id, title, build_progress, updated_at, course_id")
      .eq("status", "building")
      .is("stuck_reason", null); // only check non-stuck packages

    const orphanResults: Array<{ package_id: string; action: string }> = [];
    for (const pkg of buildingPkgs || []) {
      // Check package_steps first (SSOT)
      const { count: activeSteps } = await sb
        .from("package_steps")
        .select("step_key", { count: "exact", head: true })
        .eq("package_id", pkg.id)
        .in("status", ["running", "enqueued", "queued", "failed"]);

      if ((activeSteps ?? 0) > 0) {
        // Has actionable steps — pipeline-runner will handle it
        continue;
      }

      // Check if all steps are done
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

      // No steps at all = needs bootstrap (pipeline-runner handles this)
      if ((totalSteps ?? 0) === 0) {
        orphanResults.push({ package_id: pkg.id, action: "No steps yet — waiting for runner bootstrap" });
        continue;
      }

      // Truly orphaned: has steps but none actionable
      await sb.from("course_packages").update({
        stuck_reason: "No actionable steps remaining",
      }).eq("id", pkg.id);
      orphanResults.push({ package_id: pkg.id, action: "marked stuck (no actionable steps)" });
    }

    // 4) Alert if there are stuck packages
    const allStuck = [...results.filter(r => r.reason.includes("Marked stuck")), ...orphanResults.filter(o => o.action.includes("stuck"))];
    if (allStuck.length > 0) {
      await sb.from("admin_notifications").insert({
        title: `${allStuck.length} Package(s) stuck/orphaned`,
        body: `Pakete ohne Fortschritt oder verwaiste Builds erkannt.`,
        category: "ops",
        severity: "warning",
        metadata: { details: allStuck },
      });
    }

    console.log(`[stuck-scan] ${results.length} timeout-checked, ${orphanResults.length} orphan-checked, ${staleCount} stale jobs reset (${failedFromStale} permanently failed), ${zombieResults.length} zombie steps fixed, ${escalatedSteps?.length ?? 0} escalation loops broken`);

    return json({
      ok: true,
      config: { heartbeat_timeout_s: heartbeatTimeout, package_timeout_min: packageTimeout },
      stuck_packages: results,
      orphan_packages: orphanResults,
      stale_jobs_reset: staleCount,
      stale_jobs_permanently_failed: failedFromStale,
      zombie_steps_fixed: zombieResults,
      escalation_loops_broken: escalatedSteps?.length ?? 0,
    });
  } catch (e: unknown) {
    const msg = (e as Error)?.message || String(e);
    console.error("[stuck-scan] Error:", msg);
    return json({ ok: false, error: msg }, 500);
  }
});
