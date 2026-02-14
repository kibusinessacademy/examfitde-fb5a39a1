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
 * pipeline-watchdog — Runs every 5 minutes via cron
 *
 * 1. Expire stale steps (no heartbeat within timeout_seconds)
 * 2. Expire stale leases (lease_until < now)
 * 3. Mark orphaned building packages as failed
 * 4. Detect pipeline stalls (queued > 0 but nothing building)
 * 5. Auto-resolve stall alerts when pipeline is healthy
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
    // ── 1) Expire stale steps ──
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
    }>) ?? [];

    for (const s of staleSteps) {
      actions.push(
        `Step timeout: ${s.step_key} on pkg ${s.package_id.slice(0, 8)}`,
      );

      // Mark package as failed if step timed out
      await sb
        .from("course_packages")
        .update({
          status: "failed",
          last_error: `Watchdog: step '${s.step_key}' timed out (no heartbeat)`,
        })
        .eq("id", s.package_id)
        .eq("status", "building");

      // Alert (deduplicated)
      const alreadyAlerted = await hasRecentOpenAlert(
        sb,
        "pipeline-watchdog",
        s.package_id.slice(0, 8),
        10,
      );
      if (!alreadyAlerted) {
        await sb
          .from("ops_alerts")
          .insert({
            source: "pipeline-watchdog",
            severity: "error",
            message: `STEP_TIMEOUT: ${s.step_key} on pkg ${s.package_id.slice(0, 8)} (runner: ${s.runner_id ?? "unknown"})`,
            payload: {
              package_id: s.package_id,
              step_key: s.step_key,
              runner_id: s.runner_id,
            },
          })
          .catch(() => {});
      }
    }

    // ── 2) Expire stale leases ──
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

    for (const l of staleLeases) {
      actions.push(
        `Lease expired: pkg ${l.package_id.slice(0, 8)} (runner: ${l.runner_id})`,
      );

      // Mark package as failed if it was still building
      await sb
        .from("course_packages")
        .update({
          status: "failed",
          last_error: `Watchdog: lease expired for runner '${l.runner_id}'`,
        })
        .eq("id", l.package_id)
        .eq("status", "building");

      // Also release legacy locks if they exist
      await sb
        .rpc("release_pipeline_slot", { p_package_id: l.package_id })
        .catch(() => {});
      await sb
        .rpc("release_pipeline_lock", { p_package_id: l.package_id })
        .catch(() => {});
    }

    // ── 3) Orphaned building packages (no lease, still building) ──
    const { data: orphaned } = await sb
      .from("course_packages")
      .select("id")
      .eq("status", "building")
      .not(
        "id",
        "in",
        `(${(await sb.from("package_leases").select("package_id")).data?.map((r: { package_id: string }) => `"${r.package_id}"`).join(",") || "'00000000-0000-0000-0000-000000000000'"})`,
      );

    // Simpler approach: find building packages without a lease
    const { data: allLeases } = await sb
      .from("package_leases")
      .select("package_id");
    const leasedIds = new Set(
      (allLeases ?? []).map((r: { package_id: string }) => r.package_id),
    );

    const { data: buildingPkgs } = await sb
      .from("course_packages")
      .select("id")
      .eq("status", "building");

    const orphanedPkgs = (buildingPkgs ?? []).filter(
      (p: { id: string }) => !leasedIds.has(p.id),
    );

    for (const o of orphanedPkgs) {
      actions.push(`Orphaned building pkg: ${o.id.slice(0, 8)} → failed`);
      await sb
        .from("course_packages")
        .update({
          status: "failed",
          last_error: "Watchdog: building without lease (orphaned)",
        })
        .eq("id", o.id);
    }

    // ── 4) Stall detection ──
    const { count: queuedCount } = await sb
      .from("course_packages")
      .select("id", { count: "exact", head: true })
      .eq("status", "queued");

    const { count: buildingCount } = await sb
      .from("course_packages")
      .select("id", { count: "exact", head: true })
      .eq("status", "building");

    const isStalled =
      (queuedCount ?? 0) > 0 && (buildingCount ?? 0) === 0 && leasedIds.size === 0;

    if (isStalled) {
      const alreadyAlerted = await hasRecentOpenAlert(
        sb,
        "pipeline-watchdog",
        "PIPELINE_STALLED",
        10,
      );
      if (!alreadyAlerted) {
        await sb
          .from("ops_alerts")
          .insert({
            source: "pipeline-watchdog",
            severity: "error",
            message: `PIPELINE_STALLED: queued=${queuedCount} building=${buildingCount} leases=0`,
            payload: {
              queued: queuedCount,
              building: buildingCount,
              ts: new Date().toISOString(),
            },
          })
          .catch(() => {});
        actions.push(
          `PIPELINE_STALLED alert: queued=${queuedCount} building=${buildingCount}`,
        );
      }
    }

    // ── 5) Auto-resolve stall alerts when healthy ──
    const isHealthy = (buildingCount ?? 0) > 0 || leasedIds.size > 0;
    if (isHealthy) {
      await sb
        .from("ops_alerts")
        .update({ acknowledged_at: new Date().toISOString() })
        .eq("source", "pipeline-watchdog")
        .is("acknowledged_at", null)
        .ilike("message", "%PIPELINE_STALLED%")
        .catch(() => {});
    }

    // ── Log cycle ──
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
          stale_steps: staleSteps.length,
          stale_leases: staleLeases.length,
          orphaned: orphanedPkgs.length,
        },
      })
      .catch(() => {});

    console.log(
      `[watchdog] Cycle done: ${actions.length} actions, queued=${queuedCount} building=${buildingCount}`,
    );

    return json({
      ok: true,
      actions_count: actions.length,
      actions,
      queued: queuedCount,
      building: buildingCount,
    });
  } catch (e: unknown) {
    const msg = (e as Error)?.message || String(e);
    console.error("[watchdog] Error:", msg);
    await sb
      .from("ops_alerts")
      .insert({
        source: "pipeline-watchdog",
        severity: "error",
        message: `Watchdog crash: ${msg.slice(0, 500)}`,
      })
      .catch(() => {});
    return json({ ok: false, error: msg }, 500);
  }
});
