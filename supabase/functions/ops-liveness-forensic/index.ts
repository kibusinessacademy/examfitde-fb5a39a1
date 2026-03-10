import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * ops-liveness-forensic — Post-patch forensic audit
 * 
 * Returns 12 diagnostic queries to verify the Job Liveness Guard is working:
 * 1. Stale processing jobs (should → 0)
 * 2. Active leases without alive work (should → 0)
 * 3. Building packages progress status
 * 4. Provider-loop-guard activations
 * 5. WIP slot utilization
 * 6. Liveness kill history (last 24h)
 * 7. Lease-no-progress releases (last 24h)
 * 8. Heartbeat coverage (% of processing jobs with recent heartbeat)
 * 9. Cooldown-exhausted jobs
 * 10. System freeze indicator
 * 11. Zombie steps remaining
 * 12. Auto-heal effectiveness summary
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const results: Record<string, unknown> = {};
  const now = new Date();
  const h24Ago = new Date(now.getTime() - 24 * 60 * 60_000).toISOString();
  const min10Ago = new Date(now.getTime() - 10 * 60_000).toISOString();
  const h2Ago = new Date(now.getTime() - 2 * 60 * 60_000).toISOString();

  // 1. Stale processing jobs (heartbeat > 10min ago)
  const { count: staleProcessing } = await sb
    .from("job_queue")
    .select("id", { count: "exact", head: true })
    .eq("status", "processing")
    .or(`last_heartbeat_at.lt.${min10Ago},last_heartbeat_at.is.null`);
  results.stale_processing_jobs = staleProcessing ?? 0;

  // 2. Active leases without alive work
  const { data: activeLeases } = await sb
    .from("package_leases")
    .select("package_id")
    .gt("lease_until", now.toISOString());
  
  let deadLeases = 0;
  for (const lease of activeLeases || []) {
    const { data: jobs } = await sb
      .from("job_queue")
      .select("id, status, last_heartbeat_at, updated_at")
      .eq("package_id", lease.package_id)
      .in("status", ["pending", "processing"])
      .limit(5);
    const hasAlive = (jobs || []).some((j: any) => {
      if (j.status === "pending") return true;
      const ref = j.last_heartbeat_at || j.updated_at;
      return ref && new Date(ref).getTime() > now.getTime() - 10 * 60_000;
    });
    if (!hasAlive) deadLeases++;
  }
  results.dead_leases = deadLeases;
  results.active_leases_total = (activeLeases || []).length;

  // 3. Building packages status
  const { data: buildingPkgs } = await sb
    .from("course_packages")
    .select("id, title, build_progress, status, stuck_reason, last_progress_at, track")
    .eq("status", "building")
    .limit(20);
  results.building_packages = (buildingPkgs || []).map((p: any) => ({
    id: p.id?.slice(0, 8),
    title: p.title?.slice(0, 40),
    progress: p.build_progress,
    stuck: p.stuck_reason?.slice(0, 60) ?? null,
    track: p.track,
    last_progress: p.last_progress_at,
  }));

  // 4. Provider-loop-guard activations (last 24h)
  const { count: providerLoopKills } = await sb
    .from("job_queue")
    .select("id", { count: "exact", head: true })
    .eq("liveness_status", "cooldown_exhausted")
    .gte("updated_at", h24Ago);
  results.provider_loop_guard_activations_24h = providerLoopKills ?? 0;

  // 5. WIP slot utilization
  const { count: wipCount } = await sb
    .from("course_packages")
    .select("id", { count: "exact", head: true })
    .eq("status", "building");
  results.wip_slots_used = wipCount ?? 0;

  // 6. Liveness kills (last 24h)
  const { count: livenessKills } = await sb
    .from("job_queue")
    .select("id", { count: "exact", head: true })
    .eq("liveness_status", "killed")
    .gte("updated_at", h24Ago);
  results.liveness_kills_24h = livenessKills ?? 0;

  // 7. Lease-no-progress releases (last 24h)
  const { count: leaseHeals } = await sb
    .from("auto_heal_log")
    .select("id", { count: "exact", head: true })
    .eq("action_type", "lease_no_progress_heal")
    .gte("created_at", h24Ago);
  results.lease_no_progress_heals_24h = leaseHeals ?? 0;

  // 8. Heartbeat coverage
  const { count: totalProcessing } = await sb
    .from("job_queue")
    .select("id", { count: "exact", head: true })
    .eq("status", "processing");
  const { count: withHeartbeat } = await sb
    .from("job_queue")
    .select("id", { count: "exact", head: true })
    .eq("status", "processing")
    .gte("last_heartbeat_at", min10Ago);
  results.heartbeat_coverage = {
    processing_total: totalProcessing ?? 0,
    with_recent_heartbeat: withHeartbeat ?? 0,
    coverage_pct: (totalProcessing ?? 0) > 0
      ? Math.round(((withHeartbeat ?? 0) / (totalProcessing as number)) * 100)
      : 100,
  };

  // 9. Cooldown-exhausted jobs still pending
  const { count: cooldownPending } = await sb
    .from("job_queue")
    .select("id", { count: "exact", head: true })
    .eq("liveness_status", "cooldown_exhausted")
    .eq("status", "pending");
  results.cooldown_exhausted_pending = cooldownPending ?? 0;

  // 10. System freeze indicator
  const { data: lastCompleted } = await sb
    .from("job_queue")
    .select("completed_at")
    .eq("status", "completed")
    .not("completed_at", "is", null)
    .order("completed_at", { ascending: false })
    .limit(1);
  const lastCompletedAt = lastCompleted?.[0]?.completed_at;
  const frozenSince = lastCompletedAt ? new Date(lastCompletedAt as string) : null;
  results.system_freeze = {
    last_completion: lastCompletedAt ?? null,
    minutes_since_completion: frozenSince
      ? Math.round((now.getTime() - frozenSince.getTime()) / 60_000)
      : null,
    frozen: frozenSince ? frozenSince.getTime() < now.getTime() - 2 * 60 * 60_000 : false,
  };

  // 11. Zombie steps (running/enqueued with no active jobs > 10min)
  const { count: zombieSteps } = await sb
    .from("package_steps")
    .select("step_key", { count: "exact", head: true })
    .in("status", ["running", "enqueued"])
    .lt("started_at", min10Ago);
  results.potential_zombie_steps = zombieSteps ?? 0;

  // 12. Auto-heal effectiveness (last 24h)
  const { data: healStats } = await sb
    .from("auto_heal_log")
    .select("action_type, result_status")
    .gte("created_at", h24Ago);
  
  const healSummary: Record<string, { applied: number; failed: number }> = {};
  for (const h of healStats || []) {
    const key = h.action_type as string;
    if (!healSummary[key]) healSummary[key] = { applied: 0, failed: 0 };
    if (h.result_status === "applied") healSummary[key].applied++;
    else healSummary[key].failed++;
  }
  results.auto_heal_summary_24h = healSummary;

  // Overall health verdict
  const allClear =
    (staleProcessing ?? 0) === 0 &&
    deadLeases === 0 &&
    !(results.system_freeze as any)?.frozen;

  results.verdict = allClear ? "✅ HEALTHY" : "⚠️ ISSUES_DETECTED";
  results.timestamp = now.toISOString();

  return new Response(JSON.stringify(results, null, 2), {
    status: 200,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
});
