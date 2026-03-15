import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";

/**
 * snapshot-exam-readiness
 * 
 * Calls the existing calculate_exam_readiness RPC and persists
 * the result as a snapshot for trend tracking.
 * 
 * Also generates user_recommendations based on weaknesses.
 * 
 * Trigger: after exam simulation, after minicheck, nightly cron
 */

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  const preflight = handleCorsPreflightRequest(req, corsHeaders);
  if (preflight) return preflight;

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { curriculum_id } = await req.json();
    if (!curriculum_id) {
      return new Response(JSON.stringify({ error: "curriculum_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 1. Call existing readiness RPC
    const { data: readiness, error: rpcError } = await supabase.rpc('calculate_exam_readiness', {
      p_user_id: user.id,
      p_curriculum_id: curriculum_id,
    });

    if (rpcError) throw rpcError;
    if (!readiness) {
      return new Response(JSON.stringify({ error: "No readiness data" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const r = readiness as Record<string, unknown>;

    // 2. Map risk level
    const score = Number(r.overall_readiness || 0);
    const riskLevel = score >= 80 ? 'exam_ready'
      : score >= 65 ? 'on_track'
      : score >= 40 ? 'medium_risk'
      : 'high_risk';

    // 3. Calculate confidence based on data density
    const totalComp = Number(r.total_competencies || 0);
    const masteredCount = Number(r.mastered_count || 0);
    const partialCount = Number(r.partial_count || 0);
    const notMasteredCount = Number(r.not_mastered_count || 0);
    const assessedCount = masteredCount + partialCount + notMasteredCount;
    const confidenceScore = totalComp > 0 ? Math.round((assessedCount / totalComp) * 100) : 0;

    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // 4. Persist snapshot
    const { error: snapError } = await serviceClient
      .from('exam_readiness_snapshots')
      .insert({
        user_id: user.id,
        curriculum_id,
        readiness_score: score,
        risk_level: riskLevel,
        confidence_score: confidenceScore,
        based_on_competencies: totalComp,
        mastered_count: masteredCount,
        partial_count: partialCount,
        not_mastered_count: notMasteredCount,
        last_exam_sim_score: r.last_simulation_score ?? null,
        weak_competencies: r.weak_competencies || [],
        strong_competencies: r.strong_competencies || [],
      });

    if (snapError) throw snapError;

    // 5. Generate recommendations from weaknesses
    const weakComps = (r.weak_competencies || []) as Array<{
      competency_id: string; title: string; code: string; score: number;
    }>;

    if (weakComps.length > 0) {
      // Deactivate old recommendations
      await serviceClient
        .from('user_recommendations')
        .update({ is_active: false })
        .eq('user_id', user.id)
        .eq('curriculum_id', curriculum_id)
        .eq('is_active', true);

      // Insert new recommendations
      const recs = weakComps.slice(0, 5).map((wc, i) => ({
        user_id: user.id,
        curriculum_id,
        recommendation_type: 'lesson',
        target_id: wc.competency_id,
        target_meta: { competency_title: wc.title, competency_code: wc.code, score: wc.score },
        reason_code: wc.score < 40 ? 'LOW_MASTERY_HIGH_WEIGHT' : 'WEAKNESS_CLUSTER_DETECTED',
        reason_text: `${wc.title} (${wc.code}): nur ${wc.score}% – Training empfohlen`,
        priority_score: 100 - wc.score + (5 - i), // lower score = higher priority
        is_active: true,
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      }));

      // Add exam sim recommendation if readiness >= 65
      if (score >= 65 && Number(r.last_simulation_score || 0) < 70) {
        recs.push({
          user_id: user.id,
          curriculum_id,
          recommendation_type: 'exam_sim',
          target_id: null as any,
          target_meta: {},
          reason_code: 'PRE_EXAM_SIM_REQUIRED',
          reason_text: 'Deine Prüfungsreife ist hoch genug für eine Simulation',
          priority_score: 95,
          is_active: true,
          expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        });
      }

      await serviceClient.from('user_recommendations').insert(recs);
    }

    return new Response(JSON.stringify({
      ok: true,
      readiness_score: score,
      risk_level: riskLevel,
      confidence_score: confidenceScore,
      recommendations_count: weakComps.length,
    }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error("[snapshot-exam-readiness] Error:", err);
    return new Response(JSON.stringify({ error: err.message || "Internal error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
