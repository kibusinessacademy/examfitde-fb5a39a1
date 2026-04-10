import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";
import { validateAuth, unauthorizedResponse } from "../_shared/auth.ts";

Deno.serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req);
  if (corsResponse) return corsResponse;
  const origin = req.headers.get("origin");
  const corsHeaders = getCorsHeaders(origin);
  const jsonH = { ...corsHeaders, "Content-Type": "application/json" };

  const { user, error } = await validateAuth(req, true);
  if (error) return unauthorizedResponse(error, origin || undefined);
  if (!user) return unauthorizedResponse("Not authenticated", origin || undefined);

  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(url, key);

  try {
    const body = await req.json().catch(() => ({}));
    const snapshotType = body.snapshot_type || "on_demand";

    // Build all metrics in parallel via RPCs
    const [learning, seo, content, revenue, growth, product, risk, opportunity] = await Promise.all([
      admin.rpc("fn_build_learning_metrics_snapshot").then(r => r.data || {}),
      admin.rpc("fn_build_seo_metrics_snapshot").then(r => r.data || {}),
      admin.rpc("fn_build_content_metrics_snapshot").then(r => r.data || {}),
      admin.rpc("fn_build_revenue_metrics_snapshot").then(r => r.data || {}),
      admin.rpc("fn_build_growth_metrics_snapshot").then(r => r.data || {}),
      admin.rpc("fn_build_product_metrics_snapshot").then(r => r.data || {}),
      admin.rpc("fn_build_risk_metrics_snapshot").then(r => r.data || {}),
      admin.rpc("fn_build_opportunity_metrics_snapshot").then(r => r.data || {}),
    ]);

    // Build summary
    const riskScore = (risk.stalled_packages || 0) + (risk.failed_jobs_24h || 0) + (risk.qgf_packages || 0);
    const oppScore = (opportunity.keywords_without_content || 0) + (opportunity.publishable_packages || 0);
    const summary = {
      overall_health: riskScore > 20 ? "critical" : riskScore > 10 ? "warning" : "healthy",
      top_risk: risk.failed_jobs_24h > 5 ? "high_failure_rate" : risk.stalled_packages > 3 ? "stalled_packages" : "none",
      top_opportunity: opportunity.keywords_without_content > 10 ? "content_gaps" : opportunity.publishable_packages > 0 ? "publishable_packages" : "none",
      risk_score: riskScore,
      opportunity_score: oppScore,
    };

    // Insert snapshot
    const { data: snap, error: insertErr } = await admin.from("business_brain_snapshots").insert({
      snapshot_type: snapshotType,
      learning_metrics: learning,
      seo_metrics: seo,
      content_metrics: content,
      revenue_metrics: revenue,
      growth_metrics: growth,
      product_metrics: product,
      risk_metrics: risk,
      opportunity_metrics: opportunity,
      summary,
    }).select("id").single();

    if (insertErr) throw insertErr;

    // Run priority scoring
    await admin.rpc("fn_compute_business_priority_scores", { p_snapshot_id: snap.id });

    // Apply goal alignment
    await admin.rpc("fn_apply_business_goals_to_recommendations");

    return new Response(JSON.stringify({
      success: true,
      snapshot_id: snap.id,
      summary,
      metrics: { learning, seo, content, revenue, growth, product, risk, opportunity },
    }), { headers: jsonH });
  } catch (e) {
    console.error("[business-brain-snapshot]", e);
    return new Response(JSON.stringify({ error: String((e as Error)?.message || e) }), { status: 500, headers: jsonH });
  }
});
