/**
 * Worker-Liveness Reconciler
 *
 * Called by cron every 5 minutes. Detects worker-pool stalls and:
 * 1. Logs a liveness finding to admin_notifications
 * 2. Bumps stale future-blocked jobs to now()
 * 3. Reports liveness stats
 */
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req);
  if (corsResponse) return corsResponse;
  const origin = req.headers.get("origin");
  const cors = getCorsHeaders(origin);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    // 1. Read liveness state
    const { data: liveness } = await sb
      .from("v_ops_worker_liveness")
      .select("*")
      .single();

    if (!liveness) return json({ error: "Could not read liveness view" }, 500);

    const actions: string[] = [];

    // 2. If stalled: notify + bump
    if (liveness.worker_pool_stalled) {
      // Write admin notification
      await sb.from("admin_notifications").insert({
        title: `Worker-Pool stalled: ${liveness.claimable_now} claimable, 0 processing`,
        body: `Ältester claimabler Job: ${liveness.oldest_claimable_hours}h. Automatischer Bump wird ausgeführt.`,
        category: "pipeline",
        severity: "critical",
        entity_type: "system",
        metadata: liveness,
      });
      actions.push("stall_notification_sent");
    }

    // 3. Bump future-blocked pending jobs older than 30 min
    const thirtyMinAgo = new Date(Date.now() - 30 * 60_000).toISOString();
    const { data: bumped, error: bumpErr } = await sb
      .from("job_queue")
      .update({ run_after: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("status", "pending")
      .gt("run_after", new Date().toISOString())
      .lt("created_at", thirtyMinAgo)
      .is("locked_by", null)
      .select("id");

    if (!bumpErr && bumped && bumped.length > 0) {
      actions.push(`bumped_${bumped.length}_future_blocked_jobs`);
    }

    // 4. Detect zombie-blocked packages (blocked but enrichment done)
    const { data: zombies } = await sb
      .from("course_packages")
      .select("id, title, track, blocked_reason")
      .eq("status", "blocked")
      .not("blocked_reason", "is", null)
      .limit(10);

    const zombieCount = zombies?.length ?? 0;
    if (zombieCount > 0) {
      actions.push(`found_${zombieCount}_zombie_blocked_packages`);
    }

    // 5. Log to auto_heal_log
    await sb.from("auto_heal_log").insert({
      action_type: "worker_liveness_check",
      trigger_source: "cron_reconciler",
      result_status: liveness.worker_pool_stalled ? "stall_detected" : "healthy",
      result_detail: JSON.stringify({
        ...liveness,
        actions,
        zombie_blocked: zombieCount,
      }),
    });

    console.log(`[worker-liveness] processing=${liveness.processing_count} claimable=${liveness.claimable_now} stalled=${liveness.worker_pool_stalled} actions=${actions.join(",")}`);

    return json({
      ok: true,
      liveness,
      actions,
      zombie_blocked_count: zombieCount,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[worker-liveness] error:`, msg);
    return json({ error: msg }, 500);
  }
});
