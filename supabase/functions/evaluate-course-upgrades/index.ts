import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.49.1/cors";

const UPGRADE_THRESHOLDS = {
  revenue_30d: 3000,
  active_users_30d: 150,
  sessions_30d: 800,
  completion_rate: 0.6,
  b2b_signals: 2,
};

const WEIGHTS = { revenue: 40, users: 20, engagement: 20, completion: 10, b2b: 10 };

function scoreCourse(m: {
  revenue_30d: number;
  active_users_30d: number;
  sessions_30d: number;
  completion_rate: number;
  b2b_signals: number;
}): number {
  const t = UPGRADE_THRESHOLDS;
  return Math.round((
    Math.min(m.revenue_30d / t.revenue_30d, 1) * WEIGHTS.revenue +
    Math.min(m.active_users_30d / t.active_users_30d, 1) * WEIGHTS.users +
    Math.min(m.sessions_30d / t.sessions_30d, 1) * WEIGHTS.engagement +
    Math.min(m.completion_rate / t.completion_rate, 1) * WEIGHTS.completion +
    Math.min(m.b2b_signals / t.b2b_signals, 1) * WEIGHTS.b2b
  ) * 100) / 100;
}

function decide(score: number) {
  if (score >= 75) return { decision: "upgrade" as const, recommended_track: "AUSBILDUNG_VOLL" };
  if (score >= 40) return { decision: "monitor" as const, recommended_track: "EXAM_FIRST" };
  return { decision: "stay" as const, recommended_track: "EXAM_FIRST" };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Fetch all EXAM_FIRST scores
    const { data: scores, error: fetchErr } = await sb
      .from("course_upgrade_scores")
      .select("*");

    if (fetchErr) throw fetchErr;
    if (!scores?.length) {
      return new Response(JSON.stringify({ evaluated: 0, upgrades: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let upgradeCount = 0;
    const decisions = [];

    for (const row of scores) {
      const score = scoreCourse(row);
      const result = decide(score);

      decisions.push({
        package_id: row.package_id,
        curriculum_id: row.curriculum_id,
        current_track: "EXAM_FIRST",
        recommended_track: result.recommended_track,
        score,
        decision: result.decision,
        reasons: {
          revenue_30d: row.revenue_30d,
          active_users_30d: row.active_users_30d,
          sessions_30d: row.sessions_30d,
          completion_rate: row.completion_rate,
          b2b_signals: row.b2b_signals,
        },
      });

      if (result.decision === "upgrade") {
        upgradeCount++;
        // Log but don't auto-switch — requires admin approval
        console.log(`[UPGRADE_RECOMMENDED] package=${row.package_id} score=${score}`);
      }
    }

    // Batch insert decisions
    if (decisions.length > 0) {
      const { error: insertErr } = await sb
        .from("course_upgrade_decisions")
        .insert(decisions);
      if (insertErr) throw insertErr;
    }

    return new Response(
      JSON.stringify({ evaluated: scores.length, upgrades: upgradeCount }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[evaluate-course-upgrades] Error:", err);
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
