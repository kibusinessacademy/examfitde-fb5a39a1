// Deno.serve is built-in
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { validateAuth, unauthorizedResponse } from "../_shared/auth.ts";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";

type Severity = "low" | "medium" | "high" | "critical";

function severityFromScore(score: number): Severity {
  if (score >= 85) return "critical";
  if (score >= 65) return "high";
  if (score >= 40) return "medium";
  return "low";
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

Deno.serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req);
  if (corsResponse) return corsResponse;

  const origin = req.headers.get("origin");
  const headers = { ...getCorsHeaders(origin), "Content-Type": "application/json" };

  const auth = await validateAuth(req, true);
  if (auth.error) return unauthorizedResponse(auth.error, origin ?? undefined);
  if (!auth.user) return unauthorizedResponse("Not authenticated", origin ?? undefined);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceKey);

  try {
    const now = new Date().toISOString();

    // 1) Tech Risk: job failures
    const { data: jobs } = await admin.from("job_queue").select("status");
    const total = (jobs || []).length;
    const failed = (jobs || []).filter((j: { status: string }) => j.status === "failed").length;
    const pending = (jobs || []).filter((j: { status: string }) => j.status === "pending").length;
    const failRate = total > 0 ? failed / total : 0;
    const techScore = clamp(Math.round(failRate * 500 + (pending > 100 ? 30 : 0)), 0, 100);

    // 2) Quality Risk: validation scores
    const { data: vals } = await admin.from("ai_validations")
      .select("overall_score")
      .order("validated_at", { ascending: false })
      .limit(200);
    const allScores = (vals || []).map((v: { overall_score: number }) => Number(v.overall_score || 0)).filter((n: number) => n > 0);
    const lowCount = allScores.filter((s: number) => s < 92).length;
    const avg = allScores.length ? allScores.reduce((a: number, b: number) => a + b, 0) / allScores.length : 100;
    const qualityScore = clamp(Math.round((lowCount / Math.max(1, allScores.length)) * 200 + Math.max(0, 92 - avg) * 3), 0, 100);

    // 3) Budget Risk: AI cost vs budget
    const { data: usage } = await admin.from("ai_usage_log").select("cost_eur").limit(5000);
    const totalCost = (usage || []).reduce((s: number, r: { cost_eur: number }) => s + (r.cost_eur || 0), 0);
    const { data: budgets } = await admin.from("ai_cost_budgets")
      .select("budget_eur, spent_eur")
      .order("month", { ascending: false })
      .limit(1);
    const budget = budgets?.[0];
    const budgetPct = budget ? ((budget.spent_eur || totalCost) / Math.max(1, budget.budget_eur)) * 100 : 0;
    const budgetScore = clamp(Math.round(Math.max(0, budgetPct - 50) * 2), 0, 100);

    const scores = [
      {
        scope: "council", scope_id: "tech", risk_type: "system_risk",
        score: techScore,
        severity: severityFromScore(techScore),
        evidence: { totalJobs: total, failed, pending, failRate: Math.round(failRate * 100) },
      },
      {
        scope: "council", scope_id: "education", risk_type: "quality_risk",
        score: qualityScore,
        severity: severityFromScore(qualityScore),
        evidence: { totalValidations: allScores.length, below92: lowCount, avgScore: Math.round(avg * 10) / 10 },
      },
      {
        scope: "council", scope_id: "operations", risk_type: "budget_risk",
        score: budgetScore,
        severity: severityFromScore(budgetScore),
        evidence: { totalCostEur: Math.round(totalCost * 100) / 100, budgetEur: budget?.budget_eur ?? 0, usagePct: Math.round(budgetPct) },
      },
    ];

    // Upsert all risk scores
    for (const s of scores) {
      await admin.from("risk_scores").upsert(
        { ...s, computed_at: now },
        { onConflict: "scope,scope_id,risk_type" }
      );
    }

    // Auto-escalate critical risks
    const critical = scores.filter(s => s.severity === "critical");
    for (const c of critical) {
      const dedupeTitle = `[Auto] ${c.risk_type} critical: ${c.scope_id}`;
      const { data: existing } = await admin.from("council_escalations")
        .select("id")
        .eq("title", dedupeTitle)
        .eq("status", "open")
        .maybeSingle();
      if (!existing) {
        await admin.from("council_escalations").insert({
          source_council_id: c.scope_id,
          escalation_type: "auto_warning",
          severity: "critical",
          title: dedupeTitle,
          description: JSON.stringify(c.evidence),
          status: "open",
        });
      }
    }

    // Run escalation cycle for adaptive responses
    let escalationResult = null;
    try {
      const { data } = await admin.rpc("auto_escalation_cycle");
      escalationResult = data;
    } catch (e) {
      console.warn("[early-warning-engine] escalation cycle error:", e);
    }

    return new Response(JSON.stringify({ success: true, scores, escalated: critical.length, escalation: escalationResult }), { headers });
  } catch (e) {
    console.error("[early-warning-engine] error", e);
    return new Response(JSON.stringify({ error: String((e as Error)?.message || e) }), { status: 500, headers });
  }
});
