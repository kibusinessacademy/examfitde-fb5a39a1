import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

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
    const { action, session_id, user_id, curriculum_id } = await req.json();

    if (action === "record") {
      // Called after each exam session finishes
      if (!session_id) return json({ error: "session_id required" }, 400);

      // Fetch session
      const { data: session } = await sb.from("exam_sessions")
        .select("user_id, curriculum_id, score_percentage, passed, started_at, finished_at")
        .eq("id", session_id)
        .single();

      if (!session) return json({ error: "Session not found" }, 404);

      const uid = session.user_id;
      const cid = session.curriculum_id;
      const score = session.score_percentage || 0;
      const now = new Date();

      // Fetch or create tracking row
      const { data: existing } = await sb.from("outcome_tracking")
        .select("*")
        .eq("user_id", uid)
        .eq("curriculum_id", cid)
        .maybeSingle();

      const scores7d: number[] = existing?.scores_7d || [];
      const scores14d: number[] = existing?.scores_14d || [];
      const scores30d: number[] = existing?.scores_30d || [];

      scores7d.push(score);
      scores14d.push(score);
      scores30d.push(score);

      // Keep only recent
      const keep = (arr: number[], max: number) => arr.slice(-max);

      const attempts = (existing?.attempts_total || 0) + 1;
      const bestScore = Math.max(existing?.best_score || 0, score);
      const firstAttempt = existing?.first_attempt_at || session.started_at;
      const passedAt = session.passed ? (existing?.pass_simulation_at || session.finished_at) : existing?.pass_simulation_at;
      
      let daysToPass: number | null = existing?.days_to_pass || null;
      if (session.passed && !existing?.pass_simulation_at && firstAttempt) {
        const diff = new Date(session.finished_at).getTime() - new Date(firstAttempt).getTime();
        daysToPass = Math.max(1, Math.ceil(diff / (1000 * 60 * 60 * 24)));
      }

      // Improvement: compare last 3 scores avg vs first 3
      const s30 = keep(scores30d, 30);
      let improvement = 0;
      if (s30.length >= 6) {
        const first3 = s30.slice(0, 3).reduce((a, b) => a + b, 0) / 3;
        const last3 = s30.slice(-3).reduce((a, b) => a + b, 0) / 3;
        improvement = last3 - first3;
      }

      // Streak
      let streak = existing?.current_streak || 0;
      if (session.passed) streak++;
      else streak = 0;

      await sb.from("outcome_tracking").upsert({
        user_id: uid,
        curriculum_id: cid,
        first_attempt_at: firstAttempt,
        pass_simulation_at: passedAt,
        days_to_pass: daysToPass,
        attempts_total: attempts,
        best_score: bestScore,
        current_streak: streak,
        scores_7d: keep(scores7d, 10),
        scores_14d: keep(scores14d, 20),
        scores_30d: keep(s30, 30),
        improvement_pct: Math.round(improvement * 100) / 100,
        last_session_at: session.finished_at,
        updated_at: now.toISOString(),
      }, { onConflict: "user_id,curriculum_id" });

      return json({ ok: true, attempts, best_score: bestScore, days_to_pass: daysToPass });
    }

    if (action === "stats") {
      // Admin: aggregate outcome KPIs per curriculum
      const { data: outcomes } = await sb.from("outcome_tracking")
        .select("curriculum_id, attempts_total, best_score, days_to_pass, improvement_pct, pass_simulation_at, drop_off_count")
        .order("updated_at", { ascending: false })
        .limit(5000);

      if (!outcomes?.length) return json({ ok: true, kpis: [] });

      // Group by curriculum
      const byCurriculum: Record<string, any[]> = {};
      for (const o of outcomes) {
        const key = o.curriculum_id;
        if (!byCurriculum[key]) byCurriculum[key] = [];
        byCurriculum[key].push(o);
      }

      const kpis = Object.entries(byCurriculum).map(([cid, rows]) => {
        const passedRows = rows.filter(r => r.pass_simulation_at);
        const passRate = rows.length > 0 ? (passedRows.length / rows.length) * 100 : 0;
        const avgDaysToPass = passedRows.length > 0
          ? passedRows.reduce((a, r) => a + (r.days_to_pass || 0), 0) / passedRows.length
          : null;
        const avgImprovement = rows.reduce((a, r) => a + (r.improvement_pct || 0), 0) / rows.length;
        const avgAttempts = rows.reduce((a, r) => a + r.attempts_total, 0) / rows.length;
        const avgBest = rows.reduce((a, r) => a + (r.best_score || 0), 0) / rows.length;

        return {
          curriculum_id: cid,
          learners: rows.length,
          pass_rate: Math.round(passRate * 10) / 10,
          avg_days_to_pass: avgDaysToPass ? Math.round(avgDaysToPass * 10) / 10 : null,
          avg_improvement: Math.round(avgImprovement * 10) / 10,
          avg_attempts: Math.round(avgAttempts * 10) / 10,
          avg_best_score: Math.round(avgBest * 10) / 10,
        };
      });

      return json({ ok: true, kpis });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e: unknown) {
    console.error("[outcome-tracker]", e);
    return json({ error: (e as Error)?.message || String(e) }, 500);
  }
});
