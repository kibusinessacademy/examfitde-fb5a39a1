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
 * stuck-scan
 * Runs every 5 minutes via cron. Detects stuck packages and auto-retries recoverable jobs.
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  try {
    const STUCK_THRESHOLD_HOURS = 2;
    const stuckSince = new Date(Date.now() - STUCK_THRESHOLD_HOURS * 3600_000).toISOString();

    // 1) Find building packages with no progress for > threshold
    const { data: stuckPackages } = await sb
      .from("course_packages")
      .select("id, title, last_progress_at, stuck_reason")
      .eq("status", "building")
      .lt("last_progress_at", stuckSince);

    const results: Array<{ package_id: string; retried: number; reason: string }> = [];

    for (const pkg of stuckPackages || []) {
      // Check if there are failed jobs that can be retried
      const { data: retried } = await sb.rpc("auto_retry_stuck_package", {
        p_package_id: pkg.id,
      });

      const retriedCount = retried ?? 0;

      if (retriedCount === 0) {
        // No retryable jobs → mark stuck
        await sb.rpc("mark_package_stuck", {
          p_id: pkg.id,
          p_reason: `No progress for ${STUCK_THRESHOLD_HOURS}h, no retryable failed jobs`,
        });
      }

      results.push({
        package_id: pkg.id,
        retried: retriedCount,
        reason: retriedCount > 0
          ? `Auto-retried ${retriedCount} jobs`
          : `Marked stuck: no retryable jobs`,
      });
    }

    // 2) Clean stale processing jobs (no heartbeat > 10min)
    const staleJobThreshold = new Date(Date.now() - 600_000).toISOString();
    const { count: staleCount } = await sb
      .from("job_queue")
      .update({
        status: "pending",
        locked_at: null,
        locked_by: null,
        scheduled_at: new Date(Date.now() + 30_000).toISOString(),
        last_error: "Stale lock detected by stuck-scan",
      })
      .eq("status", "processing")
      .lt("locked_at", staleJobThreshold)
      .select("id", { count: "exact", head: true });

    console.log(`[stuck-scan] ${results.length} packages checked, ${staleCount ?? 0} stale jobs reset`);

    return json({
      ok: true,
      stuck_packages: results,
      stale_jobs_reset: staleCount ?? 0,
    });
  } catch (e: unknown) {
    const msg = (e as Error)?.message || String(e);
    console.error("[stuck-scan] Error:", msg);
    return json({ ok: false, error: msg }, 500);
  }
});
