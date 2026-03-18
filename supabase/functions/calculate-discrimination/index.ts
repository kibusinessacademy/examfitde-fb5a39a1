import { createClient } from "npm:@supabase/supabase-js@2.45.4";

/**
 * calculate-discrimination — Discrimination Index Calculator
 * 
 * Computes per-question discrimination index (top 25% vs bottom 25% correct rate).
 * Questions with discrimination < 0.20 get demoted to "training" status.
 * Run periodically (e.g. daily via cron).
 */

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const body = await req.json().catch(() => ({}));
  const curriculumId = body.curriculum_id;
  const minAttempts = body.min_attempts ?? 20;

  try {
    // Get questions with enough attempts
    const { data: questions } = await sb
      .from("exam_questions")
      .select("id")
      .eq("status", "approved")
      .eq("curriculum_id", curriculumId || "")
      .limit(2000);

    if (!questions?.length) return json({ ok: true, processed: 0, message: "No questions to analyze" });

    // Get all user scores for ranking
    const { data: userScores } = await sb.rpc("get_user_exam_scores", { p_curriculum_id: curriculumId });

    // Fallback: compute from question_attempts directly
    const { data: attempts } = await sb
      .from("question_attempts")
      .select("question_id, user_id, is_correct")
      .in("question_id", questions.map(q => q.id))
      .order("answered_at", { ascending: false })
      .limit(50000);

    if (!attempts?.length) return json({ ok: true, processed: 0, message: "No attempts data" });

    // Compute per-user total correct rate
    const userCorrectMap: Record<string, { correct: number; total: number }> = {};
    for (const a of attempts) {
      if (!userCorrectMap[a.user_id]) userCorrectMap[a.user_id] = { correct: 0, total: 0 };
      userCorrectMap[a.user_id].total++;
      if (a.is_correct) userCorrectMap[a.user_id].correct++;
    }

    const userRates = Object.entries(userCorrectMap)
      .map(([uid, stats]) => ({ uid, rate: stats.correct / stats.total }))
      .sort((a, b) => b.rate - a.rate);

    const q1Cutoff = Math.ceil(userRates.length * 0.25);
    const topUsers = new Set(userRates.slice(0, q1Cutoff).map(u => u.uid));
    const bottomUsers = new Set(userRates.slice(-q1Cutoff).map(u => u.uid));

    // Per-question discrimination
    const questionStats: Record<string, { total: number; correct: number; topCorrect: number; topTotal: number; bottomCorrect: number; bottomTotal: number }> = {};

    for (const a of attempts) {
      if (!questionStats[a.question_id]) {
        questionStats[a.question_id] = { total: 0, correct: 0, topCorrect: 0, topTotal: 0, bottomCorrect: 0, bottomTotal: 0 };
      }
      const qs = questionStats[a.question_id];
      qs.total++;
      if (a.is_correct) qs.correct++;
      if (topUsers.has(a.user_id)) {
        qs.topTotal++;
        if (a.is_correct) qs.topCorrect++;
      }
      if (bottomUsers.has(a.user_id)) {
        qs.bottomTotal++;
        if (a.is_correct) qs.bottomCorrect++;
      }
    }

    let updated = 0;
    let demoted = 0;

    for (const [qId, stats] of Object.entries(questionStats)) {
      if (stats.total < minAttempts) continue;

      const topRate = stats.topTotal > 0 ? stats.topCorrect / stats.topTotal : 0;
      const bottomRate = stats.bottomTotal > 0 ? stats.bottomCorrect / stats.bottomTotal : 0;
      const discriminationIndex = topRate - bottomRate;

      await sb.from("question_discrimination_stats").upsert({
        question_id: qId,
        total_attempts: stats.total,
        correct_count: stats.correct,
        top_quartile_correct_rate: topRate,
        bottom_quartile_correct_rate: bottomRate,
        discrimination_index: discriminationIndex,
        last_calculated_at: new Date().toISOString(),
      }, { onConflict: "question_id" });

      updated++;

      // Auto-demote low discrimination questions
      if (discriminationIndex < 0.20 && stats.total >= minAttempts * 2) {
        await sb.from("exam_questions").update({ status: "training" }).eq("id", qId).eq("status", "approved");
        demoted++;
        console.log(`[Discrimination] Demoted ${qId.slice(0, 8)}: index=${discriminationIndex.toFixed(3)}`);
      }
    }

    console.log(`[Discrimination] Done: ${updated} updated, ${demoted} demoted`);
    return json({ ok: true, processed: updated, demoted, total_users: userRates.length, top_quartile: topUsers.size, bottom_quartile: bottomUsers.size });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
