import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { canonicalStepKey } from "../_shared/step-keys.ts";
import { assertSchemaReady } from "../_shared/schema-gate.ts";
import { enqueueJob } from "../_shared/enqueue.ts";

/**
 * package-generate-learning-content — DISPATCHER (v7)
 *
 * No longer generates content directly. Instead:
 * 1. Identifies missing lesson-step content_versions
 * 2. Enqueues individual `lesson_generate_content` jobs (1 per lesson-step)
 * 3. Reports batch_complete when all lesson-steps have content
 *
 * Benefits:
 *   - No Edge timeout risk (dispatcher runs <10s)
 *   - Perfect retry/backoff per lesson via job_queue
 *   - Parallel execution via worker pool concurrency
 *   - Poison pills isolated to single lesson jobs
 */

const MAX_ENQUEUE_PER_RUN = 50;  // Cap to avoid overwhelming queue
const STAGGER_MS = 150;          // Small stagger between jobs

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "content-type": "application/json" } });
}

async function prereqDone(sb: ReturnType<typeof createClient>, packageId: string, stepKey: string) {
  const { data: d1 } = await sb
    .from("package_steps").select("status")
    .eq("package_id", packageId).eq("step_key", stepKey).maybeSingle();
  if (d1?.status === "done") return true;
  const { data: d2 } = await sb
    .from("course_package_build_steps").select("status")
    .eq("package_id", packageId).eq("step_key", stepKey).maybeSingle();
  return d2?.status === "done";
}

