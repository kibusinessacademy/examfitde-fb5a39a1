// Deno.serve is built-in
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";
import { validateAuth, unauthorizedResponse } from "../_shared/auth.ts";

Deno.serve(async (req) => {
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
    const action = body.action || "aggregate";

    if (action === "aggregate") {
      // 1) Collect all council snapshots
      const { data: states } = await admin
        .from("council_states")
        .select("council_id, status, last_snapshot, last_snapshot_at, is_paused, kill_switch");

      // 2) Collect open recommendations
      const { data: recs } = await admin
        .from("council_recommendations")
        .select("*")
        .eq("status", "open")
        .order("created_at", { ascending: false })
        .limit(50);

      // 3) Compute risk scores from live data
      const [{ data: jobs }, { data: aiUsage }, { data: gates }, { data: budgets }] = await Promise.all([
        admin.from("job_queue").select("status"),
        admin.from("ai_usage_log").select("cost_eur").limit(5000),
        admin.from("ai_quality_gates").select("gate_status").limit(2000),
        admin.from("ai_cost_budgets").select("budget_eur, spent_eur, month").order("month", { ascending: false }).limit(1),
      ]);

      const jobsArr = jobs || [];
      const failedJobs = jobsArr.filter((j: { status: string }) => j.status === "failed").length;
      const pendingJobs = jobsArr.filter((j: { status: string }) => j.status === "pending").length;
      const gatesArr = gates || [];
      const gateTotal = gatesArr.length;
      const gatePassed = gatesArr.filter((g: { gate_status: string }) => g.gate_status === "passed").length;
      const gatePassRate = gateTotal > 0 ? Math.round((gatePassed / gateTotal) * 100) : 100;
      const aiCost = (aiUsage || []).reduce((s: number, r: { cost_eur: number | null }) => s + (r.cost_eur || 0), 0);
      const budget = budgets?.[0];
      const budgetPct = budget ? Math.round((budget.spent_eur / budget.budget_eur) * 100) : 0;

      // Risk scores
      const risks = [
        {
          scope: "system", scope_id: "tech", risk_type: "system_risk",
          score: failedJobs > 5 ? 80 : failedJobs > 0 ? 50 : 10,
          evidence: { failedJobs, pendingJobs },
        },
        {
          scope: "system", scope_id: "quality", risk_type: "quality_risk",
          score: gatePassRate < 80 ? 80 : gatePassRate < 90 ? 50 : 10,
          evidence: { gatePassRate, gateTotal },
        },
        {
          scope: "system", scope_id: "budget", risk_type: "budget_risk",
          score: budgetPct > 90 ? 90 : budgetPct > 70 ? 50 : 10,
          evidence: { budgetPct, aiCost: Number(aiCost.toFixed(2)) },
        },
      ];

      // Upsert risk scores
      for (const r of risks) {
        await admin.from("risk_scores").upsert(
          { ...r, computed_at: new Date().toISOString() },
          { onConflict: "scope,scope_id,risk_type" }
        );
      }

      // 4) Generate decision items from high-impact recs that don't have one yet
      const highRecs = (recs || []).filter((r: { impact: string }) => r.impact === "high");
      for (const rec of highRecs) {
        const { data: existing } = await admin
          .from("decision_items")
          .select("id")
          .eq("source_id", rec.id)
          .eq("source_type", "recommendation")
          .maybeSingle();

        if (!existing) {
          const impactScore = rec.impact === "high" ? 80 : rec.impact === "medium" ? 50 : 20;
          const riskScore = rec.risk === "high" ? 80 : rec.risk === "medium" ? 50 : 20;
          await admin.from("decision_items").insert({
            title: rec.title,
            description: rec.details,
            council_id: rec.council_id,
            source_type: "recommendation",
            source_id: rec.id,
            impact_score: impactScore,
            risk_score: riskScore,
            effort_score: 30,
            priority_score: Math.round(impactScore * 0.5 + (100 - riskScore) * 0.3 + (100 - 30) * 0.2),
            requires_approval: true,
            status: "pending",
          });
        }
      }

      // 5) Auto-generate system recs based on risks
      if (failedJobs > 3) {
        await admin.from("council_recommendations").upsert({
          council_id: "tech",
          title: `${failedJobs} fehlgeschlagene Jobs erfordern Aufmerksamkeit`,
          details: "Prüfe Dead-Letter-Queue und starte Requeue für behebbare Fehler.",
          impact: failedJobs > 10 ? "high" : "medium",
          risk: "medium",
          source: "decision_engine",
          status: "open",
        }, { onConflict: "council_id,title" as never, ignoreDuplicates: true });
      }

      if (budgetPct > 80) {
        await admin.from("council_recommendations").upsert({
          council_id: "operations",
          title: `AI-Budget bei ${budgetPct}% – Optimierung prüfen`,
          details: "Reduziere Token-intensive Operationen oder erhöhe Budget nach ROI-Prüfung.",
          impact: budgetPct > 90 ? "high" : "medium",
          risk: "low",
          source: "decision_engine",
          status: "open",
        }, { onConflict: "council_id,title" as never, ignoreDuplicates: true });
      }

      // Fetch final decision queue
      const { data: decisions } = await admin
        .from("decision_items")
        .select("*")
        .eq("status", "pending")
        .order("priority_score", { ascending: false })
        .limit(10);

      // Fetch risk scores
      const { data: riskScores } = await admin
        .from("risk_scores")
        .select("*")
        .order("score", { ascending: false });

      return new Response(JSON.stringify({
        success: true,
        councils: (states || []).map((s: Record<string, unknown>) => ({
          id: s.council_id,
          status: s.status,
          isPaused: s.is_paused,
          killSwitch: s.kill_switch,
          lastSnapshotAt: s.last_snapshot_at,
        })),
        decisions: decisions || [],
        risks: riskScores || [],
        openRecommendations: (recs || []).length,
        systemHealth: {
          failedJobs,
          pendingJobs,
          gatePassRate,
          aiCostMtd: Number(aiCost.toFixed(2)),
          budgetPct,
        },
      }), { headers: jsonHeaders });
    }

    if (action === "decide") {
      const { itemId, decision, reason } = body;
      if (!itemId || !decision) {
        return new Response(JSON.stringify({ error: "itemId + decision required" }), { status: 400, headers: jsonHeaders });
      }

      await admin.from("decision_items").update({
        status: decision,
        decided_by: user.id,
        decided_at: new Date().toISOString(),
        decision_reason: reason || null,
      }).eq("id", itemId);

      return new Response(JSON.stringify({ success: true }), { headers: jsonHeaders });
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), { status: 400, headers: jsonHeaders });
  } catch (e) {
    console.error("[decision-engine] error", e);
    return new Response(JSON.stringify({ error: String((e as Error)?.message || e) }), { status: 500, headers: jsonHeaders });
  }
});
