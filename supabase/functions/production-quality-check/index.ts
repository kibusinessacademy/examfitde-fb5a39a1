import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const body = await req.json().catch(() => ({}));
  const p = body.payload || body;
  const packageId = p.package_id;
  const curriculumId = p.curriculum_id;

  if (!packageId || !curriculumId) {
    return json({ error: "Missing package_id or curriculum_id" }, 400);
  }

  try {
    // Call the RPC that does all quality checks + snapshot
    const { data, error } = await sb.rpc("check_production_quality", {
      p_package_id: packageId,
      p_curriculum_id: curriculumId,
    });

    if (error) throw error;

    // Track provider performance from recent ai_usage_log
    const { data: usageRows } = await sb
      .from("ai_usage_log")
      .select("model, success, latency_ms, output_tokens, cost_eur")
      .gte("created_at", new Date(Date.now() - 3600_000).toISOString())
      .order("created_at", { ascending: false })
      .limit(500);

    if (usageRows?.length) {
      const byProvider: Record<string, {
        calls: number; ok: number; err: number;
        latSum: number; tokSum: number; costSum: number;
      }> = {};

      for (const r of usageRows) {
        const provider = (r.model || "unknown").split("/")[0] || r.model || "unknown";
        if (!byProvider[provider]) {
          byProvider[provider] = { calls: 0, ok: 0, err: 0, latSum: 0, tokSum: 0, costSum: 0 };
        }
        const b = byProvider[provider];
        b.calls++;
        if (r.success) b.ok++; else b.err++;
        b.latSum += r.latency_ms || 0;
        b.tokSum += r.output_tokens || 0;
        b.costSum += r.cost_eur || 0;
      }

      const today = new Date().toISOString().slice(0, 10);
      for (const [provider, stats] of Object.entries(byProvider)) {
        await sb.from("provider_performance").upsert({
          date: today,
          provider,
          model: provider,
          total_calls: stats.calls,
          success_count: stats.ok,
          error_count: stats.err,
          avg_latency_ms: stats.calls ? Math.round(stats.latSum / stats.calls) : 0,
          avg_tokens_out: stats.calls ? Math.round(stats.tokSum / stats.calls) : 0,
          total_cost_eur: Math.round(stats.costSum * 10000) / 10000,
        }, { onConflict: "date,provider,model" });
      }
    }

    console.log(`[QualityShield] Package ${packageId.slice(0, 8)}: `, JSON.stringify(data));

    return json({ ok: true, quality: data });
  } catch (e: unknown) {
    const msg = (e as Error)?.message || String(e);
    console.error(`[QualityShield] Error: ${msg}`);
    return json({ ok: false, error: msg }, 500);
  }
});