async function countActiveLessonJobs(sb: ReturnType<typeof createClient>, packageId: string): Promise<number> {
  const { count, error } = await sb
    .from("job_queue")
    .select("id", { count: "exact", head: true })
    .eq("job_type", "lesson_generate_content")
    .eq("package_id", packageId)
    .in("status", ["pending", "queued", "processing"]);
  if (error) {
    console.warn(`[dispatcher] Active lesson job count failed: ${error.message}`);
    return 0;
  }
  return count ?? 0;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  await assertSchemaReady("package-generate-learning-content", sb);

  const body = await req.json().catch(() => ({}));
  const p = body.payload || body;

  const packageId = p.package_id;
  const courseId = p.course_id;
  const curriculumId = p.curriculum_id;
  const certificationId = p.certification_id || null;

  if (!packageId || !curriculumId || !courseId) {
    return json({ error: "Missing package_id, curriculum_id, or course_id" }, 400);
  }

  // ── Prereq check ──
  if (!(await prereqDone(sb, packageId, "scaffold_learning_course"))) {
    return json({ ok: false, retry: true, error: "PREREQ_NOT_DONE: scaffold_learning_course" }, 409);
  }

  // ── Fetch all lessons for this course ──
  const { data: allLessons, error: fetchErr } = await sb
    .from("lessons")
    .select("id, title, step, module_id, content, qc_status, modules!inner(course_id)")
    .eq("modules.course_id", courseId)
    .order("id", { ascending: true });

  if (fetchErr) return json({ error: fetchErr.message }, 500);
  const lessons = allLessons || [];

  if (lessons.length === 0) {
    return json({ ok: true, batch_complete: true, message: "No lessons found", total_lessons: 0 });
  }

  // ── Identify placeholder/missing lessons ──
  const placeholderLessons = lessons.filter((l: any) => {
    if (!l.content) return true;
    const c = l.content as Record<string, unknown>;
    if (c._placeholder === true || c._placeholder === "true") return true;
    if (c._regenerating === true || c._regenerating === "true") return true;
    if ((l as any).qc_status === "tier1_failed") return true;
    const contentLen = JSON.stringify(c).length;
    if (contentLen > 500 && !c._placeholder) return false;
    if (typeof c.html !== "string") return true;
    if (c.html.includes("Platzhalter") || (c.html as string).length < 100) return true;
    return false;
  });

  // ── Build list of (lesson_id, step_key) targets ──
  const targets = placeholderLessons.map((l: any) => ({
    lesson_id: l.id,
    step_key: canonicalStepKey(l.step),
    title: l.title,
  }));

  // ── Check which targets already have content_versions ──
  const lessonIds = [...new Set(targets.map(t => t.lesson_id))];
  let existingSet = new Set<string>();

  if (lessonIds.length > 0) {
    // Batch query in chunks of 200 to avoid URL length limits
    for (let i = 0; i < lessonIds.length; i += 200) {
      const chunk = lessonIds.slice(i, i + 200);
      const { data: existing } = await sb
        .from("content_versions")
        .select("lesson_id, step_key")
        .in("lesson_id", chunk)
        .neq("status", "rejected");

      for (const row of (existing || []) as any[]) {
        existingSet.add(`${row.lesson_id}:${row.step_key}`);
      }
    }
  }

  // ── Determine truly missing lesson-steps ──
  const missing = targets.filter(t => !existingSet.has(`${t.lesson_id}:${t.step_key}`));

  // ── If nothing missing: check DB integrity view as hard guard ──
  if (missing.length === 0) {
    // Also check integrity view to catch too-short content
    let tooShortCount = 0;
    try {
      const { data: integrity } = await sb
        .from("v_course_content_integrity")
        .select("placeholder_lessons, too_short_lessons")
        .eq("course_id", courseId)
        .maybeSingle();
      if (integrity) {
        tooShortCount = integrity.too_short_lessons || 0;
        if (integrity.placeholder_lessons > 0) {
          // DB reports more placeholders — re-check on next tick
          return json({
            ok: true,
            batch_complete: false,
            batch_cursor: { offset: 0 },
            message: `🔄 DB reports ${integrity.placeholder_lessons} placeholders remaining.`,
            total_lessons: lessons.length,
            placeholders_remaining: integrity.placeholder_lessons,
          });
        }
      }
    } catch { /* integrity view not available — proceed */ }

    // Mark too-short for regen if needed
    if (tooShortCount > 0) {
      const { data: courseModules } = await sb
        .from("modules").select("id").eq("course_id", courseId);
      const moduleIds = (courseModules || []).map((m: any) => m.id);

      if (moduleIds.length > 0) {
        const { data: shortLessons } = await sb
          .from("lessons")
          .select("id, content")
          .in("module_id", moduleIds)
          .not("content", "is", null);

        let marked = 0;
        for (const lesson of (shortLessons || [])) {
          const c = lesson.content as Record<string, unknown>;
          const html = typeof c?.html === "string" ? c.html : "";
          if (html.length > 0 && html.length < 200 && c?._placeholder !== true) {
            await sb.rpc("pipeline_write_lesson_content_v2" as any, {
              p_lesson_id: lesson.id,
              p_content: { ...c, _regenerating: true, _placeholder: true },
              p_source: 'generate-learning-content',
            });
            marked++;
          }
        }
        if (marked > 0) {
          return json({
            ok: true, batch_complete: false, batch_cursor: { offset: 0 },
            message: `🔄 ${marked} too-short lessons marked for regeneration.`,
            too_short_marked: marked,
          });
        }
      }
    }

    // Check if any lesson jobs are still running
    const activeJobs = await countActiveLessonJobs(sb, packageId);
    if (activeJobs > 0) {
      return json({
        ok: true,
        batch_complete: false,
        message: `⏳ ${activeJobs} lesson jobs still active — waiting.`,
        active_lesson_jobs: activeJobs,
        total_lessons: lessons.length,
      });
    }

    return json({
      ok: true,
      batch_complete: true,
      message: `✅ Alle ${lessons.length} Lektionen haben Inhalt.`,
      total_lessons: lessons.length,
      placeholders_remaining: 0,
    });
  }

  // ── Enqueue missing lesson-steps as individual jobs ──
  const toEnqueue = missing.slice(0, MAX_ENQUEUE_PER_RUN);
  let enqueued = 0;
  let deduped = 0;
  const now = Date.now();
  const errors: string[] = [];

  // ── Update package_steps.meta with dispatch progress ──
  try {
    const { data: stepRow } = await sb
      .from("package_steps")
      .select("id, meta")
      .eq("package_id", packageId)
      .eq("step_key", "generate_learning_content")
      .maybeSingle();
    if (stepRow) {
      await sb.from("package_steps").update({
        meta: {
          ...(stepRow.meta ?? {}),
          dispatcher_mode: true,
          total_missing: missing.length,
          enqueue_batch: toEnqueue.length,
          last_dispatch_at: new Date().toISOString(),
        },
      }).eq("id", stepRow.id);
    }
  } catch { /* non-critical */ }

  for (let i = 0; i < toEnqueue.length; i++) {
    const t = toEnqueue[i];
    try {
      const result = await enqueueJob(sb, {
        job_type: "lesson_generate_content",
        package_id: packageId,
        payload: {
          package_id: packageId,
          course_id: courseId,
          curriculum_id: curriculumId,
          certification_id: certificationId,
          lesson_id: t.lesson_id,
          step_key: t.step_key,
        },
        // batch_cursor makes idempotency_key unique per lesson-step:
        // "lesson_generate_content:{pkg}:{lesson_id}:{step_key}"
        batch_cursor: { lesson_id: t.lesson_id, step_key: t.step_key },
        priority: 12,
        run_after: new Date(now + i * STAGGER_MS).toISOString(),
        max_attempts: 5,
      });

      if (result.revived) {
        console.log(`[dispatcher] Revived job for ${t.lesson_id.slice(0, 8)}:${t.step_key}`);
      }
      enqueued++;
    } catch (e) {
      const msg = (e as Error).message || String(e);
      // Dedup: job already exists in active state
      if (msg.includes("DEDUP") || msg.includes("duplicate") || msg.includes("23505")) {
        deduped++;
      } else if (msg.includes("PACKAGE_NOT_EXECUTABLE")) {
        // Package no longer building — stop dispatching
        return json({
          ok: false,
          error: "Package not executable",
          details: msg,
          enqueued,
          deduped,
        }, 409);
      } else {
        errors.push(`${t.lesson_id.slice(0, 8)}: ${msg.slice(0, 100)}`);
      }
    }
  }

  const moreRemaining = missing.length > MAX_ENQUEUE_PER_RUN;

  console.log(`[dispatcher] ${packageId.slice(0, 8)}: ${enqueued} enqueued, ${deduped} deduped, ${missing.length} total missing, ${errors.length} errors`);

  return json({
    ok: true,
    batch_complete: false,
    batch_cursor: moreRemaining ? { offset: 0 } : undefined,
    message: `📤 ${enqueued} Lesson-Jobs enqueued (${deduped} deduped), ${missing.length} total fehlend.`,
    total_lessons: lessons.length,
    total_missing: missing.length,
    enqueued,
    deduped,
    errors: errors.length > 0 ? errors : undefined,
    capped: moreRemaining,
  });
});
