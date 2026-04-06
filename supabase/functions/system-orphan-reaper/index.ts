import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function logOrphan(sb: any, orphanType: string, objectRef: string, severity: string, message: string, payload: any) {
  await sb.from("system_orphan_executions").insert({
    orphan_type: orphanType,
    object_ref: objectRef,
    severity,
    message,
    payload,
    status: "open",
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "POST only" });

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let releasedLeases = 0;
  let staleCrons = 0;
  let reapedOrphanJobs = 0;
  let reapedDuplicateJobs = 0;
  let wipDemoted = 0;

  // 1. Expire stale leases
  const { data: expiredLeases } = await sb
    .from("system_execution_leases")
    .select("*")
    .eq("status", "active")
    .lt("lease_until", new Date().toISOString())
    .limit(200);

  for (const lease of expiredLeases || []) {
    await sb.from("system_execution_leases").update({
      status: "expired",
      updated_at: new Date().toISOString(),
      released_at: new Date().toISOString(),
    }).eq("id", lease.id);

    await logOrphan(sb, "stale_lease", lease.lease_key, "critical", `Expired lease ${lease.lease_key}`, {
      lease_scope: lease.lease_scope,
      owner_key: lease.owner_key,
    });

    releasedLeases++;
  }

  // 2. Mark stale cron executions
  const staleBoundary = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { data: runningCrons } = await sb
    .from("system_cron_executions")
    .select("*")
    .eq("status", "running")
    .lt("started_at", staleBoundary)
    .limit(100);

  for (const cron of runningCrons || []) {
    await sb.from("system_cron_executions").update({
      status: "stale",
      finished_at: new Date().toISOString(),
      error_message: "Marked stale by orphan reaper",
    }).eq("id", cron.id);

    await logOrphan(sb, "stale_cron", cron.execution_key, "warn", `Stale cron execution ${cron.cron_key}`, {
      cron_key: cron.cron_key,
      started_at: cron.started_at,
    });

    staleCrons++;
  }

  // 3. Reap failed jobs for non-building packages (NON_BUILDING_PACKAGE orphans)
  const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const { data: failedJobs } = await sb
    .from("job_queue")
    .select("id, package_id, job_type")
    .eq("status", "failed")
    .lt("updated_at", thirtyMinAgo)
    .limit(500);

  if (failedJobs && failedJobs.length > 0) {
    // Get building package IDs to filter
    const packageIds = [...new Set(failedJobs.map((j: any) => j.package_id).filter(Boolean))];
    const { data: buildingPkgs } = await sb
      .from("course_packages")
      .select("id")
      .in("id", packageIds)
      .eq("status", "building");

    const buildingSet = new Set((buildingPkgs || []).map((p: any) => p.id));

    for (const job of failedJobs) {
      if (job.package_id && !buildingSet.has(job.package_id)) {
        await sb.from("job_queue").delete().eq("id", job.id);
        reapedOrphanJobs++;
      }
    }
  }

  // 4. Reap duplicate pending jobs (keep oldest per package_id + job_type)
  const { data: pendingJobs } = await sb
    .from("job_queue")
    .select("id, package_id, job_type, created_at")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(1000);

  if (pendingJobs && pendingJobs.length > 0) {
    const seen = new Set<string>();
    for (const job of pendingJobs) {
      const key = `${job.package_id}::${job.job_type}`;
      if (seen.has(key)) {
        await sb.from("job_queue").delete().eq("id", job.id);
        reapedDuplicateJobs++;
      } else {
        seen.add(key);
      }
    }
  }

  // 5. WIP Enforcement: demote excess building packages
  // DM3: Read WIP cap from config (SSOT) instead of hardcoding
  let WIP_CAP = 14;
  try {
    const { data: wipCfg } = await sb
      .from("ops_pipeline_config")
      .select("value")
      .eq("key", "wip_total_cap")
      .maybeSingle();
    if (wipCfg?.value) WIP_CAP = Number(wipCfg.value) || 14;
  } catch { /* fallback to 14 */ }
  const { data: buildingPkgs } = await sb
    .from("course_packages")
    .select("id, priority, build_progress, updated_at")
    .eq("status", "building")
    .order("priority", { ascending: false })   // highest number (lowest prio) first
    .order("build_progress", { ascending: true })
    .order("updated_at", { ascending: true });

  const buildingCount = buildingPkgs?.length || 0;
  const excess = buildingCount - WIP_CAP;

  if (excess > 0 && buildingPkgs) {
    const toDemote = buildingPkgs.slice(0, excess);

    for (const pkg of toDemote) {
      // Demote to queued
      await sb.from("course_packages").update({
        status: "queued",
        updated_at: new Date().toISOString(),
      }).eq("id", pkg.id);

      // Cancel associated pending/failed jobs
      const { data: jobsToClear } = await sb
        .from("job_queue")
        .select("id")
        .eq("package_id", pkg.id)
        .in("status", ["pending", "failed"])
        .limit(100);

      for (const job of jobsToClear || []) {
        await sb.from("job_queue").update({
          status: "cancelled",
          last_error: "WIP_ENFORCEMENT: demoted to queued",
          updated_at: new Date().toISOString(),
        }).eq("id", job.id);
      }

      // Release leases
      const { data: leases } = await sb
        .from("system_execution_leases")
        .select("id")
        .eq("status", "active")
        .ilike("lease_key", `%${pkg.id}%`)
        .limit(10);

      for (const lease of leases || []) {
        await sb.from("system_execution_leases").update({
          status: "released",
          released_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).eq("id", lease.id);
      }

      // Audit
      await sb.from("admin_actions").insert({
        action: "wip_enforcement_demote",
        scope: "system",
        affected_ids: [pkg.id],
        payload: {
          priority: pkg.priority,
          build_progress: pkg.build_progress,
          wip_cap: WIP_CAP,
          building_count: buildingCount,
        },
        after_state: { new_status: "queued" },
      });

      await logOrphan(sb, "wip_enforcement", pkg.id, "warn",
        `Demoted package (prio=${pkg.priority}, progress=${pkg.build_progress}%) back to queued`, {
          wip_cap: WIP_CAP,
          building_count: buildingCount,
        });

      wipDemoted++;
    }
  }

  return json(200, {
    ok: true,
    released_leases: releasedLeases,
    stale_crons: staleCrons,
    reaped_orphan_jobs: reapedOrphanJobs,
    reaped_duplicate_jobs: reapedDuplicateJobs,
    wip_demoted: wipDemoted,
    wip_building: buildingCount,
    wip_cap: WIP_CAP,
  });
});
