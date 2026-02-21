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
 * Pipeline Auto-Scaler
 * 
 * Runs on a schedule (every 30 min). Checks error rate over the last 2 hours.
 * If error rate is ≤ 5% and current slots < target_max, scales up.
 * If error rate is > 15%, scales down to safety floor.
 * 
 * Config (ops_pipeline_config):
 *   - max_concurrent_packages: current WIP limit
 *   - autoscale_target_max: upper bound (default 12)
 *   - autoscale_floor: lower bound on scale-down (default 8)
 *   - autoscale_enabled: "true"/"false" (default "true")
 */

const WINDOW_HOURS = 2;
const MIN_SAMPLE_SIZE = 20; // need at least 20 jobs to decide
const SCALE_UP_THRESHOLD = 0.05; // ≤ 5% error rate → scale up
const SCALE_DOWN_THRESHOLD = 0.15; // > 15% error rate → scale down
const SCALE_STEP = 2;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  // Load config
  const { data: configs } = await sb.from("ops_pipeline_config").select("key, value");
  const cfg = Object.fromEntries((configs || []).map((c: any) => [c.key, c.value]));

  const enabled = cfg.autoscale_enabled !== "false";
  const currentSlots = parseInt(cfg.max_concurrent_packages || "10", 10);
  const targetMax = parseInt(cfg.autoscale_target_max || "12", 10);
  const floor = parseInt(cfg.autoscale_floor || "8", 10);

  if (!enabled) {
    return json({ action: "skip", reason: "autoscale_enabled=false", currentSlots });
  }

  // Query error rate over the last WINDOW_HOURS
  const since = new Date(Date.now() - WINDOW_HOURS * 60 * 60 * 1000).toISOString();

  const { data: stats } = await sb.rpc("sql", { query: "" }).maybeSingle();
  // Use direct query via count
  const { count: totalCount } = await sb
    .from("job_queue")
    .select("*", { count: "exact", head: true })
    .in("status", ["completed", "failed"])
    .gte("created_at", since);

  const { count: failedCount } = await sb
    .from("job_queue")
    .select("*", { count: "exact", head: true })
    .eq("status", "failed")
    .gte("created_at", since);

  const total = totalCount || 0;
  const failed = failedCount || 0;
  const errorRate = total > 0 ? failed / total : 0;

  const log: Record<string, unknown> = {
    ts: new Date().toISOString(),
    window_hours: WINDOW_HOURS,
    total_jobs: total,
    failed_jobs: failed,
    error_rate: Math.round(errorRate * 10000) / 100, // percent with 2 decimals
    current_slots: currentSlots,
    target_max: targetMax,
    floor,
  };

  let action = "hold";
  let newSlots = currentSlots;

  if (total < MIN_SAMPLE_SIZE) {
    action = "insufficient_data";
    log.reason = `Only ${total} jobs in window, need ${MIN_SAMPLE_SIZE}`;
  } else if (errorRate <= SCALE_UP_THRESHOLD && currentSlots < targetMax) {
    // Scale up
    newSlots = Math.min(currentSlots + SCALE_STEP, targetMax);
    action = "scale_up";
    log.reason = `Error rate ${log.error_rate}% ≤ ${SCALE_UP_THRESHOLD * 100}%, scaling ${currentSlots} → ${newSlots}`;
  } else if (errorRate > SCALE_DOWN_THRESHOLD && currentSlots > floor) {
    // Scale down
    newSlots = Math.max(currentSlots - SCALE_STEP, floor);
    action = "scale_down";
    log.reason = `Error rate ${log.error_rate}% > ${SCALE_DOWN_THRESHOLD * 100}%, scaling ${currentSlots} → ${newSlots}`;
  } else {
    log.reason = `Error rate ${log.error_rate}% — no action needed (slots=${currentSlots})`;
  }

  // Apply change
  if (newSlots !== currentSlots) {
    await sb
      .from("ops_pipeline_config")
      .update({ value: String(newSlots), updated_at: new Date().toISOString(), updated_by: "autoscaler" })
      .eq("key", "max_concurrent_packages");

    // Log the scaling event as admin notification
    await sb.from("admin_notifications").insert({
      title: `Auto-Scaler: ${action}`,
      body: `Slots ${currentSlots} → ${newSlots}. Fehlerrate: ${log.error_rate}% (${failed}/${total} in ${WINDOW_HOURS}h)`,
      severity: action === "scale_down" ? "warning" : "info",
      category: "pipeline",
    });
  }

  log.action = action;
  log.new_slots = newSlots;

  console.info(`[autoscaler] ${action}: ${JSON.stringify(log)}`);

  return json(log);
});
