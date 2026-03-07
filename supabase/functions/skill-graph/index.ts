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
    const body = await req.json();
    const { action, user_id, curriculum_id, session_id, skill_node_id, minicheck_results, submission_id, lesson_id } = body;

    // ─── Seed skill nodes from competencies (SSOT) ───
    if (action === "seed_skills") {
      if (!curriculum_id) return json({ error: "curriculum_id required" }, 400);

      const { data, error } = await sb.rpc("seed_skill_nodes_from_competencies", {
        p_curriculum_id: curriculum_id,
      });

      if (error) return json({ error: error.message }, 500);
      return json(data ?? { ok: true, seeded: 0 });
    }

    // ─── Auto-map questions to skill nodes ───
    if (action === "map_questions") {
      if (!curriculum_id) return json({ error: "curriculum_id required" }, 400);

      const { data: questions } = await sb.from("exam_questions")
        .select("id, learning_field_code, competency_code, topic")
        .eq("curriculum_id", curriculum_id)
        .limit(5000);

      const { data: skills } = await sb.from("skill_nodes")
        .select("id, lernfeld, kompetenz, mikro_skill")
        .eq("curriculum_id", curriculum_id);

      if (!questions?.length || !skills?.length) return json({ ok: true, mapped: 0 });

      let mapped = 0;
      for (const q of questions) {
        const lf = q.learning_field_code || "LF0";
        const topic = (q.topic || "").toLowerCase();

        const bestSkill = skills.find(s =>
          s.lernfeld === lf && s.mikro_skill.toLowerCase().includes(topic.slice(0, 20))
        ) || skills.find(s => s.lernfeld === lf) || skills[0];

        if (bestSkill) {
          const { error } = await sb.from("question_skill_map").upsert({
            question_id: q.id,
            skill_node_id: bestSkill.id,
            relevance: 1.0,
          }, { onConflict: "question_id,skill_node_id" });
          if (!error) mapped++;
        }
      }

      return json({ ok: true, mapped });
    }

    // ─── Update scores after exam (idempotent via events) ───
    if (action === "update_scores") {
      if (!session_id) return json({ error: "session_id required" }, 400);

      const { data: session } = await sb.from("exam_sessions")
        .select("user_id, curriculum_id")
        .eq("id", session_id)
        .single();

      if (!session) return json({ error: "Session not found" }, 404);

      const { data: answers } = await sb.from("exam_session_questions")
        .select("question_id, is_correct")
        .eq("session_id", session_id);

      if (!answers?.length) return json({ ok: true, updated: 0 });

      const qIds = answers.map(a => a.question_id);
      const { data: mappings } = await sb.from("question_skill_map")
        .select("question_id, skill_node_id")
        .in("question_id", qIds);

      if (!mappings?.length) return json({ ok: true, updated: 0 });

      // Write idempotent events
      const touchedSkills = new Set<string>();
      for (const m of mappings) {
        const answer = answers.find(a => a.question_id === m.question_id);
        if (!answer) continue;

        const idempotencyKey = `exam:${session_id}:${m.question_id}:${m.skill_node_id}`;
        touchedSkills.add(m.skill_node_id);

        await sb.from("user_exam_skill_events").upsert({
          user_id: session.user_id,
          session_id,
          question_id: m.question_id,
          skill_node_id: m.skill_node_id,
          is_correct: !!answer.is_correct,
          idempotency_key: idempotencyKey,
        }, { onConflict: "idempotency_key" });
      }

      // Batch refresh + recalculate
      const touchedArray = Array.from(touchedSkills);
      for (const skillId of touchedArray) {
        await sb.rpc("refresh_user_skill_score_from_events", {
          p_user_id: session.user_id,
          p_skill_node_id: skillId,
        });
      }

      return json({ ok: true, updated: touchedArray.length });
    }

    // ─── Update MiniCheck scores (idempotent via events) ───
    if (action === "update_minicheck") {
      if (!user_id || !skill_node_id) return json({ error: "user_id + skill_node_id required" }, 400);
      if (!minicheck_results) return json({ error: "minicheck_results required" }, 400);

      const { correct, total } = minicheck_results as { correct: number; total: number };
      const subId = submission_id || crypto.randomUUID();
      const idempotencyKey = `mc:${user_id}:${skill_node_id}:${subId}`;

      await sb.from("user_minicheck_skill_events").upsert({
        user_id,
        submission_id: subId,
        lesson_id: lesson_id || null,
        skill_node_id,
        correct_count: correct,
        total_count: total,
        idempotency_key: idempotencyKey,
      }, { onConflict: "idempotency_key" });

      const { data: result } = await sb.rpc("refresh_user_skill_score_from_events", {
        p_user_id: user_id,
        p_skill_node_id: skill_node_id,
      });

      return json({ ok: true, mastery: result });
    }

    // ─── Skill radar (with scoreMap for O(1) lookups) ───
    if (action === "radar") {
      if (!user_id || !curriculum_id) return json({ error: "user_id + curriculum_id required" }, 400);

      const { data: skills } = await sb.from("skill_nodes")
        .select("id, lernfeld, kompetenz, mikro_skill")
        .eq("curriculum_id", curriculum_id);

      if (!skills?.length) return json({ ok: true, radar: [] });

      const skillIds = skills.map(s => s.id);
      const { data: scores } = await sb.from("user_skill_scores")
        .select("skill_node_id, mastery_pct, decay_adjusted_mastery, confidence, mastery_status, attempts, minicheck_attempts, trend, exam_score, minicheck_score")
        .eq("user_id", user_id)
        .in("skill_node_id", skillIds);

      const scoreMap = new Map((scores || []).map((sc: any) => [sc.skill_node_id, sc]));

      const byLF: Record<string, { mastery: number[]; confidence: number[]; skills: any[] }> = {};
      for (const s of skills) {
        if (!byLF[s.lernfeld]) byLF[s.lernfeld] = { mastery: [], confidence: [], skills: [] };
        const score = scoreMap.get(s.id);
        const m = score?.decay_adjusted_mastery || score?.mastery_pct || 0;
        const c = score?.confidence || 0;
        byLF[s.lernfeld].mastery.push(m);
        byLF[s.lernfeld].confidence.push(c);
        byLF[s.lernfeld].skills.push({
          ...s,
          mastery_pct: m,
          mastery_status: score?.mastery_status || (m >= 80 ? 'mastered' : m >= 60 ? 'partial' : 'not_mastered'),
          confidence: c,
          attempts: (score?.attempts || 0) + (score?.minicheck_attempts || 0),
          exam_score: score?.exam_score || 0,
          minicheck_score: score?.minicheck_score || 0,
          trend: score?.trend || 'stable',
        });
      }

      const avg = (arr: number[]) => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

      const radar = Object.entries(byLF).map(([lf, data]) => {
        const avgMastery = avg(data.mastery);
        const avgConf = avg(data.confidence);
        return {
          lernfeld: lf,
          avg_mastery: Math.round(avgMastery * 10) / 10,
          avg_confidence: Math.round(avgConf * 100) / 100,
          mastery_status: avgMastery >= 80 ? 'mastered' : avgMastery >= 60 ? 'partial' : 'not_mastered',
          reliability: avgConf >= 0.7 ? 'high' : avgConf >= 0.3 ? 'medium' : 'low',
          skill_count: data.skills.length,
          mastered_count: data.skills.filter(s => s.mastery_status === 'mastered').length,
          partial_count: data.skills.filter(s => s.mastery_status === 'partial').length,
          not_mastered_count: data.skills.filter(s => s.mastery_status === 'not_mastered').length,
          weakest: data.skills.sort((a, b) => a.mastery_pct - b.mastery_pct).slice(0, 3),
        };
      });

      return json({ ok: true, radar });
    }

    // ─── Exam Readiness (with scoreMap + fail risk) ───
    if (action === "exam_readiness") {
      if (!user_id || !curriculum_id) return json({ error: "user_id + curriculum_id required" }, 400);

      const { data: skills } = await sb.from("skill_nodes")
        .select("id, lernfeld, kompetenz")
        .eq("curriculum_id", curriculum_id);

      if (!skills?.length) return json({ ok: true, readiness_pct: 0, verdict: "not_started" });

      const skillIds = skills.map(s => s.id);
      const { data: scores } = await sb.from("user_skill_scores")
        .select("skill_node_id, decay_adjusted_mastery, mastery_pct, confidence, attempts, minicheck_attempts, trend")
        .eq("user_id", user_id)
        .in("skill_node_id", skillIds);

      const scoreMap = new Map((scores || []).map((sc: any) => [sc.skill_node_id, sc]));

      const { data: lfs } = await sb.from("learning_fields")
        .select("id, code, weight_percent")
        .eq("curriculum_id", curriculum_id);

      const lfWeightMap = new Map((lfs || []).map((lf: any) => [lf.code, lf.weight_percent || (100 / (lfs?.length || 1))]));

      const byLF: Record<string, { totalMastery: number; totalConfidence: number; count: number; weight: number }> = {};
      for (const s of skills) {
        if (!byLF[s.lernfeld]) byLF[s.lernfeld] = { totalMastery: 0, totalConfidence: 0, count: 0, weight: lfWeightMap.get(s.lernfeld) || 10 };
        const score = scoreMap.get(s.id);
        byLF[s.lernfeld].totalMastery += score?.decay_adjusted_mastery || score?.mastery_pct || 0;
        byLF[s.lernfeld].totalConfidence += score?.confidence || 0;
        byLF[s.lernfeld].count++;
      }

      let weightedSum = 0;
      let totalWeight = 0;
      let totalConfidenceSum = 0;
      let totalSkillCount = 0;
      const lfReadiness: any[] = [];
      for (const [lf, data] of Object.entries(byLF)) {
        const avgMastery = data.count > 0 ? data.totalMastery / data.count : 0;
        const avgConfidence = data.count > 0 ? data.totalConfidence / data.count : 0;
        weightedSum += avgMastery * data.weight;
        totalWeight += data.weight;
        totalConfidenceSum += avgConfidence * data.count;
        totalSkillCount += data.count;
        lfReadiness.push({
          lernfeld: lf,
          avg_mastery: Math.round(avgMastery * 10) / 10,
          avg_confidence: Math.round(avgConfidence * 100) / 100,
          weight: data.weight,
          status: avgMastery >= 80 ? 'ready' : avgMastery >= 60 ? 'needs_review' : 'critical',
          reliability: avgConfidence >= 0.7 ? 'high' : avgConfidence >= 0.3 ? 'medium' : 'low',
        });
      }

      const readinessPct = totalWeight > 0 ? Math.round((weightedSum / totalWeight) * 10) / 10 : 0;
      const avgConfidence = totalSkillCount > 0 ? Math.round((totalConfidenceSum / totalSkillCount) * 100) / 100 : 0;
      const criticalLFs = lfReadiness.filter(lf => lf.status === 'critical').sort((a, b) => a.avg_mastery - b.avg_mastery);
      const totalAttempts = (scores || []).reduce((s, sc) => s + (sc.attempts || 0) + (sc.minicheck_attempts || 0), 0);

      const failRiskRaw = 100 - readinessPct;
      const failRisk = Math.round(failRiskRaw * (1 + (1 - avgConfidence) * 0.3) * 10) / 10;

      const verdict = readinessPct >= 80 ? 'exam_ready'
        : readinessPct >= 60 ? 'almost_ready'
        : readinessPct >= 40 ? 'needs_work'
        : totalAttempts > 0 ? 'not_ready' : 'not_started';

      return json({
        ok: true,
        readiness_pct: readinessPct,
        confidence: avgConfidence,
        fail_risk_pct: Math.min(failRisk, 100),
        verdict,
        total_skills: skills.length,
        skills_with_data: (scores || []).length,
        total_attempts: totalAttempts,
        lf_readiness: lfReadiness.sort((a, b) => a.avg_mastery - b.avg_mastery),
        critical_areas: criticalLFs.slice(0, 3).map(lf => lf.lernfeld),
        recommendation: verdict === 'exam_ready'
          ? 'Du bist prüfungsreif! Konzentriere dich auf Wiederholung und Zeitmanagement.'
          : verdict === 'almost_ready'
          ? `Fast geschafft! Fokussiere dich auf: ${criticalLFs.slice(0, 2).map(lf => lf.lernfeld).join(', ')}`
          : `Kritische Lernfelder: ${criticalLFs.slice(0, 3).map(lf => lf.lernfeld).join(', ')}. Arbeite diese zuerst durch.`,
      });
    }

    // ─── Recalculate all mastery for a user ───
    if (action === "recalculate_all") {
      if (!user_id) return json({ error: "user_id required" }, 400);
      const { data } = await sb.rpc("recalculate_all_mastery", { p_user_id: user_id });
      return json({ ok: true, ...data });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e: unknown) {
    console.error("[skill-graph]", e);
    return json({ error: (e as Error)?.message || String(e) }, 500);
  }
});
