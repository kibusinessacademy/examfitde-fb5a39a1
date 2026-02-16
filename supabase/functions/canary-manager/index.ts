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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  try {
    const { action, ...params } = await req.json();

    // ─── Create a new canary release ───
    if (action === "create") {
      const { name, engine_version, baseline_version, traffic_pct, description } = params;
      if (!name || !engine_version || !baseline_version) {
        return json({ error: "name, engine_version, baseline_version required" }, 400);
      }

      // Pause any active canary first
      await sb.from("canary_releases")
        .update({ status: "paused", updated_at: new Date().toISOString() })
        .eq("status", "active");

      const { data, error } = await sb.from("canary_releases").insert({
        name,
        engine_version,
        baseline_version,
        traffic_pct: traffic_pct || 5,
        description: description || "",
        status: "active",
      }).select().single();

      if (error) throw error;
      return json({ ok: true, canary: data });
    }

    // ─── Route: decide which version a user gets ───
    if (action === "route") {
      const { data: activeCanary } = await sb.from("canary_releases")
        .select("id, engine_version, baseline_version, traffic_pct")
        .eq("status", "active")
        .maybeSingle();

      if (!activeCanary) {
        return json({ version: "baseline", canary_id: null });
      }

      // Simple hash-based routing
      const userId = params.user_id || "anonymous";
      let hash = 0;
      for (let i = 0; i < userId.length; i++) {
        hash = ((hash << 5) - hash) + userId.charCodeAt(i);
        hash |= 0;
      }
      const bucket = Math.abs(hash) % 100;
      const isCanary = bucket < (activeCanary.traffic_pct || 5);

      return json({
        version: isCanary ? activeCanary.engine_version : activeCanary.baseline_version,
        canary_id: activeCanary.id,
        is_canary: isCanary,
      });
    }

    // ─── Evaluate canary metrics ───
    if (action === "evaluate") {
      const { data: activeCanary } = await sb.from("canary_releases")
        .select("*")
        .eq("status", "active")
        .maybeSingle();

      if (!activeCanary) return json({ ok: true, msg: "No active canary" });

      // Snapshot current drift metrics
      const { data: baselineDrift } = await sb.from("drift_snapshots")
        .select("avg_quality_score, avg_discrimination, avg_praxis_score, style_rejection_rate")
        .eq("engine_version", activeCanary.baseline_version)
        .order("snapshot_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const { data: canaryDrift } = await sb.from("drift_snapshots")
        .select("avg_quality_score, avg_discrimination, avg_praxis_score, style_rejection_rate")
        .eq("engine_version", activeCanary.engine_version)
        .order("snapshot_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const metrics_baseline = baselineDrift || {};
      const metrics_canary = canaryDrift || {};

      // Compute delta
      const bScore = (baselineDrift?.avg_quality_score || 0);
      const cScore = (canaryDrift?.avg_quality_score || 0);
      const delta = cScore - bScore;

      let newStatus = "active";
      let decidedBy: string | null = null;

      if (delta >= (activeCanary.auto_promote_threshold || 5)) {
        newStatus = "promoted";
        decidedBy = "auto";
      } else if (delta <= (activeCanary.auto_rollback_threshold || -5)) {
        newStatus = "rolled_back";
        decidedBy = "auto";
      }

      await sb.from("canary_releases").update({
        metrics_baseline,
        metrics_canary,
        evaluated_at: new Date().toISOString(),
        status: newStatus,
        decided_at: decidedBy ? new Date().toISOString() : null,
        decided_by: decidedBy,
        updated_at: new Date().toISOString(),
      }).eq("id", activeCanary.id);

      return json({
        ok: true,
        delta,
        status: newStatus,
        baseline: metrics_baseline,
        canary: metrics_canary,
      });
    }

    // ─── Manual promote / rollback ───
    if (action === "decide") {
      const { canary_id, decision, decided_by } = params;
      if (!canary_id || !decision) return json({ error: "canary_id + decision required" }, 400);

      await sb.from("canary_releases").update({
        status: decision, // 'promoted' or 'rolled_back'
        decided_at: new Date().toISOString(),
        decided_by: decided_by || "admin",
        updated_at: new Date().toISOString(),
      }).eq("id", canary_id);

      return json({ ok: true });
    }

    // ─── Take drift snapshot ───
    if (action === "snapshot_drift") {
      const { engine_version } = params;
      if (!engine_version) return json({ error: "engine_version required" }, 400);

      // Compute averages from recent questions
      const { data: recent } = await sb.from("exam_questions")
        .select("quality_score, praxis_score")
        .gte("created_at", new Date(Date.now() - 24 * 3600 * 1000).toISOString())
        .limit(1000);

      const { data: discrim } = await sb.from("question_discrimination_stats")
        .select("discrimination_index")
        .gte("updated_at", new Date(Date.now() - 24 * 3600 * 1000).toISOString())
        .limit(1000);

      const avgQ = recent?.length ? recent.reduce((a, r) => a + (r.quality_score || 0), 0) / recent.length : 0;
      const avgP = recent?.length ? recent.reduce((a, r) => a + (r.praxis_score || 0), 0) / recent.length : 0;
      const avgD = discrim?.length ? discrim.reduce((a, r) => a + (r.discrimination_index || 0), 0) / discrim.length : 0;

      // Check for drift
      const { data: prevSnapshot } = await sb.from("drift_snapshots")
        .select("avg_quality_score, avg_discrimination")
        .eq("engine_version", engine_version)
        .order("snapshot_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const qDrift = prevSnapshot ? Math.abs(avgQ - (prevSnapshot.avg_quality_score || 0)) : 0;
      const dDrift = prevSnapshot ? Math.abs(avgD - (prevSnapshot.avg_discrimination || 0)) : 0;
      const driftAlert = qDrift > 10 || dDrift > 0.1;

      await sb.from("drift_snapshots").insert({
        engine_version,
        avg_quality_score: Math.round(avgQ * 100) / 100,
        avg_discrimination: Math.round(avgD * 10000) / 10000,
        avg_praxis_score: Math.round(avgP * 100) / 100,
        sample_size: recent?.length || 0,
        drift_alert: driftAlert,
        drift_detail: { q_drift: qDrift, d_drift: dDrift },
      });

      return json({ ok: true, drift_alert: driftAlert, avg_quality: avgQ, avg_discrimination: avgD });
    }

    // ─── List canaries ───
    if (action === "list") {
      const { data } = await sb.from("canary_releases")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(20);

      return json({ ok: true, canaries: data || [] });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e: unknown) {
    console.error("[canary-manager]", e);
    return json({ error: (e as Error)?.message || String(e) }, 500);
  }
});
