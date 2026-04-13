import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

const WEIGHTS = {
  job_layer: 0.25,
  step_layer: 0.25,
  artifact_layer: 0.20,
  llm_layer: 0.15,
  wip_layer: 0.15,
};

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

  try {
    // Auth check — allow both service-role (cron) and user JWT
    const authHeader = req.headers.get("Authorization");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    if (authHeader && !authHeader.includes(serviceKey)) {
      const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user }, error: authErr } = await userClient.auth.getUser();
      if (authErr || !user) return json({ error: "Unauthorized" }, 401);
    }

    const sb = createClient(supabaseUrl, serviceKey);

    const body = await req.json().catch(() => ({}));
    const mode = body?.mode ?? "scan"; // scan | heal | both

    const t0 = Date.now();

    // ═══════════════════════════════════════════════════════════════
    // LAYER 1: Job Layer
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
    const jobScore = clamp(100 - zombieCount * 15 - Math.min(avgLatencyMin, 60) * 0.5 - permanentErrors * 5);

    // ═══════════════════════════════════════════════════════════════
    // LAYER 2: Step Layer
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
    const funnelDone = (stepFunnel || []).filter((s: any) => s.status === "done").length;
    const funnelTotal = (stepFunnel || []).length || 1;
    const funnelRatio = funnelDone / funnelTotal;
    const stepScore = clamp(100 - stalledCount * 12 - blockedCount * 8 + funnelRatio * 20);

    // ═══════════════════════════════════════════════════════════════
    // LAYER 3: Artifact Layer
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
    const avgRealRatio = contentIntegrity?.length
      ? contentIntegrity.reduce((s: number, r: any) => s + (r.real_ratio || 0), 0) / contentIntegrity.length
      : 1;
    const artifactScore = clamp(avgRealRatio * 100 - hollowCount * 3 - artifactBlockedCount * 5);

    // ═══════════════════════════════════════════════════════════════
    // LAYER 4: LLM Layer
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
    const oneHourAgo = new Date(Date.now() - 3600_000).toISOString();
    const { count: zeroProgressCount } = await sb
      .from("job_queue")
      .select("id", { count: "exact", head: true })
      .eq("status", "completed")
      .gt("completed_at", oneHourAgo)
      .eq("last_error_code", "ZERO_PROGRESS");
    const llmScore = clamp(100 - rateLimitedCount * 2 - batchStuckCount * 10 - (zeroProgressCount || 0) * 5);

    // ═══════════════════════════════════════════════════════════════
    // LAYER 5: WIP Layer
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

    // ── Persist ──────────────────────────────────────────────────
    await sb.from("pipeline_health_events").insert({
      severity,
      kind: "forensic_monitor_cycle",
      meta: findings,
    });

    await sb.from("auto_heal_log").insert({
      action_type: "forensic_monitor_cycle",
      trigger_source: mode === "scan" ? "cron_10min" : "admin_manual",
      result_status: severity === "info" ? "healthy" : severity,
      result_detail: `Health=${healthScore} | Job=${Math.round(jobScore)} Step=${Math.round(stepScore)} Art=${Math.round(artifactScore)} LLM=${Math.round(llmScore)} WIP=${Math.round(wipScore)}`,
      duration_ms: durationMs,
      metadata: findings,
    });

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

    // ═══════════════════════════════════════════════════════════════
    // HEAL MODE — automated remediation
    // ═══════════════════════════════════════════════════════════════
    const healActions: Array<{ action: string; affected: number; detail: string }> = [];

    if (mode === "heal" || mode === "both") {
      // 1. Kill zombie processing jobs (>30min stuck)
      if (zombieCount > 0) {
        const zombieIds = (stuckProcessing || []).map((z: any) => z.job_id).filter(Boolean);
        if (zombieIds.length > 0) {
          const { data: killed } = await sb
            .from("job_queue")
            .update({ status: "pending", locked_at: null, locked_by: null, attempts: 0 })
            .in("id", zombieIds.slice(0, 20))
            .select("id");
          healActions.push({ action: "requeue_zombies", affected: killed?.length || 0, detail: `Requeued ${killed?.length || 0} zombie jobs` });
        }
      }

      // 2. Release stale rate-limits (expired cooldowns)
      if (rateLimitedCount > 0) {
        const now = new Date().toISOString();
        const { data: released } = await sb
          .from("job_queue")
          .update({ rate_limited_until: null })
          .lt("rate_limited_until", now)
          .not("rate_limited_until", "is", null)
          .in("status", ["pending", "processing"])
          .select("id");
        healActions.push({ action: "release_expired_cooldowns", affected: released?.length || 0, detail: `Released ${released?.length || 0} expired cooldowns` });
      }

      // 3. Reset stalled package steps (NEVER unblock intentional_pause)
      if (stalledCount > 0) {
        const stalledIds = (stalledPackages || []).map((s: any) => s.package_id).filter(Boolean);
        if (stalledIds.length > 0) {
          const { data: reset } = await sb
            .from("course_packages")
            .update({ status: "building" })
            .in("id", stalledIds.slice(0, 10))
            .eq("status", "blocked")
            .not("blocked_reason", "ilike", "%intentional_pause%")
            .select("id");
          healActions.push({ action: "unblock_stalled_packages", affected: reset?.length || 0, detail: `Unblocked ${reset?.length || 0} stalled packages (skipped intentional_pause)` });
        }
      }

      // 4. Release orphan leases
      if (orphanCount > 0) {
        const orphanIds = [
          ...(buildingNoJob || []).map((o: any) => o.package_id),
          ...(buildingNoLease || []).map((o: any) => o.package_id),
        ].filter(Boolean);
        if (orphanIds.length > 0) {
          const { data: deleted } = await sb
            .from("package_leases")
            .delete()
            .in("package_id", orphanIds.slice(0, 10))
            .select("package_id");
          healActions.push({ action: "release_orphan_leases", affected: deleted?.length || 0, detail: `Released ${deleted?.length || 0} orphan leases` });
        }
      }

      // 5. Cancel permanently failed jobs
      if (permanentErrors > 0) {
        const permErrorTypes = (errorClass || [])
          .filter((e: any) => e.error_class === "permanent")
          .map((e: any) => e.job_type);
        if (permErrorTypes.length > 0) {
          const { data: canceled } = await sb
            .from("job_queue")
            .update({ status: "cancelled" })
            .eq("status", "failed")
            .in("job_type", permErrorTypes)
            .limit(50)
            .select("id");
          healActions.push({ action: "cancel_permanent_failures", affected: canceled?.length || 0, detail: `Cancelled ${canceled?.length || 0} permanently failed jobs` });
        }
      }

      // Log heal actions
      if (healActions.length > 0) {
        await sb.from("auto_heal_log").insert({
          action_type: "forensic_heal",
          trigger_source: "admin_manual",
          result_status: "healed",
          result_detail: healActions.map(a => `${a.action}: ${a.affected}`).join(", "),
          duration_ms: Date.now() - t0,
          metadata: { heal_actions: healActions, pre_heal_score: healthScore },
        });
      }
    }

    console.log(`[ForensicMonitor] mode=${mode} Health=${healthScore} (${severity}) heal_actions=${healActions.length} in ${Date.now() - t0}ms`);

    return json({ ok: true, ...findings, heal_actions: healActions });
  } catch (e) {
    console.error(`[ForensicMonitor] Error: ${(e as Error).message}`);
    return json({ ok: false, error: (e as Error).message }, 500);
  }
});
