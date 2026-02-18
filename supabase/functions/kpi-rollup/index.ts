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
 * kpi-rollup
 * Runs every 10 minutes. Computes daily KPI aggregates and upserts into kpi_daily_rollup.
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  try {
    const today = new Date().toISOString().slice(0, 10);
    const dayStart = `${today}T00:00:00Z`;

    // Packages
    const { count: pkgCompleted } = await sb.from("course_packages")
      .select("id", { count: "exact", head: true })
      .eq("status", "published")
      .gte("updated_at", dayStart);

    const { count: pkgStarted } = await sb.from("course_packages")
      .select("id", { count: "exact", head: true })
      .eq("status", "building")
      .gte("started_at", dayStart);

    // Jobs
    const { count: jobsCompleted } = await sb.from("job_queue")
      .select("id", { count: "exact", head: true })
      .eq("status", "completed")
      .gte("completed_at", dayStart);

    const { count: jobsFailed } = await sb.from("job_queue")
      .select("id", { count: "exact", head: true })
      .eq("status", "failed")
      .gte("created_at", dayStart);

    const { count: backlog } = await sb.from("job_queue")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending");

    // Costs — read from llm_cost_events (SSOT since Feb 2026, ai_usage_log is legacy)
    const { data: costData } = await sb.from("llm_cost_events")
      .select("cost_eur, model, provider, tokens_in, tokens_out")
      .gte("ts", dayStart);

    let costTotal = 0, costOpenai = 0, costAnthropic = 0, costGoogle = 0;
    let totalTokensIn = 0, totalTokensOut = 0, totalCalls = 0;
    for (const r of costData || []) {
      totalCalls++;
      const c = r.cost_eur || 0;
      costTotal += c;
      totalTokensIn += r.tokens_in || 0;
      totalTokensOut += r.tokens_out || 0;
      const model = (r.model || "").toLowerCase();
      if (model.includes("gpt") || model.includes("openai")) costOpenai += c;
      else if (model.includes("claude") || model.includes("anthropic")) costAnthropic += c;
      else if (model.includes("gemini") || model.includes("google")) costGoogle += c;
    }

    // Top error code
    const { data: topErr } = await sb.from("job_queue")
      .select("last_error_code")
      .eq("status", "failed")
      .not("last_error_code", "is", null)
      .gte("created_at", dayStart)
      .limit(100);

    const errCounts: Record<string, number> = {};
    for (const e of topErr || []) {
      errCounts[e.last_error_code] = (errCounts[e.last_error_code] || 0) + 1;
    }
    const topErrorCode = Object.entries(errCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

    // ETA
    const throughputPerHour = (jobsCompleted ?? 0) / Math.max(new Date().getUTCHours(), 1);
    const etaHours = throughputPerHour > 0 ? (backlog ?? 0) / throughputPerHour : 0;

    // Upsert daily rollup
    await sb.from("kpi_daily_rollup").upsert({
      day: today,
      packages_completed: pkgCompleted ?? 0,
      packages_started: pkgStarted ?? 0,
      jobs_completed: jobsCompleted ?? 0,
      jobs_failed: jobsFailed ?? 0,
      cost_total_eur: Math.round(costTotal * 100) / 100,
      cost_openai_eur: Math.round(costOpenai * 100) / 100,
      cost_anthropic_eur: Math.round(costAnthropic * 100) / 100,
      cost_google_eur: Math.round(costGoogle * 100) / 100,
      top_error_code: topErrorCode,
      backlog_jobs: backlog ?? 0,
      eta_hours: Math.round(etaHours * 10) / 10,
      updated_at: new Date().toISOString(),
    }, { onConflict: "day" });

    // FIX: Sync budget spent_eur from actual llm_cost_events (MTD)
    const currentMonth = today.slice(0, 7) + "-01"; // e.g. "2026-02-01"
    const { data: mtdAll } = await sb.from("llm_cost_events")
      .select("cost_eur")
      .gte("ts", `${currentMonth}T00:00:00Z`);
    const mtdSpent = (mtdAll || []).reduce((s: number, r: any) => s + (r.cost_eur || 0), 0);
    
    await sb.from("ai_cost_budgets")
      .update({ spent_eur: Math.round(mtdSpent * 100) / 100, updated_at: new Date().toISOString() })
      .eq("month", currentMonth);

    console.log(`[kpi-rollup] Day ${today}: ${jobsCompleted} completed, €${costTotal.toFixed(2)}, budget MTD €${mtdSpent.toFixed(2)}, ETA ${etaHours.toFixed(1)}h`);

    return json({
      ok: true,
      day: today,
      jobs_completed: jobsCompleted,
      cost_total_eur: costTotal,
      backlog: backlog,
      eta_hours: etaHours,
    });
  } catch (e: unknown) {
    const msg = (e as Error)?.message || String(e);
    console.error("[kpi-rollup] Error:", msg);
    return json({ ok: false, error: msg }, 500);
  }
});
