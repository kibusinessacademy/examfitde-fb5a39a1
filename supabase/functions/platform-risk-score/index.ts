import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";

serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req);
  if (corsResponse) return corsResponse;

  const origin = req.headers.get("origin");
  const headers = { ...getCorsHeaders(origin), "Content-Type": "application/json" };

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey);

    // ── 1. Security Score ──
    const { data: usingTrue } = await admin.rpc('exec_sql_readonly', {
      query: `SELECT count(*) as cnt FROM pg_policies WHERE qual::text = 'true' AND roles::text NOT LIKE '%service_role%'`
    }).maybeSingle();

    const { data: noRls } = await admin.rpc('exec_sql_readonly', {
      query: `SELECT count(*) as cnt FROM pg_tables WHERE schemaname='public' AND NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON c.relnamespace=n.oid WHERE n.nspname='public' AND c.relname=pg_tables.tablename AND c.relrowsecurity=true)`
    }).maybeSingle();

    const policyIssues = parseInt(usingTrue?.cnt || '0');
    const noRlsCount = parseInt(noRls?.cnt || '0');
    const securityScore = Math.max(0, 100 - (policyIssues * 5) - (noRlsCount * 10));

    // ── 2. Quality Score ──
    const { data: packages } = await admin
      .from('course_packages')
      .select('status, integrity_passed')
      .limit(100);

    const totalPkgs = packages?.length || 1;
    const passedPkgs = packages?.filter((p: any) => p.integrity_passed).length || 0;
    const qualityScore = Math.round((passedPkgs / totalPkgs) * 100);

    // ── 3. Compliance Score ──
    const { data: compResults } = await admin
      .from('azav_compliance_results')
      .select('result')
      .order('check_date', { ascending: false })
      .limit(50);

    const totalComp = compResults?.length || 1;
    const passedComp = compResults?.filter((r: any) => r.result === 'pass').length || 0;
    const complianceScore = Math.round((passedComp / totalComp) * 100);

    // ── 4. Operational Score ──
    const { data: jobs } = await admin
      .from('job_queue')
      .select('status')
      .in('status', ['failed', 'stuck', 'completed'])
      .gte('created_at', new Date(Date.now() - 86400000).toISOString())
      .limit(500);

    const totalJobs = jobs?.length || 1;
    const failedJobs = jobs?.filter((j: any) => j.status === 'failed' || j.status === 'stuck').length || 0;
    const operationalScore = Math.round(((totalJobs - failedJobs) / totalJobs) * 100);

    // ── Overall ──
    const overallScore = Math.round(
      securityScore * 0.35 +
      qualityScore * 0.25 +
      complianceScore * 0.20 +
      operationalScore * 0.20
    );

    const recommendations: string[] = [];
    if (securityScore < 90) recommendations.push('Security-Policies prüfen: USING(true) oder fehlende RLS gefunden');
    if (qualityScore < 80) recommendations.push('Integrity Checks: Nicht alle Packages bestanden');
    if (complianceScore < 90) recommendations.push('AZAV Compliance: Offene Prüfungen nacharbeiten');
    if (operationalScore < 90) recommendations.push('Operations: Erhöhte Job-Fehlerrate in den letzten 24h');

    // ── Save ──
    const today = new Date().toISOString().slice(0, 10);
    await admin.from('platform_risk_scores').upsert({
      score_date: today,
      overall_score: overallScore,
      security_score: securityScore,
      quality_score: qualityScore,
      compliance_score: complianceScore,
      operational_score: operationalScore,
      dimensions: { policyIssues, noRlsCount, totalPkgs, passedPkgs, totalComp, passedComp, totalJobs, failedJobs },
      recommendations,
    }, { onConflict: 'score_date' });

    // Save audit snapshot
    await admin.from('security_audit_snapshots').insert({
      policies_with_using_true: policyIssues,
      functions_without_search_path: 0,
      views_without_invoker: 0,
      tables_without_rls: noRlsCount,
      total_issues: policyIssues + noRlsCount,
      details: { policyIssues, noRlsCount },
    });

    return new Response(JSON.stringify({
      success: true,
      overall_score: overallScore,
      security_score: securityScore,
      quality_score: qualityScore,
      compliance_score: complianceScore,
      operational_score: operationalScore,
      recommendations,
    }), { headers });

  } catch (e) {
    console.error("[platform-risk-score]", e);
    return new Response(JSON.stringify({ error: String((e as Error)?.message || e) }), { status: 500, headers });
  }
});
