import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

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

// ── Weight config for Health Score (0–100) ──────────────────────────
const WEIGHTS = {
  job_layer: 0.25,
  step_layer: 0.25,
  artifact_layer: 0.20,
  llm_layer: 0.15,
  wip_layer: 0.15,
};

// ── Score helpers ───────────────────────────────────────────────────
function clamp(v: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, v));
}

function severityFromScore(score: number): "P0" | "P1" | "P2" | "info" {
  if (score < 40) return "P0";
  if (score < 70) return "P1";
  if (score < 90) return "P2";
  return "info";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const t0 = Date.now();

  try {
    // ═══════════════════════════════════════════════════════════════
    // LAYER 1: Job Layer — Stuck jobs, zombies, backoff loops
    // ═══════════════════════════════════════════════════════════════
    const [
      { data: stuckProcessing },
      { data: queueLatency },
      { data: errorClass },
    ] = await Promise.all([
      sb.from("v_pipeline_stuck_processing").select("*").limit(50),
      sb.from("v_pipeline_queue_latency").select("*").limit(20),
      sb.from("v_pipeline_error_class").select("*").limit(20),
    ]);

    const zombieCount = (stuckProcessing || []).length;
    const avgLatencyMin = queueLatency?.length
      ? queueLatency.reduce((s: number, r: any) => s + (r.avg_wait_minutes || 0), 0) / queueLatency.length
      : 0;
    const permanentErrors = (errorClass || [])
      .filter((e: any) => e.error_class === "permanent")
      .reduce((s: number, e: any) => s + (e.count || 0), 0);

    // Score: 100 if no zombies & low latency, degrade per issue
    const jobScore = clamp(100 - zombieCount * 15 - Math.min(avgLatencyMin, 60) * 0.5 - permanentErrors * 5);

    // ═══════════════════════════════════════════════════════════════
    // LAYER 2: Step Layer — Sequence blockades, timeouts
    // ═══════════════════════════════════════════════════════════════
    const [
      { data: stalledPackages },
      { data: stepFunnel },
      { data: blockedPackages },
    ] = await Promise.all([
      sb.from("v_pipeline_stalled_packages").select("*").limit(50),
      sb.from("v_pipeline_step_funnel").select("*").limit(50),
      sb.from("ops_blocked_packages").select("*").limit(50),
    ]);

    const stalledCount = (stalledPackages || []).length;
    const blockedCount = (blockedPackages || []).length;

    // Funnel health: ratio of done vs total steps in active packages
    const funnelDone = (stepFunnel || []).filter((s: any) => s.status === "done").length;
    const funnelTotal = (stepFunnel || []).length || 1;
    const funnelRatio = funnelDone / funnelTotal;

    const stepScore = clamp(100 - stalledCount * 12 - blockedCount * 8 + funnelRatio * 20);

    // ═══════════════════════════════════════════════════════════════
    // LAYER 3: Artifact Layer — Hollow content, missing artifacts
    // ═══════════════════════════════════════════════════════════════
    const [
      { data: contentIntegrity },
      { data: hollowCompletions },
      { data: artifactBlocked },
    ] = await Promise.all([
      sb.from("v_pipeline_content_integrity").select("*").limit(20),
      sb.from("ops_hollow_completions").select("*").limit(50),
      sb.from("pipeline_artifact_blocked").select("*").limit(50),
    ]);

    const hollowCount = (hollowCompletions || []).length;
    const artifactBlockedCount = (artifactBlocked || []).length;

    // Content integrity: average real_ratio across packages
    const avgRealRatio = contentIntegrity?.length
      ? contentIntegrity.reduce((s: number, r: any) => s + (r.real_ratio || 0), 0) / contentIntegrity.length
      : 1;

    const artifactScore = clamp(avgRealRatio * 100 - hollowCount * 3 - artifactBlockedCount * 5);

    // ═══════════════════════════════════════════════════════════════
    // LAYER 4: LLM Layer — Cooldown cascades, zero-progress batches
    // ═══════════════════════════════════════════════════════════════
    const [
      { data: recentJobs },
      { data: batchStuck },
    ] = await Promise.all([
      sb.from("job_queue")
        .select("job_type, status, last_error_code, rate_limited_until")
        .in("status", ["pending", "processing"])
        .not("rate_limited_until", "is", null)
        .limit(100),
      sb.from("ops_batch_cursor_stuck").select("*").limit(20),
    ]);

    const rateLimitedCount = (recentJobs || []).length;
    const batchStuckCount = (batchStuck || []).length;

    // Check zero-progress in last hour
    const oneHourAgo = new Date(Date.now() - 3600_000).toISOString();
    const { count: zeroProgressCount } = await sb
      .from("job_queue")
      .select("id", { count: "exact", head: true })
      .eq("status", "completed")
      .gt("completed_at", oneHourAgo)
      .eq("last_error_code", "ZERO_PROGRESS");

    const llmScore = clamp(100 - rateLimitedCount * 2 - batchStuckCount * 10 - (zeroProgressCount || 0) * 5);

    // ═══════════════════════════════════════════════════════════════
    // LAYER 5: WIP Layer — Lease orphans, building without job
    // ═══════════════════════════════════════════════════════════════
    const [
      { data: buildingNoJob },
      { data: buildingNoLease },
    ] = await Promise.all([
      sb.from("ops_building_without_job_or_lease").select("*").limit(20),
      sb.from("ops_recent_building_without_lease").select("*").limit(20),
    ]);

    const orphanCount = (buildingNoJob || []).length + (buildingNoLease || []).length;
    const wipScore = clamp(100 - orphanCount * 20);

    // ═══════════════════════════════════════════════════════════════
    // COMPOSITE HEALTH SCORE
    // ═══════════════════════════════════════════════════════════════
    const healthScore = Math.round(
      jobScore * WEIGHTS.job_layer +
      stepScore * WEIGHTS.step_layer +
      artifactScore * WEIGHTS.artifact_layer +
      llmScore * WEIGHTS.llm_layer +
      wipScore * WEIGHTS.wip_layer
    );

    const severity = severityFromScore(healthScore);
    const durationMs = Date.now() - t0;

    const findings = {
      health_score: healthScore,
      severity,
      layers: {
        job: { score: Math.round(jobScore), zombies: zombieCount, avg_latency_min: Math.round(avgLatencyMin), permanent_errors: permanentErrors },
        step: { score: Math.round(stepScore), stalled: stalledCount, blocked: blockedCount, funnel_ratio: Math.round(funnelRatio * 100) },
        artifact: { score: Math.round(artifactScore), hollow: hollowCount, artifact_blocked: artifactBlockedCount, real_ratio_pct: Math.round(avgRealRatio * 100) },
        llm: { score: Math.round(llmScore), rate_limited: rateLimitedCount, batch_stuck: batchStuckCount, zero_progress_1h: zeroProgressCount || 0 },
        wip: { score: Math.round(wipScore), orphans: orphanCount },
      },
      duration_ms: durationMs,
    };

    // ── Persist health event ────────────────────────────────────────
    await sb.from("pipeline_health_events").insert({
      severity,
      kind: "forensic_monitor_cycle",
      meta: findings,
    });

    // ── Also log to auto_heal_log for audit trail ───────────────────
    await sb.from("auto_heal_log").insert({
      action_type: "forensic_monitor_cycle",
      trigger_source: "cron_10min",
      result_status: severity === "info" ? "healthy" : severity,
      result_detail: `Health=${healthScore} | Job=${Math.round(jobScore)} Step=${Math.round(stepScore)} Art=${Math.round(artifactScore)} LLM=${Math.round(llmScore)} WIP=${Math.round(wipScore)}`,
      duration_ms: durationMs,
      metadata: findings,
    });

    // ── Alert if critical ───────────────────────────────────────────
    if (severity === "P0" || severity === "P1") {
      await sb.from("admin_notifications").insert({
        title: `Pipeline Health ${severity}: Score ${healthScore}/100`,
        body: `Forensic Monitor: ${severity === "P0" ? "KRITISCH" : "Warnung"} — Job=${Math.round(jobScore)} Step=${Math.round(stepScore)} Art=${Math.round(artifactScore)} LLM=${Math.round(llmScore)} WIP=${Math.round(wipScore)}`,
        category: "pipeline",
        severity: severity === "P0" ? "critical" : "warning",
        entity_type: "pipeline_health",
        metadata: findings,
      });
    }

    console.log(`[ForensicMonitor] Health=${healthScore} (${severity}) in ${durationMs}ms`);

    return json({ ok: true, ...findings });
  } catch (e) {
    console.error(`[ForensicMonitor] Error: ${(e as Error).message}`);
    return json({ ok: false, error: (e as Error).message }, 500);
  }
});
