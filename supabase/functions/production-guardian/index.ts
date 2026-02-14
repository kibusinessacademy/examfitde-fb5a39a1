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

interface ProviderRow {
  provider: string;
  status: string;
  current_slots: number;
  max_slots: number;
  cooldown_seconds: number;
  priority: number;
  reliability_7d: number;
  error_streak: number;
  last_error_at: string | null;
}

/**
 * production-guardian – runs every 20 min via pg_cron
 *
 * Goals:
 * 1. Unstick stuck/processing jobs
 * 2. Re-queue failed packages (max 2 retries)
 * 3. Auto-trigger package-queue-next when pipeline is idle
 * 4. Process pending curriculum content jobs
 * 5. Provider health management
 * 6. Pipeline lock cleanup
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const actions: string[] = [];
  const warnings: string[] = [];

  try {
    // ═══════════════════════════════════════════════════════════════
    // 1. FIX STUCK PROCESSING JOBS (>15 min)
    // ═══════════════════════════════════════════════════════════════
    const fifteenMinAgo = new Date(Date.now() - 15 * 60_000).toISOString();
    const { data: stuckJobs } = await sb
      .from("job_queue")
      .select("id, job_type, attempts, max_attempts")
      .eq("status", "processing")
      .lt("started_at", fifteenMinAgo)
      .limit(20);

    for (const job of stuckJobs ?? []) {
      const maxAttempts = job.max_attempts ?? 5;
      if ((job.attempts ?? 0) >= maxAttempts) {
        await sb.from("job_queue")
          .update({ status: "failed", error: "Guardian: max attempts after stuck" })
          .eq("id", job.id);
        actions.push(`Failed stuck job ${job.job_type} (max attempts)`);
      } else {
        await sb.from("job_queue")
          .update({ status: "pending", started_at: null })
          .eq("id", job.id);
        actions.push(`Reset stuck job ${job.job_type} → pending`);
      }
    }

    // ═══════════════════════════════════════════════════════════════
    // 2. RESET EXCESSIVE ATTEMPT COUNTS ON PENDING JOBS
    // ═══════════════════════════════════════════════════════════════
    const { data: highAttemptJobs } = await sb
      .from("job_queue")
      .select("id, job_type, attempts")
      .eq("status", "pending")
      .gt("attempts", 10)
      .limit(50);

    for (const job of highAttemptJobs ?? []) {
      await sb.from("job_queue").update({ attempts: 0 }).eq("id", job.id);
      actions.push(`Reset attempts ${job.job_type}: ${job.attempts} → 0`);
    }

    // ═══════════════════════════════════════════════════════════════
    // 3. PIPELINE LOCK CLEANUP (stale > 15 min)
    // ═══════════════════════════════════════════════════════════════
    const { data: lock } = await sb
      .from("pipeline_lock")
      .select("id, active_package_id, locked_at, heartbeat_at")
      .eq("id", 1)
      .maybeSingle();

    let pipelineIdle = !lock?.active_package_id;

    if (lock?.active_package_id && lock.locked_at) {
      const lockAge = Date.now() - new Date(lock.locked_at).getTime();
      const heartbeatAge = lock.heartbeat_at
        ? Date.now() - new Date(lock.heartbeat_at).getTime()
        : lockAge;

      // Stale if no heartbeat for 15 min
      if (heartbeatAge > 15 * 60_000) {
        // Mark the package as failed
        await sb.from("course_packages")
          .update({ status: "failed", updated_at: new Date().toISOString() })
          .eq("id", lock.active_package_id)
          .eq("status", "building");

        // Release the lock
        await sb.from("pipeline_lock")
          .update({ active_package_id: null, locked_at: null, heartbeat_at: null, locked_by: null })
          .eq("id", 1);

        actions.push(`Cleared stale lock (${Math.round(heartbeatAge / 60_000)}min no heartbeat), failed pkg ${lock.active_package_id.slice(0, 8)}`);
        pipelineIdle = true;
      }
    }

    // ═══════════════════════════════════════════════════════════════
    // 4. RE-QUEUE FAILED PACKAGES (auto-retry up to 2 times)
    // ═══════════════════════════════════════════════════════════════
    const { data: failedPkgs } = await sb
      .from("course_packages")
      .select("id, title, retry_count, course_id")
      .eq("status", "failed")
      .order("updated_at", { ascending: true })
      .limit(5);

    for (const pkg of failedPkgs ?? []) {
      const retries = (pkg as any).retry_count ?? 0;
      if (retries < 2) {
        // Check the package has a valid course with curriculum
        const { data: courseCheck } = await sb
          .from("courses")
          .select("curriculum_id")
          .eq("id", pkg.course_id)
          .maybeSingle();

        if (courseCheck?.curriculum_id) {
          // Reset failed jobs for this package
          await sb.from("job_queue")
            .update({ status: "pending", attempts: 0, started_at: null, error: null })
            .eq("status", "failed")
            .contains("payload", { package_id: pkg.id });

          // Re-queue the package
          await sb.from("course_packages")
            .update({
              status: "queued",
              retry_count: retries + 1,
              build_progress: 0,
              updated_at: new Date().toISOString(),
            })
            .eq("id", pkg.id);

          actions.push(`Re-queued failed pkg "${pkg.title}" (retry ${retries + 1}/2)`);
        } else {
          warnings.push(`Failed pkg "${pkg.title}" has no curriculum – skipping retry`);
        }
      }
    }

    // ═══════════════════════════════════════════════════════════════
    // 5. AUTO-TRIGGER PIPELINE (if idle + queued packages exist)
    // ═══════════════════════════════════════════════════════════════
    if (pipelineIdle) {
      const { count: queuedCount } = await sb
        .from("course_packages")
        .select("id", { count: "exact", head: true })
        .eq("status", "queued");

      if ((queuedCount ?? 0) > 0) {
        // Fire package-queue-next to pick up the next package
        try {
          const res = await fetch(`${SUPABASE_URL}/functions/v1/package-queue-next`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
            },
            body: JSON.stringify({ triggered_by: "production-guardian" }),
          });
          const data = await res.json();
          if (data.started_package_id) {
            actions.push(`Triggered build for package ${data.started_package_id.slice(0, 8)}`);
          } else if (data.skipped) {
            actions.push(`Queue-next skipped: ${data.reason}`);
          }
        } catch (e) {
          warnings.push(`Failed to trigger package-queue-next: ${(e as Error).message}`);
        }
      } else {
        actions.push("Pipeline idle, no queued packages");
      }
    }

    // ═══════════════════════════════════════════════════════════════
    // 6. PROCESS PENDING CURRICULUM + SETUP JOBS (batch trigger)
    // ═══════════════════════════════════════════════════════════════
    const pipelineJobTypes = ["generate_curriculum_content", "setup_course_package"];

    // Also trigger freeze-priority: if many drafts remain, boost curriculum content jobs
    const { count: draftCount } = await sb
      .from("curricula")
      .select("id", { count: "exact", head: true })
      .eq("status", "draft");

    const dc = draftCount ?? 0;
    const batchSize = dc > 200 ? 60 : dc > 100 ? 40 : 25;

    const { count: pendingPipelineJobs } = await sb
      .from("job_queue")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending")
      .in("job_type", pipelineJobTypes);

    if ((pendingPipelineJobs ?? 0) > 0) {
      try {
        const res = await fetch(`${SUPABASE_URL}/functions/v1/job-runner`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
          },
          body: JSON.stringify({
            job_types: pipelineJobTypes,
            max_jobs: batchSize,
            triggered_by: "production-guardian",
          }),
        });
        const data = await res.json();
        actions.push(`Triggered job-runner for ${pendingPipelineJobs} pending pipeline jobs (content+setup): ${JSON.stringify(data).slice(0, 120)}`);
      } catch (e) {
        warnings.push(`Job-runner trigger failed: ${(e as Error).message}`);
      }
    }

    // ═══════════════════════════════════════════════════════════════
    // 7. PROVIDER HEALTH MANAGEMENT
    // ═══════════════════════════════════════════════════════════════
    const { data: providers } = await sb
      .from("provider_status")
      .select("*") as { data: ProviderRow[] | null };

    for (const p of providers ?? []) {
      // Throttle high-error providers
      if (p.error_streak >= 5 && p.current_slots > 1) {
        const newSlots = Math.max(1, Math.floor(p.current_slots / 2));
        await sb.from("provider_status")
          .update({
            current_slots: newSlots,
            cooldown_seconds: Math.min(300, p.cooldown_seconds + 30),
            status: "degraded",
          })
          .eq("provider", p.provider);
        actions.push(`Throttled ${p.provider}: slots→${newSlots}`);
      }

      // Recover healthy providers
      if (p.status === "healthy" && p.error_streak === 0 && p.reliability_7d > 0.8 && p.current_slots < p.max_slots) {
        const newSlots = Math.min(p.max_slots, p.current_slots + 1);
        await sb.from("provider_status")
          .update({ current_slots: newSlots, cooldown_seconds: Math.max(30, p.cooldown_seconds - 10) })
          .eq("provider", p.provider);
        actions.push(`Recovered ${p.provider}: slots→${newSlots}`);
      }

      // Revive down providers after 10 min cooldown
      if (p.status === "down" && p.last_error_at) {
        if (Date.now() - new Date(p.last_error_at).getTime() > 10 * 60_000) {
          await sb.from("provider_status")
            .update({ status: "degraded", error_streak: 0, current_slots: 1, cooldown_seconds: 120 })
            .eq("provider", p.provider);
          actions.push(`Revived ${p.provider}: down→degraded`);
        }
      }
    }

    // ═══════════════════════════════════════════════════════════════
    // 8. WORKER POLICY CHECK (cost/error budget)
    // ═══════════════════════════════════════════════════════════════
    const today = new Date().toISOString().slice(0, 10);
    const { data: usageToday } = await sb
      .from("ai_worker_usage_daily")
      .select("job_type, runs, errors, cost_eur")
      .eq("date", today);

    const { data: policies } = await sb
      .from("ai_worker_policies")
      .select("job_type, enabled, pause_on_error_rate, max_cost_eur_per_day");

    const usageMap = new Map((usageToday ?? []).map((u: any) => [u.job_type, u]));

    for (const pol of policies ?? []) {
      const usage = usageMap.get(pol.job_type);
      if (!usage) continue;
      const errRate = usage.runs > 4 ? usage.errors / usage.runs : 0;

      if (errRate >= pol.pause_on_error_rate && pol.enabled) {
        await sb.from("ai_worker_policies").update({ enabled: false }).eq("job_type", pol.job_type);
        warnings.push(`Paused ${pol.job_type}: err ${(errRate * 100).toFixed(0)}%`);
      }

      if (!pol.enabled && errRate < pol.pause_on_error_rate * 0.5 && usage.cost_eur < pol.max_cost_eur_per_day * 0.8) {
        await sb.from("ai_worker_policies").update({ enabled: true }).eq("job_type", pol.job_type);
        actions.push(`Re-enabled ${pol.job_type}`);
      }
    }

    // ═══════════════════════════════════════════════════════════════
    // 9. QUEUE STATS SNAPSHOT
    // ═══════════════════════════════════════════════════════════════
    const counts: Record<string, number> = {};
    for (const s of ["pending", "processing", "completed", "failed"]) {
      const { count } = await sb.from("job_queue").select("id", { count: "exact", head: true }).eq("status", s);
      counts[s] = count ?? 0;
    }

    const summary = {
      timestamp: new Date().toISOString(),
      queue: counts,
      pipeline_idle: pipelineIdle,
      actions_taken: actions.length,
      warnings_count: warnings.length,
      actions,
      warnings,
    };

    // Notify if critical
    if (warnings.length > 0 || actions.length > 0) {
      await sb.from("admin_notifications").insert({
        title: `Guardian: ${actions.length} Actions, ${warnings.length} Warnings`,
        body: JSON.stringify({ actions, warnings, queue: counts }),
        severity: warnings.length > 0 ? "warning" : "info",
        category: "system",
        entity_type: "production_guardian",
      });
    }

    // Log
    await sb.from("auto_heal_log").insert({
      action_type: "production_guardian_cycle",
      trigger_source: "cron_20min",
      result_status: warnings.length > 0 ? "warning" : "ok",
      result_detail: `${actions.length} actions, ${warnings.length} warnings`,
      metadata: summary,
    });

    console.log(`[Guardian] ${actions.length} actions, ${warnings.length} warnings, queue: ${JSON.stringify(counts)}`);
    return json(summary);
  } catch (e) {
    const msg = (e as Error)?.message || String(e);
    console.error("[Guardian] Error:", msg);
    return json({ error: msg }, 500);
  }
});
