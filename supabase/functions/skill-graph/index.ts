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
    const { action, user_id, curriculum_id, session_id } = await req.json();

    // ─── Seed skill nodes from curriculum topics ───
    if (action === "seed_skills") {
      if (!curriculum_id) return json({ error: "curriculum_id required" }, 400);

      const { data: topics } = await sb.from("curriculum_topics")
        .select("id, topic_title, parent_topic_id, level, competency_area, learning_field_code")
        .eq("curriculum_id", curriculum_id)
        .order("sort_order");

      if (!topics?.length) return json({ ok: true, seeded: 0, msg: "No topics found" });

      let seeded = 0;
      for (const t of topics) {
        const lf = t.learning_field_code || "LF0";
        const kompetenz = t.competency_area || t.topic_title || "Allgemein";
        const mikro = t.topic_title || "Unbekannt";

        const { error } = await sb.from("skill_nodes").upsert({
          curriculum_id,
          lernfeld: lf,
          kompetenz,
          mikro_skill: mikro,
          description: `Topic: ${t.topic_title}`,
        }, { onConflict: "curriculum_id,lernfeld,kompetenz,mikro_skill" });

        if (!error) seeded++;
      }

      return json({ ok: true, seeded });
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
        // Find best matching skill node
        const lf = q.learning_field_code || "LF0";
        const comp = q.competency_code || "";
        const topic = (q.topic || "").toLowerCase();

        let bestSkill = skills.find(s =>
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

    // ─── Update user skill scores after exam session ───
    if (action === "update_scores") {
      if (!session_id) return json({ error: "session_id required" }, 400);

      const { data: session } = await sb.from("exam_sessions")
        .select("user_id, curriculum_id")
        .eq("id", session_id)
        .single();

      if (!session) return json({ error: "Session not found" }, 404);

      // Get session answers
      const { data: answers } = await sb.from("exam_session_questions")
        .select("question_id, is_correct")
        .eq("session_id", session_id);

      if (!answers?.length) return json({ ok: true, updated: 0 });

      // Get skill mappings for these questions
      const qIds = answers.map(a => a.question_id);
      const { data: mappings } = await sb.from("question_skill_map")
        .select("question_id, skill_node_id")
        .in("question_id", qIds);

      if (!mappings?.length) return json({ ok: true, updated: 0 });

      // Aggregate by skill_node
      const skillAgg: Record<string, { correct: number; total: number }> = {};
      for (const m of mappings) {
        const answer = answers.find(a => a.question_id === m.question_id);
        if (!answer) continue;
        if (!skillAgg[m.skill_node_id]) skillAgg[m.skill_node_id] = { correct: 0, total: 0 };
        skillAgg[m.skill_node_id].total++;
        if (answer.is_correct) skillAgg[m.skill_node_id].correct++;
      }

      let updated = 0;
      for (const [skillId, agg] of Object.entries(skillAgg)) {
        // Fetch existing
        const { data: existing } = await sb.from("user_skill_scores")
          .select("attempts, correct, mastery_pct")
          .eq("user_id", session.user_id)
          .eq("skill_node_id", skillId)
          .maybeSingle();

        const prevAttempts = existing?.attempts || 0;
        const prevCorrect = existing?.correct || 0;
        const prevMastery = existing?.mastery_pct || 0;

        const newAttempts = prevAttempts + agg.total;
        const newCorrect = prevCorrect + agg.correct;
        const newMastery = newAttempts > 0 ? (newCorrect / newAttempts) * 100 : 0;

        const trend = newMastery > prevMastery + 2 ? 'improving'
          : newMastery < prevMastery - 2 ? 'declining' : 'stable';

        await sb.from("user_skill_scores").upsert({
          user_id: session.user_id,
          skill_node_id: skillId,
          mastery_pct: Math.round(newMastery * 100) / 100,
          attempts: newAttempts,
          correct: newCorrect,
          last_attempt_at: new Date().toISOString(),
          trend,
          updated_at: new Date().toISOString(),
        }, { onConflict: "user_id,skill_node_id" });
        updated++;
      }

      return json({ ok: true, updated });
    }

    // ─── Get user skill radar ───
    if (action === "radar") {
      if (!user_id || !curriculum_id) return json({ error: "user_id + curriculum_id required" }, 400);

      const { data: skills } = await sb.from("skill_nodes")
        .select("id, lernfeld, kompetenz, mikro_skill")
        .eq("curriculum_id", curriculum_id);

      if (!skills?.length) return json({ ok: true, radar: [] });

      const skillIds = skills.map(s => s.id);
      const { data: scores } = await sb.from("user_skill_scores")
        .select("skill_node_id, mastery_pct, attempts, trend")
        .eq("user_id", user_id)
        .in("skill_node_id", skillIds);

      // Aggregate by lernfeld
      const byLF: Record<string, { mastery: number[]; skills: any[] }> = {};
      for (const s of skills) {
        if (!byLF[s.lernfeld]) byLF[s.lernfeld] = { mastery: [], skills: [] };
        const score = scores?.find(sc => sc.skill_node_id === s.id);
        const m = score?.mastery_pct || 0;
        byLF[s.lernfeld].mastery.push(m);
        byLF[s.lernfeld].skills.push({
          ...s,
          mastery_pct: m,
          attempts: score?.attempts || 0,
          trend: score?.trend || 'stable',
        });
      }

      const radar = Object.entries(byLF).map(([lf, data]) => ({
        lernfeld: lf,
        avg_mastery: data.mastery.length > 0
          ? Math.round(data.mastery.reduce((a, b) => a + b, 0) / data.mastery.length * 10) / 10
          : 0,
        skill_count: data.skills.length,
        weakest: data.skills.sort((a, b) => a.mastery_pct - b.mastery_pct).slice(0, 3),
      }));

      return json({ ok: true, radar });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e: unknown) {
    console.error("[skill-graph]", e);
    return json({ error: (e as Error)?.message || String(e) }, 500);
  }
});
