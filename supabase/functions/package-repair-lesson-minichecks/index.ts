import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

/**
 * package-repair-lesson-minichecks
 *
 * Soft-Drift Targeted MC Repair (Wave 6b v3)
 *
 * Scope:
 *   - Only published packages, only non-EXAM_FIRST tracks.
 *   - Only lessons that have unapproved (status != 'approved') MCs.
 *
 * Action:
 *   1) Archive draft / unapproved MCs of the affected lessons
 *      (status='archived_duplicate', distractor_meta.archived_reason).
 *   2) Enqueue package_generate_lesson_minichecks (will refill below MIN since drafts are gone).
 *   3) Chain package_validate_lesson_minichecks (council/approval) right after.
 *   4) Audit each step in auto_heal_log.
 *
 * Heartbeat (S5b first-heartbeat contract):
 *   Sets job_queue.last_heartbeat_at on the source job within the first 5s
 *   of work, before any LLM/heavy DB call.
 */

const HEARTBEAT_DEADLINE_MS = 5_000;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function uuidLike(v: unknown): v is string {
  return typeof v === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: { "access-control-allow-origin": "*" } });
  }

  const startMs = Date.now();
  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let payload: any = {};
  try { payload = await req.json(); } catch { /* allow empty */ }

  const packageId    = payload.package_id    as string | undefined;
  const curriculumId = payload.curriculum_id as string | undefined;
  const jobId        = payload.job_id        as string | undefined;
  const mode         = payload.mode || "soft_drift_targeted_mc_repair";
  const target       = payload.target || "unapproved_minichecks";

  if (!uuidLike(packageId) || !uuidLike(curriculumId)) {
    return json({ ok: false, error: "INVALID_PAYLOAD: package_id+curriculum_id required" }, 400);
  }

  // ── S5b first-heartbeat: write within the first 5s ─────────────
  const heartbeatPromise = (async () => {
    if (!jobId) return;
    try {
      await sb.from("job_queue")
        .update({ last_heartbeat_at: new Date().toISOString() })
        .eq("id", jobId);
    } catch (_) { /* non-fatal */ }
  })();

  try {
    // Validate package + track
    const { data: pkg, error: pkgErr } = await sb
      .from("course_packages")
      .select("id, title, status, track, curriculum_id, course_id")
      .eq("id", packageId)
      .maybeSingle();
    if (pkgErr) throw pkgErr;
    if (!pkg) return json({ ok: false, error: "PACKAGE_NOT_FOUND" }, 404);
    if (pkg.status !== "published") {
      return json({ ok: false, skipped: true, reason: "PACKAGE_NOT_PUBLISHED", status: pkg.status }, 200);
    }
    if (pkg.track === "EXAM_FIRST") {
      return json({ ok: false, skipped: true, reason: "TRACK_NOT_APPLICABLE_EXAM_FIRST" }, 200);
    }

    // Resolve lesson_ids in this package: course → modules → lessons
    const courseId = pkg.course_id;
    if (!courseId) {
      return json({ ok: false, skipped: true, reason: "NO_COURSE_FOR_PACKAGE" }, 200);
    }
    const { data: modules } = await sb.from("modules").select("id").eq("course_id", courseId);
    const moduleIds = (modules ?? []).map((m: any) => m.id);
    if (moduleIds.length === 0) {
      return json({ ok: false, skipped: true, reason: "NO_MODULES" }, 200);
    }
    const { data: lessons } = await sb
      .from("lessons")
      .select("id")
      .in("module_id", moduleIds);
    const lessonIds = (lessons ?? []).map((l: any) => l.id);
    if (lessonIds.length === 0) {
      return json({ ok: false, skipped: true, reason: "NO_LESSONS" }, 200);
    }

    // Find unapproved MCs (paginated)
    const unapprovedIdsByLesson = new Map<string, string[]>();
    for (let i = 0; i < lessonIds.length; i += 200) {
      const chunk = lessonIds.slice(i, i + 200);
      const { data: rows } = await sb
        .from("minicheck_questions")
        .select("id, lesson_id, status")
        .in("lesson_id", chunk)
        .eq("curriculum_id", curriculumId)
        .eq("mode", "lesson")
        .neq("status", "approved")
        .neq("status", "archived_duplicate")
        .limit(5000);
      for (const r of rows ?? []) {
        const arr = unapprovedIdsByLesson.get(r.lesson_id) ?? [];
        arr.push(r.id);
        unapprovedIdsByLesson.set(r.lesson_id, arr);
      }
    }

    const allUnapprovedIds = Array.from(unapprovedIdsByLesson.values()).flat();
    const lessonsAffected = unapprovedIdsByLesson.size;

    // Make sure heartbeat landed
    await Promise.race([
      heartbeatPromise,
      new Promise((r) => setTimeout(r, HEARTBEAT_DEADLINE_MS)),
    ]);

    if (allUnapprovedIds.length === 0) {
      await sb.from("auto_heal_log").insert({
        action_type: "soft_drift_mc_targeted_repair_noop",
        target_type: "package",
        target_id: packageId,
        result_status: "noop",
        metadata: { reason: "no_unapproved_minichecks", mode, target },
      });
      return json({
        ok: true, repaired: 0, lessons_affected: 0,
        reason: "no_unapproved_minichecks",
        elapsed_ms: Date.now() - startMs,
      });
    }

    // Archive in chunks (no in-place mutation of distractor_meta to keep simple)
    let archived = 0;
    for (let i = 0; i < allUnapprovedIds.length; i += 200) {
      const chunk = allUnapprovedIds.slice(i, i + 200);
      const { count, error } = await sb
        .from("minicheck_questions")
        .update({
          status: "archived_duplicate",
          updated_at: new Date().toISOString(),
        }, { count: "exact" })
        .in("id", chunk)
        .neq("status", "approved")
        .neq("status", "archived_duplicate");
      if (error) throw error;
      archived += count ?? chunk.length;
    }

    // Enqueue generate (fills back below MIN since drafts gone)
    const generatePayload = {
      package_id: packageId,
      curriculum_id: curriculumId,
      mode,
      target,
      enqueue_source: "soft_drift_mc_required_repair",
      _origin: "package_repair_lesson_minichecks",
    };
    const { data: genJob, error: genErr } = await sb.from("job_queue").insert({
      job_type: "package_generate_lesson_minichecks",
      status: "pending",
      run_after: new Date().toISOString(),
      payload: generatePayload,
      meta: {
        wave: "soft_drift_mc",
        parent_job_id: jobId ?? null,
        archived_minichecks: archived,
      },
      priority: 110,
    }).select("id").single();
    if (genErr) throw genErr;

    // Chain validate (delayed slightly to avoid race with generate's batch start)
    const { data: valJob, error: valErr } = await sb.from("job_queue").insert({
      job_type: "package_validate_lesson_minichecks",
      status: "pending",
      run_after: new Date(Date.now() + 5 * 60_000).toISOString(),
      payload: {
        package_id: packageId,
        curriculum_id: curriculumId,
        enqueue_source: "soft_drift_mc_required_repair",
        _origin: "package_repair_lesson_minichecks",
      },
      meta: {
        wave: "soft_drift_mc",
        parent_job_id: jobId ?? null,
        depends_on: genJob.id,
      },
      priority: 105,
    }).select("id").single();
    if (valErr) throw valErr;

    await sb.from("auto_heal_log").insert({
      action_type: "soft_drift_mc_targeted_repair_done",
      target_type: "package",
      target_id: packageId,
      result_status: "success",
      metadata: {
        archived_minichecks: archived,
        lessons_affected: lessonsAffected,
        generate_job_id: genJob.id,
        validate_job_id: valJob.id,
        mode, target,
        elapsed_ms: Date.now() - startMs,
      },
    });

    return json({
      ok: true,
      repaired: archived,
      lessons_affected: lessonsAffected,
      generate_job_id: genJob.id,
      validate_job_id: valJob.id,
      elapsed_ms: Date.now() - startMs,
    });
  } catch (err) {
    const msg = (err as Error)?.message ?? String(err);
    try {
      await sb.from("auto_heal_log").insert({
        action_type: "soft_drift_mc_targeted_repair_error",
        target_type: "package",
        target_id: packageId,
        result_status: "error",
        error_message: msg,
        metadata: { mode, target, elapsed_ms: Date.now() - startMs },
      });
    } catch (_) { /* swallow */ }
    return json({ ok: false, error: msg }, 500);
  }
});
