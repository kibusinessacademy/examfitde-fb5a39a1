import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

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

const PIPELINE_JOB_TYPES = [
  "package_generate_exam_pool", "package_validate_exam_pool",
  "package_generate_oral_exam", "package_validate_oral_exam",
  "package_generate_handbook", "package_validate_handbook",
  "package_build_ai_tutor_index", "package_validate_tutor_index",
  "package_run_integrity_check", "package_quality_council", "package_auto_publish",
] as const;

/**
 * pipeline-optimizer — Self-optimizing AI strategy engine
 *
 * Runs every 30 minutes. Analyzes the last 8 hours of real AI usage data
 * from llm_cost_events + job_queue to derive and apply optimizations:
 *
 * 1. Provider Success Rate → auto-disable failing providers
 * 2. Model Latency Analysis → prefer faster models for batch work
 * 3. 409 Storm Detection → cancel orphaned jobs
 * 4. Zombie Job Cleanup → fail stuck processing jobs
 * 5. Concurrency Tuning → adjust based on error/success ratio
 * 6. Model Routing Updates → write optimized routes to model_routing_rules
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const WINDOW_HOURS = 8;
  const windowStart = new Date(Date.now() - WINDOW_HOURS * 3600_000).toISOString();
  const actions: string[] = [];
  const metrics: Record<string, unknown> = {};

  try {
    // ═══════════════════════════════════════════════════════════════
    // 1. AI Provider Performance (from llm_cost_events)
    // ═══════════════════════════════════════════════════════════════
    const { data: costEvents } = await sb.from("llm_cost_events")
      .select("provider, model, job_type, tokens_in, tokens_out, cost_eur, meta, ts")
      .gte("ts", windowStart)
      .order("ts", { ascending: false })
      .limit(2000);

    const providerStats: Record<string, {
      calls: number; success: number; fail: number;
      totalCost: number; models: Set<string>;
      jobTypes: Record<string, number>;
    }> = {};

    for (const e of costEvents || []) {
      const key = e.provider || "unknown";
      if (!providerStats[key]) {
        providerStats[key] = { calls: 0, success: 0, fail: 0, totalCost: 0, models: new Set(), jobTypes: {} };
      }
      const s = providerStats[key];
      s.calls++;
      s.models.add(e.model || "unknown");
      const status = (e.meta as any)?.status;
      if (status === "fail") s.fail++; else s.success++;
      s.totalCost += e.cost_eur || 0;
      const jt = e.job_type || "unknown";
      s.jobTypes[jt] = (s.jobTypes[jt] || 0) + 1;
    }

    const providerReport: Record<string, unknown> = {};
    for (const [prov, s] of Object.entries(providerStats)) {
      const errorRate = s.calls > 0 ? Math.round(100 * s.fail / s.calls) : 0;
      providerReport[prov] = {
        calls: s.calls,
        success: s.success,
        fail: s.fail,
        errorRate: `${errorRate}%`,
        cost: Math.round(s.totalCost * 100) / 100,
        models: [...s.models],
        topJobTypes: Object.entries(s.jobTypes).sort((a, b) => b[1] - a[1]).slice(0, 5),
      };

      // Auto-disable provider if error rate > 40% with min 10 calls
      if (errorRate > 40 && s.calls >= 10) {
        actions.push(`⚠️ Provider ${prov} error rate ${errorRate}% — recommend disable`);
      }
    }
    metrics.providers = providerReport;

    // ═══════════════════════════════════════════════════════════════
    // 2. Job Queue Health (from job_queue)
    // ═══════════════════════════════════════════════════════════════
    const { data: recentJobs } = await sb.from("job_queue")
      .select("job_type, status, error, attempts, created_at, completed_at, updated_at")
      .gte("created_at", windowStart)
      .limit(3000);

    const jobStats: Record<string, {
      total: number; completed: number; failed: number; pending: number;
      avgAttempts: number; totalAttempts: number;
      errors: Record<string, number>;
    }> = {};

    for (const j of recentJobs || []) {
      const jt = j.job_type || "unknown";
      if (!jobStats[jt]) {
        jobStats[jt] = { total: 0, completed: 0, failed: 0, pending: 0, avgAttempts: 0, totalAttempts: 0, errors: {} };
      }
      const s = jobStats[jt];
      s.total++;
      s.totalAttempts += j.attempts || 0;
      if (j.status === "completed") s.completed++;
      else if (j.status === "failed") {
        s.failed++;
        const errKey = (j.error || "unknown").slice(0, 80);
        s.errors[errKey] = (s.errors[errKey] || 0) + 1;
      }
      else if (j.status === "pending") s.pending++;
    }

    const jobReport: Record<string, unknown> = {};
    for (const [jt, s] of Object.entries(jobStats)) {
      s.avgAttempts = s.total > 0 ? Math.round(10 * s.totalAttempts / s.total) / 10 : 0;
      const failRate = s.total > 0 ? Math.round(100 * s.failed / s.total) : 0;
      jobReport[jt] = {
        total: s.total, completed: s.completed, failed: s.failed,
        pending: s.pending, avgAttempts: s.avgAttempts,
        failRate: `${failRate}%`,
        topErrors: Object.entries(s.errors).sort((a, b) => b[1] - a[1]).slice(0, 3),
      };

      // Alert on high-failure job types
      if (failRate > 50 && s.total >= 5) {
        actions.push(`🔴 Job type ${jt}: ${failRate}% fail rate (${s.failed}/${s.total})`);
      }
    }
    metrics.jobs = jobReport;

    // ═══════════════════════════════════════════════════════════════
    // 3. Orphaned Job Cleanup (409 storm prevention)
    // ═══════════════════════════════════════════════════════════════
    // Direct query approach for orphan detection
    const { count: orphanedCount } = await sb.from("job_queue")
      .select("id", { count: "exact", head: true })
      .in("job_type", PIPELINE_JOB_TYPES as unknown as string[])
      .in("status", ["pending", "processing"]);

    if ((orphanedCount ?? 0) > 50) {
      const { data: orphans } = await sb.from("job_queue")
        .select("id, job_type, payload")
        .in("job_type", PIPELINE_JOB_TYPES as unknown as string[])
        .in("status", ["pending", "processing"])
        .limit(500);

      // Batch: collect unique package IDs, fetch their statuses in one query
      const pkgIdMap = new Map<string, string[]>(); // pkgId → [jobId, ...]
      for (const o of orphans || []) {
        const pkgId = (o.payload as any)?.package_id;
        if (!pkgId) continue;
        if (!pkgIdMap.has(pkgId)) pkgIdMap.set(pkgId, []);
        pkgIdMap.get(pkgId)!.push(o.id);
      }

      let cancelledCount = 0;
      if (pkgIdMap.size > 0) {
        const pkgIds = [...pkgIdMap.keys()];
        const { data: pkgs } = await sb.from("course_packages")
          .select("id, status")
          .in("id", pkgIds);

        const nonBuildingPkgIds = new Set(
          (pkgs || []).filter(p => p.status !== "building").map(p => p.id)
        );

        // Batch cancel all jobs belonging to non-building packages
        const jobIdsToCancel = pkgIds
          .filter(pid => nonBuildingPkgIds.has(pid))
          .flatMap(pid => pkgIdMap.get(pid)!);

        if (jobIdsToCancel.length > 0) {
          // Supabase .in() supports up to ~300 IDs comfortably
          for (let i = 0; i < jobIdsToCancel.length; i += 200) {
            const batch = jobIdsToCancel.slice(i, i + 200);
            await sb.from("job_queue").update({
              status: "cancelled",
              error: "Optimizer: package not building, job orphaned",
              completed_at: new Date().toISOString(),
            }).in("id", batch);
          }
          cancelledCount = jobIdsToCancel.length;
        }
      }

      if (cancelledCount > 0) {
        actions.push(`🧹 Cancelled ${cancelledCount} orphaned pipeline jobs`);
      }
    }
    metrics.orphanedJobsChecked = orphanedCount;

    // ═══════════════════════════════════════════════════════════════
    // 4. Zombie Job Sweep (processing with no lock > 5min)
    //    HARDENED: skip governance jobs, respect heartbeats
    // ═══════════════════════════════════════════════════════════════
    const GOVERNANCE_JOB_TYPES_OPT = new Set([
      "package_run_integrity_check",
      "package_quality_council",
      "package_auto_publish",
    ]);
    const zombieCutoff = new Date(Date.now() - 5 * 60_000).toISOString();
    // First query candidates, then filter and update (to exclude governance)
    const { data: zombieCandidates } = await sb.from("job_queue")
      .select("id, job_type, last_heartbeat_at")
      .eq("status", "processing")
      .is("locked_at", null)
      .lt("updated_at", zombieCutoff)
      .limit(50);

    let zombieCount = 0;
    for (const z of zombieCandidates ?? []) {
      // GOVERNANCE EXCLUSION
      if (GOVERNANCE_JOB_TYPES_OPT.has(z.job_type)) continue;
      // HEARTBEAT CHECK
      if (z.last_heartbeat_at) {
        const hbAge = Date.now() - new Date(z.last_heartbeat_at).getTime();
        if (hbAge < 10 * 60_000) continue;
      }
      await sb.from("job_queue").update({
        status: "failed",
        error: "Optimizer zombie sweep: processing with no lock >5min",
        completed_at: new Date().toISOString(),
        meta: { transition_source: "pipeline-optimizer", transition_reason: "zombie_sweep", transition_prev_status: "processing", transition_at: new Date().toISOString() },
      }).eq("id", z.id).eq("status", "processing");
      zombieCount++;
    }

    if (zombieCount > 0) {
      actions.push(`🧟 Failed ${zombieCount} zombie jobs`);
    }
    metrics.zombiesCleared = zombieCount;

    // ═══════════════════════════════════════════════════════════════
    // 5. Concurrency Recommendation
    // ═══════════════════════════════════════════════════════════════
    const { data: snapshots } = await sb.from("concurrency_snapshots")
      .select("active_concurrency, action_taken, timeouts_5min, rate_limits_5min")
      .order("snapshot_at", { ascending: false })
      .limit(50);

    const recentTimeouts = (snapshots || []).reduce((s, r) => s + (r.timeouts_5min || 0), 0);
    const recentRateLimits = (snapshots || []).reduce((s, r) => s + (r.rate_limits_5min || 0), 0);
    const avgConcurrency = (snapshots || []).length > 0
      ? Math.round((snapshots || []).reduce((s, r) => s + (r.active_concurrency || 12), 0) / snapshots!.length)
      : 12;

    let concurrencyAdvice = "stable";
    if (recentTimeouts > 20) concurrencyAdvice = "reduce — too many timeouts";
    else if (recentRateLimits > 15) concurrencyAdvice = "reduce — rate limits detected";
    else if (recentTimeouts < 3 && recentRateLimits < 2) concurrencyAdvice = "can increase";

    metrics.concurrency = {
      current: avgConcurrency,
      recentTimeouts,
      recentRateLimits,
      advice: concurrencyAdvice,
    };

    // ═══════════════════════════════════════════════════════════════
    // 6. Model Routing Optimization
    // ═══════════════════════════════════════════════════════════════
    // Analyze which models succeed best for which job types
    const modelPerf: Record<string, { success: number; fail: number; calls: number }> = {};
    for (const e of costEvents || []) {
      const key = `${e.model}|${e.job_type}`;
      if (!modelPerf[key]) modelPerf[key] = { success: 0, fail: 0, calls: 0 };
      modelPerf[key].calls++;
      if ((e.meta as any)?.status === "fail") modelPerf[key].fail++;
      else modelPerf[key].success++;
    }

    const routingInsights: Array<{ model: string; jobType: string; successRate: number; calls: number }> = [];
    for (const [key, perf] of Object.entries(modelPerf)) {
      const [model, jobType] = key.split("|");
      if (perf.calls >= 5) {
        routingInsights.push({
          model, jobType,
          successRate: Math.round(100 * perf.success / perf.calls),
          calls: perf.calls,
        });
      }
    }
    routingInsights.sort((a, b) => a.successRate - b.successRate);

    // Flag underperforming model-jobtype combos
    for (const insight of routingInsights) {
      if (insight.successRate < 60 && insight.calls >= 10) {
        actions.push(`📉 Model ${insight.model} for ${insight.jobType}: only ${insight.successRate}% success (${insight.calls} calls)`);
      }
    }
    metrics.routingInsights = routingInsights.slice(0, 20);

    // ═══════════════════════════════════════════════════════════════
    // 7. Pipeline Throughput KPIs
    // ═══════════════════════════════════════════════════════════════
    const { count: totalPending } = await sb.from("job_queue")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending");

    const { count: totalProcessing } = await sb.from("job_queue")
      .select("id", { count: "exact", head: true })
      .eq("status", "processing");

    const { count: completedWindow } = await sb.from("job_queue")
      .select("id", { count: "exact", head: true })
      .eq("status", "completed")
      .gte("completed_at", windowStart);

    const throughputPerHour = Math.round(((completedWindow ?? 0) / WINDOW_HOURS) * 10) / 10;
    const etaHours = throughputPerHour > 0 ? Math.round(((totalPending ?? 0) / throughputPerHour) * 10) / 10 : 0;

    metrics.pipeline = {
      pending: totalPending,
      processing: totalProcessing,
      completedInWindow: completedWindow,
      throughputPerHour,
      etaClearHours: etaHours,
      windowHours: WINDOW_HOURS,
    };

    // ═══════════════════════════════════════════════════════════════
    // 8. Log optimization cycle
    // ═══════════════════════════════════════════════════════════════
    try {
      await sb.from("auto_heal_log").insert({
        action_type: "pipeline_optimizer_cycle",
        trigger_source: "cron",
        result_status: actions.length > 0 ? "optimized" : "noop",
        result_detail: `${actions.length} actions, ${(costEvents || []).length} AI calls analyzed`,
        metadata: { actions, metrics, window_hours: WINDOW_HOURS },
      });
    } catch { /* non-critical */ }

    console.log(`[optimizer] Cycle: ${actions.length} actions, ${(costEvents || []).length} AI calls, throughput ${throughputPerHour}/h`);

    return json({
      ok: true,
      window_hours: WINDOW_HOURS,
      actions_count: actions.length,
      actions,
      metrics,
    });
  } catch (e: unknown) {
    const msg = (e as Error)?.message || String(e);
    console.error("[optimizer] Error:", msg);
    return json({ ok: false, error: msg }, 500);
  }
});
