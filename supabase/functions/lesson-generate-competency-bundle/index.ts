import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { assertSchemaReady } from "../_shared/schema-gate.ts";
import { enqueueJob } from "../_shared/enqueue.ts";
import { canonicalStepKey } from "../_shared/step-keys.ts";
import { resolveAvailableRoute } from "../_shared/llm/provider-load-balancer.ts";

/**
 * lesson-generate-competency-bundle — Competency-Level Fan-Out Orchestrator
 *
 * Takes a single competency_id and enqueues individual lesson_generate_content
 * jobs for ALL lesson-steps of that competency that need generation.
 *
 * This is the semantic unit for:
 *   - Observability: "42/48 competencies done" vs "running"
 *   - Recovery: retry a whole competency bundle, not individual lessons
 *   - WIP control: limit concurrent competencies, not just lessons
 *
 * Steps per competency (didactic bundle):
 *   1. Einstieg (entry/activation)
 *   2. Verstehen (understanding)
 *   3. Anwenden (application)
 *   4. Wiederholen (review/transfer)
 *   5. MiniCheck scaffold (auto-generated quiz)
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

// SSOT: lessons needing regen filter (matches learning-content-scheduler.ts)
const NEEDS_REGEN_OR_FILTER = [
  "content.is.null",
  "qc_status.eq.tier1_failed",
  "content->>_placeholder.eq.true",
  "content->>_regenerating.eq.true",
].join(",");

const STAGGER_MS = 80;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  await assertSchemaReady("lesson-generate-competency-bundle", sb);

  const body = await req.json().catch(() => ({}));
  const p = body.payload || body;

  const packageId = p.package_id;
  const competencyId = p.competency_id;
  const courseId = p.course_id;
  const curriculumId = p.curriculum_id;
  const certificationId = p.certification_id || null;
  const learningFieldId = p.learning_field_id || null;

  if (!packageId || !competencyId || !courseId || !curriculumId) {
    return json({
      error: "Missing required fields: package_id, competency_id, course_id, curriculum_id",
    }, 400);
  }

  // ── Load all lessons for this competency that need generation ──
  const { data: pkg } = await sb
    .from("course_packages")
    .select("course_id")
    .eq("id", packageId)
    .maybeSingle();

  if (!pkg?.course_id) {
    return json({ error: "Package not found", permanent: true }, 422);
  }

  // Get modules for this course
  const { data: mods } = await sb
    .from("modules")
    .select("id")
    .eq("course_id", pkg.course_id);
  const moduleIds = (mods ?? []).map((m: { id: string }) => m.id);

  if (moduleIds.length === 0) {
    return json({ ok: true, skipped: true, reason: "no_modules" });
  }

  // Get all lessons for this competency that need regen
  const { data: lessons, error: lErr } = await sb
    .from("lessons")
    .select("id, title, step, qc_status")
    .in("module_id", moduleIds)
    .eq("competency_id", competencyId)
    .or(NEEDS_REGEN_OR_FILTER)
    .order("created_at", { ascending: true });

  if (lErr) {
    return json({ error: `Failed to load lessons: ${lErr.message}` }, 500);
  }

  if (!lessons || lessons.length === 0) {
    // All lessons for this competency already have content
    return json({
      ok: true,
      skipped: true,
      reason: "all_lessons_complete",
      competency_id: competencyId,
    });
  }

  // ── Also count total lessons for this competency (for progress) ──
  const { count: totalLessonsForCompetency } = await sb
    .from("lessons")
    .select("id", { head: true, count: "exact" })
    .in("module_id", moduleIds)
    .eq("competency_id", competencyId);

  // ── Reject stale content_versions for tier1_failed lessons ──
  const tier1FailedIds = lessons
    .filter((l: { qc_status: string | null }) => l.qc_status === "tier1_failed")
    .map((l: { id: string }) => l.id);

  if (tier1FailedIds.length > 0) {
    const { data: staleVersions } = await sb
      .from("content_versions")
      .select("id")
      .in("lesson_id", tier1FailedIds)
      .neq("status", "rejected");

    if (staleVersions && staleVersions.length > 0) {
      const vIds = staleVersions.map((v: { id: string }) => v.id);
      await sb
        .from("content_versions")
        .update({ status: "rejected", updated_at: new Date().toISOString() })
        .in("id", vIds);
      console.log(
        `[bundle] Rejected ${vIds.length} stale versions for tier1_failed lessons in competency ${competencyId.slice(0, 8)}`,
      );
    }
  }

  // ── Enqueue individual lesson_generate_content jobs ──
  let enqueued = 0;
  let deduped = 0;
  const errors: string[] = [];
  const now = Date.now();

  for (let i = 0; i < lessons.length; i++) {
    const lesson = lessons[i];
    try {
      const result = await enqueueJob(sb, {
        job_type: "lesson_generate_content",
        package_id: packageId,
        payload: {
          package_id: packageId,
          course_id: courseId,
          curriculum_id: curriculumId,
          certification_id: certificationId,
          lesson_id: lesson.id,
          step_key: canonicalStepKey(lesson.step),
          competency_id: competencyId,
          learning_field_id: learningFieldId,
          source: "competency_bundle",
        },
        batch_cursor: {
          lesson_id: lesson.id,
          step_key: canonicalStepKey(lesson.step),
          competency_id: competencyId,
        },
        priority: 12,
        run_after: new Date(now + i * STAGGER_MS).toISOString(),
        max_attempts: 5,
      });

      if (result.revived) {
        console.log(
          `[bundle] Revived job for lesson ${lesson.id.slice(0, 8)}:${canonicalStepKey(lesson.step)}`,
        );
      }
      enqueued++;
    } catch (e) {
      const msg = (e as Error).message || String(e);
      if (
        msg.includes("DEDUP") || msg.includes("duplicate") ||
        msg.includes("23505")
      ) {
        deduped++;
      } else if (msg.includes("PACKAGE_NOT_EXECUTABLE")) {
        return json({
          ok: false,
          error: "Package not executable",
          competency_id: competencyId,
          enqueued,
          deduped,
          permanent: true,
        }, 409);
      } else {
        errors.push(`${lesson.id.slice(0, 8)}: ${msg.slice(0, 100)}`);
      }
    }
  }

  console.log(
    `[bundle] competency=${competencyId.slice(0, 8)} enqueued=${enqueued} deduped=${deduped} total_lessons=${totalLessonsForCompetency} needs_regen=${lessons.length}`,
  );

  return json({
    ok: true,
    competency_id: competencyId,
    learning_field_id: learningFieldId,
    lessons_needing_regen: lessons.length,
    total_lessons: totalLessonsForCompetency ?? 0,
    enqueued,
    deduped,
    errors: errors.length > 0 ? errors : undefined,
  });
});
