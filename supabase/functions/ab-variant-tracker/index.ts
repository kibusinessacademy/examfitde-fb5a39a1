import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";

const logStep = (step: string, details?: Record<string, unknown>) => {
  console.log(`[AB-VARIANT-TRACKER] ${step}`, details ? JSON.stringify(details) : '');
};

/**
 * A/B Question Variant Tracker
 * 
 * Actions:
 * - "track": Record an attempt for a question variant (called by submit-exam-answer)
 * - "evaluate": Check variant groups and auto-promote winners
 * - "stats": Get variant comparison stats for admin
 */

const MIN_ATTEMPTS_FOR_EVALUATION = 30;
const WIN_MARGIN = 0.10; // 10% difference to declare winner

serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req);
  if (corsResponse) return corsResponse;

  const origin = req.headers.get('origin');
  const corsHeaders = getCorsHeaders(origin);

  try {
    logStep("Function started");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, supabaseServiceKey);

    const body = await req.json();
    const { action } = body;

    // ── TRACK: Record attempt ──
    if (action === 'track') {
      const { question_id, is_correct, time_seconds } = body;
      if (!question_id) {
        return new Response(JSON.stringify({ error: "question_id required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Get question's variant info
      const { data: question } = await admin
        .from('exam_questions')
        .select('id, variant_group, variant_label')
        .eq('id', question_id)
        .single();

      if (!question?.variant_group) {
        // Not part of an A/B test – skip
        return new Response(JSON.stringify({ tracked: false, reason: "no_variant_group" }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Upsert variant stats
      const { data: existing } = await admin
        .from('question_variant_stats')
        .select('id, attempts, correct, avg_time_seconds')
        .eq('question_id', question_id)
        .maybeSingle();

      if (existing) {
        const newAttempts = existing.attempts + 1;
        const newCorrect = existing.correct + (is_correct ? 1 : 0);
        const newAvgTime = existing.avg_time_seconds
          ? ((existing.avg_time_seconds * existing.attempts) + (time_seconds || 0)) / newAttempts
          : time_seconds || 0;

        await admin
          .from('question_variant_stats')
          .update({
            attempts: newAttempts,
            correct: newCorrect,
            avg_time_seconds: Math.round(newAvgTime * 10) / 10,
            updated_at: new Date().toISOString(),
          })
          .eq('id', existing.id);
      } else {
        await admin
          .from('question_variant_stats')
          .insert({
            question_id,
            variant_group: question.variant_group,
            variant_label: question.variant_label || 'A',
            attempts: 1,
            correct: is_correct ? 1 : 0,
            avg_time_seconds: time_seconds || 0,
          });
      }

      return new Response(JSON.stringify({ tracked: true }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── EVALUATE: Auto-promote winners ──
    if (action === 'evaluate') {
      // Find variant groups with enough data
      const { data: groups } = await admin
        .from('question_variant_stats')
        .select('variant_group')
        .gte('attempts', MIN_ATTEMPTS_FOR_EVALUATION)
        .is('promoted_at', null);

      const uniqueGroups = [...new Set((groups || []).map(g => g.variant_group))];
      logStep("Evaluating groups", { count: uniqueGroups.length });

      const promotions: any[] = [];

      for (const groupId of uniqueGroups) {
        const { data: variants } = await admin
          .from('question_variant_stats')
          .select('*')
          .eq('variant_group', groupId)
          .gte('attempts', MIN_ATTEMPTS_FOR_EVALUATION);

        if (!variants || variants.length < 2) continue;

        // Calculate success rates
        const rated = variants.map(v => ({
          ...v,
          success_rate: v.attempts > 0 ? v.correct / v.attempts : 0,
        }));

        // Sort by discrimination_index (if available) then success_rate
        rated.sort((a, b) => {
          // Prefer questions that discriminate well (not too easy, not too hard)
          const aDisc = a.discrimination_index ?? 0;
          const bDisc = b.discrimination_index ?? 0;
          if (Math.abs(aDisc - bDisc) > 0.1) return bDisc - aDisc;
          // Ideal success rate is 0.5-0.7 for exam questions
          const aIdeal = Math.abs(a.success_rate - 0.6);
          const bIdeal = Math.abs(b.success_rate - 0.6);
          return aIdeal - bIdeal;
        });

        const winner = rated[0];
        const loser = rated[rated.length - 1];

        // Only promote if there's meaningful difference
        const diff = Math.abs(winner.success_rate - loser.success_rate);
        if (diff < WIN_MARGIN) continue;

        // Promote winner to exam pool, demote loser to training
        await admin
          .from('exam_questions')
          .update({ status: 'approved' })
          .eq('id', winner.question_id);

        await admin
          .from('exam_questions')
          .update({ status: 'training' })
          .eq('id', loser.question_id);

        // Mark as promoted
        await admin
          .from('question_variant_stats')
          .update({ promoted_at: new Date().toISOString() })
          .eq('variant_group', groupId);

        promotions.push({
          group: groupId,
          winner: winner.variant_label,
          loser: loser.variant_label,
          winner_rate: Math.round(winner.success_rate * 100),
          loser_rate: Math.round(loser.success_rate * 100),
        });
      }

      logStep("Evaluation complete", { promotions: promotions.length });

      return new Response(JSON.stringify({ promotions, evaluated: uniqueGroups.length }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── STATS: Admin view ──
    if (action === 'stats') {
      const { data: stats } = await admin
        .from('question_variant_stats')
        .select('*')
        .order('updated_at', { ascending: false })
        .limit(100);

      // Group by variant_group
      const grouped: Record<string, any[]> = {};
      for (const s of (stats || [])) {
        if (!grouped[s.variant_group]) grouped[s.variant_group] = [];
        grouped[s.variant_group].push({
          ...s,
          success_rate: s.attempts > 0 ? Math.round((s.correct / s.attempts) * 100) : 0,
        });
      }

      return new Response(JSON.stringify({ groups: grouped, total: Object.keys(grouped).length }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logStep("ERROR", { message: msg });
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...getCorsHeaders(req.headers.get('origin')), "Content-Type": "application/json" },
    });
  }
});
