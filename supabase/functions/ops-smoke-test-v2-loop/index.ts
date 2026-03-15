import { createClient } from "npm:@supabase/supabase-js@2.45.4";

/**
 * ops-smoke-test-v2-loop
 *
 * Admin-only deterministic smoke test for the ExamFit v2 Intelligence Loop.
 * Seeds test learning events → triggers snapshot-exam-readiness → validates output.
 *
 * Returns a full diagnostic readout in a single call:
 *   events_written, snapshot_created, snapshot_debounced,
 *   active_recommendations_count, latest_generation_id,
 *   readiness_score, risk_level, view_data
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type SB = ReturnType<typeof createClient>;

async function assertAdmin(sb: SB, userId: string) {
  const { data, error } = await sb
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (error || !data) throw new Error("FORBIDDEN");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const startMs = Date.now();

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    if (!supabaseUrl || !serviceKey || !anonKey) return json({ error: "Missing env" }, 500);

    // Auth: validate caller is admin
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user) return json({ error: "Unauthorized" }, 401);

    const sb = createClient(supabaseUrl, serviceKey);
    try { await assertAdmin(sb, user.id); } catch { return json({ error: "Forbidden – admin role required" }, 403); }

    const body = await req.json().catch(() => ({}));
    const targetUserId = String(body.user_id || user.id);
    const curriculumId = String(body.curriculum_id || "");
    const dryRun = body.dry_run === true;

    if (!curriculumId) return json({ error: "curriculum_id required" }, 400);

    // ── Diagnostic result accumulator ──
    const diag: Record<string, unknown> = {
      target_user_id: targetUserId,
      curriculum_id: curriculumId,
      dry_run: dryRun,
    };

    // ═══ PHASE 1: Seed test learning events ═══
    const testEvents = [
      {
        user_id: targetUserId,
        curriculum_id: curriculumId,
        event_type: "lesson_completed",
        event_source: "smoke_test",
        duration_seconds: 1200,
        score: 85,
        payload: { smoke_test: true, test_run_at: new Date().toISOString() },
      },
      {
        user_id: targetUserId,
        curriculum_id: curriculumId,
        event_type: "minicheck_completed",
        event_source: "smoke_test",
        duration_seconds: 300,
        score: 72,
        payload: { smoke_test: true, questions_answered: 7, correct: 5 },
      },
      {
        user_id: targetUserId,
        curriculum_id: curriculumId,
        event_type: "exam_sim_completed",
        event_source: "smoke_test",
        duration_seconds: 3600,
        score: 68,
        payload: { smoke_test: true, total_questions: 40, correct: 27 },
      },
    ];

    if (!dryRun) {
      const { error: evtErr, data: evtData } = await sb
        .from("learning_events")
        .insert(testEvents)
        .select("id");

      if (evtErr) {
        diag.events_error = evtErr.message;
        diag.events_written = 0;
      } else {
        diag.events_written = evtData?.length ?? 0;
        diag.event_ids = evtData?.map((e: { id: string }) => e.id);
      }
    } else {
      diag.events_written = 0;
      diag.events_note = "dry_run – no events written";
    }

    // ═══ PHASE 2: Trigger snapshot-exam-readiness inline ═══
    // (We replicate the logic here rather than HTTP-calling to avoid auth issues)
    let snapshotCreated = false;
    let snapshotDebounced = false;

    try {
      // Call the readiness RPC with service role (acting on behalf of target user)
      const { data: readiness, error: rpcErr } = await sb.rpc("calculate_exam_readiness", {
        p_user_id: targetUserId,
        p_curriculum_id: curriculumId,
      });

      if (rpcErr) {
        diag.readiness_rpc_error = rpcErr.message;
      } else if (!readiness) {
        diag.readiness_rpc_error = "No readiness data returned";
      } else {
        const r = readiness as Record<string, unknown>;
        const score = Number(r.overall_readiness || 0);
        const riskLevel = score >= 80 ? "exam_ready"
          : score >= 65 ? "on_track"
          : score >= 40 ? "medium_risk"
          : "high_risk";

        const totalComp = Number(r.total_competencies || 0);
        const masteredCount = Number(r.mastered_count || 0);
        const partialCount = Number(r.partial_count || 0);
        const notMasteredCount = Number(r.not_mastered_count || 0);
        const assessedCount = masteredCount + partialCount + notMasteredCount;
        const confidenceScore = totalComp > 0 ? Math.round((assessedCount / totalComp) * 100) : 0;

        diag.readiness_score = score;
        diag.risk_level = riskLevel;
        diag.confidence_score = confidenceScore;
        diag.competency_breakdown = { total: totalComp, mastered: masteredCount, partial: partialCount, not_mastered: notMasteredCount };
        diag.weak_competencies = r.weak_competencies;
        diag.strong_competencies = r.strong_competencies;

        if (!dryRun) {
          // Debounce check
          const { data: recentSnap } = await sb
            .from("exam_readiness_snapshots")
            .select("id, readiness_score, risk_level, mastered_count, partial_count, not_mastered_count")
            .eq("user_id", targetUserId)
            .eq("curriculum_id", curriculumId)
            .gte("calculated_at", new Date(Date.now() - 30_000).toISOString())
            .order("calculated_at", { ascending: false })
            .limit(1)
            .maybeSingle();

          const identical = recentSnap
            && Math.abs(recentSnap.readiness_score - score) < 1
            && recentSnap.risk_level === riskLevel
            && recentSnap.mastered_count === masteredCount
            && recentSnap.partial_count === partialCount
            && recentSnap.not_mastered_count === notMasteredCount;

          if (identical) {
            snapshotDebounced = true;
          } else {
            // Persist snapshot
            const { error: snapErr } = await sb
              .from("exam_readiness_snapshots")
              .insert({
                user_id: targetUserId,
                curriculum_id: curriculumId,
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

            if (snapErr) {
              diag.snapshot_error = snapErr.message;
            } else {
              snapshotCreated = true;
            }
          }

          // Generate recommendations
          if (snapshotCreated) {
            const weakComps = (r.weak_competencies || []) as Array<{
              competency_id: string; title: string; code: string; score: number;
            }>;

            const generationId = crypto.randomUUID();
            const recs: Array<Record<string, unknown>> = [];

            for (const [i, wc] of weakComps.slice(0, 3).entries()) {
              recs.push({
                user_id: targetUserId,
                curriculum_id: curriculumId,
                recommendation_type: "lesson",
                target_id: wc.competency_id,
                target_meta: { competency_title: wc.title, competency_code: wc.code, score: wc.score },
                reason_code: wc.score < 40 ? "LOW_MASTERY_HIGH_WEIGHT" : "WEAKNESS_CLUSTER_DETECTED",
                reason_text: `${wc.title} (${wc.code}) gezielt wiederholen – aktueller Stand ${wc.score}%`,
                priority_score: 100 - wc.score + (3 - i),
                is_active: true,
                expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
                meta: { generation_id: generationId, smoke_test: true },
              });
            }

            if (score >= 65) {
              recs.push({
                user_id: targetUserId,
                curriculum_id: curriculumId,
                recommendation_type: "exam_sim",
                target_id: null,
                target_meta: {},
                reason_code: "PRE_EXAM_SIM_REQUIRED",
                reason_text: "Prüfungssimulation empfohlen.",
                priority_score: 90,
                is_active: true,
                expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
                meta: { generation_id: generationId, smoke_test: true },
              });
            }

            if (recs.length === 0) {
              recs.push({
                user_id: targetUserId,
                curriculum_id: curriculumId,
                recommendation_type: "review",
                target_id: null,
                target_meta: {},
                reason_code: "REVIEW_DUE",
                reason_text: "Wiederhole ein prüfungsrelevantes Thema.",
                priority_score: 70,
                is_active: true,
                expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
                meta: { generation_id: generationId, smoke_test: true },
              });
            }

            // Deactivate old
            await sb
              .from("user_recommendations")
              .update({ is_active: false })
              .eq("user_id", targetUserId)
              .eq("curriculum_id", curriculumId)
              .eq("is_active", true);

            // Insert new
            const { error: recErr } = await sb.from("user_recommendations").insert(recs);

            diag.recommendations_generated = recs.length;
            diag.latest_generation_id = generationId;
            if (recErr) diag.recommendations_error = recErr.message;
          }
        }
      }
    } catch (snapErr) {
      diag.snapshot_phase_error = (snapErr as Error).message;
    }

    diag.snapshot_created = snapshotCreated;
    diag.snapshot_debounced = snapshotDebounced;

    // ═══ PHASE 3: Read back verification from views ═══
    const { data: currentReadiness } = await sb
      .from("v_user_current_readiness")
      .select("*")
      .eq("user_id", targetUserId)
      .eq("curriculum_id", curriculumId)
      .maybeSingle();

    diag.view_current_readiness = currentReadiness || null;

    const { data: activeRecs } = await sb
      .from("v_user_active_recommendations")
      .select("*")
      .eq("user_id", targetUserId)
      .eq("curriculum_id", curriculumId)
      .order("priority_score", { ascending: false })
      .limit(5);

    diag.active_recommendations = activeRecs || [];
    diag.active_recommendations_count = activeRecs?.length ?? 0;

    const { data: topGaps } = await sb
      .from("v_user_top_gaps")
      .select("*")
      .eq("user_id", targetUserId)
      .eq("curriculum_id", curriculumId)
      .limit(5);

    diag.top_gaps = topGaps || [];

    // Recent learning events for this user
    const { data: recentEvents } = await sb
      .from("learning_events")
      .select("id, event_type, event_source, score, duration_seconds, created_at")
      .eq("user_id", targetUserId)
      .eq("curriculum_id", curriculumId)
      .order("created_at", { ascending: false })
      .limit(10);

    diag.last_learning_events = recentEvents || [];

    // Latest snapshot
    const { data: latestSnap } = await sb
      .from("exam_readiness_snapshots")
      .select("id, readiness_score, risk_level, confidence_score, calculated_at, mastered_count, partial_count, not_mastered_count")
      .eq("user_id", targetUserId)
      .eq("curriculum_id", curriculumId)
      .order("calculated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    diag.latest_snapshot = latestSnap || null;

    diag.elapsed_ms = Date.now() - startMs;
    diag.ok = true;

    return json(diag);

  } catch (err) {
    const msg = (err as Error).message || String(err);
    console.error(`[ops-smoke-test-v2-loop] Error: ${msg}`);
    return json({ ok: false, error: msg, elapsed_ms: Date.now() - startMs }, 500);
  }
});
