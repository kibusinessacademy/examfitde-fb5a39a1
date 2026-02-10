import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";
import { validateAuth, forbiddenResponse, unauthorizedResponse } from "../_shared/auth.ts";

type Action =
  | "get_snapshot"
  | "pause"
  | "resume"
  | "kill_on"
  | "kill_off"
  | "run_auto_improve";

function nowIso() { return new Date().toISOString(); }

serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req);
  if (corsResponse) return corsResponse;
  const origin = req.headers.get("origin");
  const corsHeaders = getCorsHeaders(origin);
  const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };

  const { user, error } = await validateAuth(req, true);
  if (error) return unauthorizedResponse(error, origin || undefined);
  if (!user) return unauthorizedResponse("Not authenticated", origin || undefined);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceKey);

  try {
    const body = await req.json().catch(() => ({}));
    const action: Action = body.action;
    const councilId: string = body.councilId;

    if (!action || !councilId) {
      return new Response(JSON.stringify({ error: "action + councilId required" }), { status: 400, headers: jsonHeaders });
    }

    const { data: state } = await admin
      .from("council_states")
      .select("*")
      .eq("council_id", councilId)
      .maybeSingle();

    const isPaused = !!state?.is_paused;
    const killSwitch = !!state?.kill_switch;

    if (killSwitch && action !== "kill_off" && action !== "get_snapshot") {
      return forbiddenResponse("Kill-Switch is active. Disable it first.", origin || undefined);
    }

    // State mutations
    if (["pause", "resume", "kill_on", "kill_off"].includes(action)) {
      const patch: Record<string, unknown> = {};
      if (action === "pause") patch.is_paused = true;
      if (action === "resume") patch.is_paused = false;
      if (action === "kill_on") patch.kill_switch = true;
      if (action === "kill_off") patch.kill_switch = false;

      await admin.from("council_states").update(patch).eq("council_id", councilId);
      await admin.from("council_events").insert({
        council_id: councilId,
        event_type: action,
        actor_user_id: user.id,
        payload: { at: nowIso() },
      });

      return new Response(JSON.stringify({ success: true }), { headers: jsonHeaders });
    }

    // Auto-Improve (education only)
    if (action === "run_auto_improve") {
      if (councilId !== "education") {
        return new Response(JSON.stringify({ error: "run_auto_improve only for education council" }), { status: 400, headers: jsonHeaders });
      }
      if (isPaused) return forbiddenResponse("Council is paused.", origin || undefined);

      const courseId: string | undefined = body.courseId;
      const maxLessons: number = Number(body.maxLessons ?? 3);
      if (!courseId) {
        return new Response(JSON.stringify({ error: "courseId required" }), { status: 400, headers: jsonHeaders });
      }

      const auditUrl = `${supabaseUrl}/functions/v1/ihk-quality-audit`;
      const improveUrl = `${supabaseUrl}/functions/v1/improve-lesson`;

      const auditRes = await fetch(auditUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
        body: JSON.stringify({ courseId }),
      });
      if (!auditRes.ok) {
        const t = await auditRes.text();
        throw new Error(`ihk-quality-audit failed: ${t}`);
      }
      const auditJson = await auditRes.json();

      const improveRes = await fetch(improveUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
        body: JSON.stringify({ courseId, maxLessons }),
      });
      if (!improveRes.ok) {
        const t = await improveRes.text();
        throw new Error(`improve-lesson failed: ${t}`);
      }
      const improveJson = await improveRes.json();

      await admin.from("council_events").insert({
        council_id: councilId,
        event_type: "run_action",
        actor_user_id: user.id,
        payload: { action: "run_auto_improve", courseId, maxLessons, audit: auditJson, result: improveJson },
      });

      return new Response(JSON.stringify({ success: true, audit: auditJson, result: improveJson }), { headers: jsonHeaders });
    }

    // get_snapshot
    if (action === "get_snapshot") {
      const snapshot = await buildCouncilSnapshot(admin, councilId);

      await admin.from("council_states").update({
        last_snapshot: snapshot,
        last_snapshot_at: nowIso(),
        status: snapshot.status,
      }).eq("council_id", councilId);

      await admin.from("council_events").insert({
        council_id: councilId,
        event_type: "snapshot",
        actor_user_id: user.id,
        payload: { snapshot },
      });

      return new Response(JSON.stringify({ success: true, ...snapshot, state: { isPaused, killSwitch } }), { headers: jsonHeaders });
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), { status: 400, headers: jsonHeaders });
  } catch (e) {
    console.error("[council-api] error", e);
    return new Response(JSON.stringify({ error: String((e as Error)?.message || e) }), { status: 500, headers: jsonHeaders });
  }
});

