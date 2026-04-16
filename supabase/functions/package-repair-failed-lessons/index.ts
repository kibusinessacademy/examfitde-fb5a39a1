import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { finalizeStepDone, finalizeStepFailed } from "../_shared/step-finalize.ts";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const body = await req.json().catch(() => ({}));
  const p = body.payload || body;

  const packageId = p?.package_id as string;
  const courseId = p?.course_id as string;
  const failedLessonIds = p?.failed_lesson_ids as string[] | undefined;
  const publishRetryCount = p?.publish_retry_count ?? 1;

  if (!packageId) return json({ error: "MISSING_PACKAGE_ID" }, 400);

  console.log(`[repair-failed-lessons] Starting for package ${packageId.slice(0, 8)}, retry #${publishRetryCount}`);

  try {
    // ── 1. Resolve course_id if not provided ──
    let resolvedCourseId = courseId;
    if (!resolvedCourseId) {
      const { data: pkg } = await sb.from("course_packages").select("course_id").eq("id", packageId).maybeSingle();
      resolvedCourseId = (pkg as any)?.course_id;
      if (!resolvedCourseId) return json({ error: "COURSE_NOT_FOUND" }, 404);
    }

    // ── 2. Find failed lessons ──
    const { data: modRows } = await sb.from("modules").select("id").eq("course_id", resolvedCourseId);
    const moduleIds = (modRows || []).map((m: any) => m.id);

    if (moduleIds.length === 0) {
      await finalizeStepDone(sb, packageId, "repair_failed_lessons", { skipped: true, reason: "no_modules" });
      return json({ ok: true, repaired: 0, reason: "no_modules" });
    }

    let query = sb
      .from("lessons")
      .select("id, title, qc_status, status, content")
      .in("module_id", moduleIds)
      .eq("status", "draft")
      .in("qc_status", ["tier1_failed", "needs_revision"]);

    // If specific IDs provided, narrow scope
    if (failedLessonIds && failedLessonIds.length > 0) {
      query = query.in("id", failedLessonIds);
    }

    const { data: failedLessons, error: fetchErr } = await query;
    if (fetchErr) {
      console.error(`[repair-failed-lessons] Failed to fetch lessons: ${fetchErr.message}`);
      return json({ error: fetchErr.message }, 500);
    }

    if (!failedLessons || failedLessons.length === 0) {
      console.log(`[repair-failed-lessons] No failed lessons found — setting building for DAG dispatch`);

      await sb.from("course_packages").update({
        status: "building",
        updated_at: new Date().toISOString(),
      }).eq("id", packageId);

      await finalizeStepDone(sb, packageId, "repair_failed_lessons", { repaired: 0, action: "set_building_for_dag_dispatch" });
      return json({ ok: true, repaired: 0, action: "set_building_for_dag_dispatch" });
    }

    // ── 3. Classify repair mode per lesson ──
    const repairs: Array<{ id: string; title: string; mode: string }> = [];

    for (const lesson of failedLessons) {
      const content = lesson.content;
      const isPlaceholder = content && typeof content === "object" && (content as any)._placeholder === true;
      const isEmpty = !content || (typeof content === "object" && Object.keys(content).length === 0);
      const contentStr = typeof content === "string" ? content : JSON.stringify(content || "");
      const isTooShort = contentStr.length < 500;

      let mode = "full_regenerate";
      if (isPlaceholder || isEmpty) {
        mode = "full_regenerate";
      } else if (isTooShort) {
        mode = "expand_depth";
      } else if (lesson.qc_status === "tier1_failed") {
        mode = "fix_structure";
      } else {
        mode = "expand_depth";
      }

      repairs.push({ id: lesson.id, title: lesson.title, mode });
    }

    console.log(`[repair-failed-lessons] Repairing ${repairs.length} lessons:`,
      repairs.map(r => `${r.title?.slice(0, 30)} → ${r.mode}`));

    // ── 4. Reset QC status + mark for regeneration ──
    const lessonIds = repairs.map(r => r.id);

    // Reset qc_status to pending and set content to regeneration marker
    for (const repair of repairs) {
      const updateData: any = { qc_status: "pending" };

      if (repair.mode === "full_regenerate") {
        // Mark as placeholder to trigger full regeneration
        updateData.content = { _placeholder: true, _regenerating: true, _repair_reason: "publish_qc_failed" };
      }
      // For expand_depth and fix_structure, keep existing content — the generator will enhance it

      await sb.from("lessons").update(updateData).eq("id", repair.id);
    }

    // ── 5. Set package back to building ──
    await sb.from("course_packages").update({
      status: "building",
      updated_at: new Date().toISOString(),
    }).eq("id", packageId);

    // ── 6. Re-queue the generate_learning_content step ──
    await sb.from("package_steps").update({
      status: "queued",
      started_at: null,
      finished_at: null,
      last_error: `PUBLISH_REPAIR: ${repairs.length} lessons need re-generation (retry ${publishRetryCount})`,
      meta: {
        repair_triggered: true,
        repair_lesson_count: repairs.length,
        repair_lesson_ids: lessonIds,
        publish_retry_count: publishRetryCount,
        repair_at: new Date().toISOString(),
      },
    }).eq("package_id", packageId).eq("step_key", "generate_learning_content");

    // Also reset validate_learning_content
    await sb.from("package_steps").update({
      status: "queued",
      started_at: null,
      finished_at: null,
      last_error: "AWAITING_REPAIR_COMPLETION",
    }).eq("package_id", packageId).eq("step_key", "validate_learning_content");

    // Reset downstream steps that need to re-run after content fix
    const downstreamSteps = ["run_integrity_check", "quality_council", "auto_publish"];
    for (const stepKey of downstreamSteps) {
      await sb.from("package_steps").update({
        status: "queued",
        started_at: null,
        finished_at: null,
        last_error: "AWAITING_UPSTREAM_REPAIR",
      }).eq("package_id", packageId).eq("step_key", stepKey);
    }

    // ── 7. Audit log ──
    await sb.from("auto_heal_log").insert({
      action_type: "publish_repair_lessons",
      trigger_source: "package-repair-failed-lessons",
      target_type: "course_package",
      target_id: packageId,
      result_status: "applied",
      result_detail: `Repaired ${repairs.length} failed lessons. Modes: ${repairs.map(r => r.mode).join(", ")}`,
      metadata: {
        repairs,
        publish_retry_count: publishRetryCount,
        package_id: packageId,
      },
    });

    // ── 8. Notify admin ──
    try {
      await sb.rpc("admin_notify", {
        p_title: `🔧 Lesson-Repair gestartet (${repairs.length} Lessons)`,
        p_body: `Package ${packageId.slice(0, 8)}: ${repairs.map(r => r.title?.slice(0, 25)).join(", ")}. Publish-Retry ${publishRetryCount}/2.`,
        p_category: "quality",
        p_severity: "info",
        p_entity_type: "course_package",
        p_entity_id: packageId,
      });
    } catch (_) { /* non-critical */ }

    await finalizeStepDone(sb, packageId, "repair_failed_lessons", {
      repaired: repairs.length,
      publish_retry_count: publishRetryCount,
    });

    return json({
      ok: true,
      repaired: repairs.length,
      repairs,
      publish_retry_count: publishRetryCount,
      next_step: "generate_learning_content will re-run for affected lessons",
    });

  } catch (err) {
    console.error(`[repair-failed-lessons] Error: ${(err as Error).message}`);
    await finalizeStepFailed(sb, packageId, "repair_failed_lessons", err);
    return json({ error: (err as Error).message }, 500);
  }
});