async function buildCouncilSnapshot(admin: ReturnType<typeof createClient>, councilId: string) {
  const { data: autos } = await admin
    .from("council_automations")
    .select("automation_key, enabled, last_run_at, last_result")
    .eq("council_id", councilId);

  const [{ data: jobs }, { data: aiUsage }, { data: gates }] = await Promise.all([
    admin.from("job_queue").select("status"),
    admin.from("ai_usage_log").select("cost_eur").limit(5000),
    admin.from("ai_quality_gates").select("gate_status").limit(2000),
  ]);

  const jobsData = jobs || [];
  const aiData = aiUsage || [];
  const gatesData = gates || [];

  const jobsFailed = jobsData.filter((j: { status: string }) => j.status === "failed").length;
  const jobsPending = jobsData.filter((j: { status: string }) => j.status === "pending").length;
  const gatesTotal = gatesData.length;
  const gatesPassed = gatesData.filter((g: { gate_status: string }) => g.gate_status === "passed").length;
  const gatePassRate = gatesTotal > 0 ? Math.round((gatesPassed / gatesTotal) * 100) : 100;
  const aiCostMtd = aiData.reduce((s: number, r: { cost_eur: number | null }) => s + (r.cost_eur || 0), 0);

  let kpis: Array<{ label: string; value: number; unit: string; progress: number; trend: string }> = [];
  const recommendations: Array<{ title: string; details: string; impact: string; risk: string; source: string }> = [];

  if (councilId === "education") {
    const { data: vals } = await admin
      .from("ai_validations")
      .select("overall_score")
      .order("validated_at", { ascending: false })
      .limit(500);

    const scores = (vals || []).map((v: { overall_score: number }) => Number(v.overall_score || 0)).filter((n: number) => n > 0);
    const avg = scores.length ? Math.round(scores.reduce((a: number, b: number) => a + b, 0) / scores.length) : 0;
    const low = scores.filter((s: number) => s > 0 && s < 92).length;

    kpis = [
      { label: "Ø Quality Score", value: avg, unit: "", progress: Math.min(100, avg), trend: avg >= 92 ? "up" : "down" },
      { label: "Lessons < 92", value: low, unit: "", progress: low === 0 ? 100 : Math.max(0, 100 - Math.min(100, low * 10)), trend: low === 0 ? "up" : "down" },
      { label: "Quality Gate Pass", value: gatePassRate, unit: "%", progress: gatePassRate, trend: gatePassRate >= 90 ? "up" : "down" },
      { label: "Jobs Failed", value: jobsFailed, unit: "", progress: jobsFailed === 0 ? 100 : Math.max(0, 100 - Math.min(100, jobsFailed * 10)), trend: jobsFailed === 0 ? "up" : "down" },
    ];

    if (low > 0) {
      recommendations.push({
        title: `${low} Lessons unter Threshold (<92)`,
        details: "Starte Auto-Improve (Audit → Improve) für die schwächsten Lessons.",
        impact: "high",
        risk: "medium",
        source: "system",
      });
    }
  } else if (councilId === "tech") {
    kpis = [
      { label: "Jobs Pending", value: jobsPending, unit: "", progress: jobsPending > 50 ? 40 : 80, trend: jobsPending > 50 ? "down" : "up" },
      { label: "Jobs Failed", value: jobsFailed, unit: "", progress: jobsFailed === 0 ? 100 : 60, trend: jobsFailed === 0 ? "up" : "down" },
      { label: "Gate Pass", value: gatePassRate, unit: "%", progress: gatePassRate, trend: gatePassRate >= 90 ? "up" : "down" },
      { label: "AI Cost MTD", value: Number(aiCostMtd.toFixed(2)), unit: "€", progress: 50, trend: "up" },
    ];
    if (jobsFailed > 0) {
      recommendations.push({ title: "Fehlgeschlagene Jobs vorhanden", details: "Öffne Jobs/Deadletter und requeue.", impact: "high", risk: "low", source: "system" });
    }
  } else {
    kpis = [
      { label: "Gate Pass", value: gatePassRate, unit: "%", progress: gatePassRate, trend: gatePassRate >= 90 ? "up" : "down" },
      { label: "AI Cost MTD", value: Number(aiCostMtd.toFixed(2)), unit: "€", progress: 50, trend: "up" },
      { label: "Jobs Pending", value: jobsPending, unit: "", progress: jobsPending > 50 ? 40 : 80, trend: jobsPending > 50 ? "down" : "up" },
      { label: "Jobs Failed", value: jobsFailed, unit: "", progress: jobsFailed === 0 ? 100 : 60, trend: jobsFailed === 0 ? "up" : "down" },
    ];
  }

  // Fetch persisted recommendations
  const { data: dbRecs } = await admin
    .from("council_recommendations")
    .select("title, details, impact, risk, source")
    .eq("council_id", councilId)
    .eq("status", "open")
    .order("created_at", { ascending: false })
    .limit(10);

  const allRecs = [...recommendations, ...(dbRecs || [])];

  const status = jobsFailed > 0 ? "critical" : (jobsPending > 50 || gatePassRate < 85) ? "warning" : "ok";

  return {
    councilId,
    status,
    kpis,
    automations: (autos || []).map((a: { automation_key: string; enabled: boolean; last_run_at: string | null }) => ({
      key: a.automation_key,
      enabled: !!a.enabled,
      lastRunAt: a.last_run_at,
    })),
    recommendations: allRecs,
    generatedAt: nowIso(),
  };
}
