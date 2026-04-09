/**
 * stuck-scan: Zombie step detection + hollow completion guards.
 *
 * Uses SSOT `isStepFinalizable` + `cancelTerminalLoopJobs` from
 * stuck-scan-helpers.ts to determine finalizability.
 *
 * IMPORTANT: This file MUST NOT contain inline job-liveness checks.
 * All "is this job genuinely active?" logic lives in stuck-scan-helpers.ts.
 */
import { STEP_TO_JOB_TYPE } from "./job-map.ts";
import { markStepDone } from "./steps.ts";
import { safeRpc, isStepFinalizable, cancelTerminalLoopJobs, type SupabaseClient } from "./stuck-scan-helpers.ts";

/**
 * All steps that can be auto-finalized when postcondition signals
 * (batch_complete / meta.ok) are present but the step is stuck.
 *
 * IMPORTANT: This must cover every step that can stall due to
 * job-liveness mismatches. Missing entries = finalization deadlocks.
 */
const ZOMBIFIABLE_STEPS = new Set([
  // Validation steps
  "validate_learning_content", "validate_exam_pool", "validate_blueprints",
  "validate_oral_exam", "validate_handbook", "validate_lesson_minichecks",
  "validate_tutor_index", "validate_handbook_depth", "validate_blueprint_variants",
  // Generation steps that emit batch_complete
  "generate_oral_exam", "generate_exam_pool", "generate_learning_content",
  "generate_lesson_minichecks", "generate_handbook",
  // Build/transform steps
  "build_ai_tutor_index", "elite_harden", "expand_handbook",
  "enqueue_handbook_expand",
  // Finalization steps
  "run_integrity_check", "quality_council", "auto_publish",
  // Variant steps
  "generate_blueprint_variants", "promote_blueprint_variants",
]);

export async function detectAndFixZombieSteps(sb: SupabaseClient) {
  const { data: zombieSteps } = await sb
    .from("package_steps")
    .select("package_id, step_key, meta, attempts, started_at, updated_at, status")
    .in("status", ["running", "enqueued", "queued"]);

  const zombieResults: Array<{ package_id: string; step_key: string; action: string }> = [];

  for (const zs of zombieSteps || []) {
    if (!ZOMBIFIABLE_STEPS.has(zs.step_key)) continue;

    const meta = (zs.meta ?? {}) as Record<string, unknown>;
    const jobType = STEP_TO_JOB_TYPE[zs.step_key] ?? null;

    // ── SSOT: Use centralized finalizability check ──
    const result = await isStepFinalizable(sb, {
      package_id: zs.package_id,
      step_key: zs.step_key,
      status: zs.status,
      meta,
      started_at: zs.started_at,
      updated_at: zs.updated_at,
    }, jobType);

    if (!result.finalizable) {
      if (result.genuinelyActiveJobs > 0) {
        console.log(`[stuck-scan] Zombie candidate ${zs.step_key} for ${zs.package_id.slice(0, 8)} skipped: ${result.reason}`);
      }
      continue;
    }

    // Cancel terminal-loop jobs blocking finalization
    if (result.terminalJobs > 0 && jobType) {
      const cancelled = await cancelTerminalLoopJobs(sb, zs.package_id, jobType);
      console.log(`[stuck-scan] 🔓 Cancelled ${cancelled} terminal-loop job(s) for ${zs.step_key} (${zs.package_id.slice(0, 8)})`);
    }

    // ── HOLLOW COMPLETION GUARD: generate_learning_content ──
    if (zs.step_key === "generate_learning_content") {
      const { data: pkg } = await sb.from("course_packages").select("course_id").eq("id", zs.package_id).maybeSingle();
      if (pkg?.course_id) {
        const { data: mods } = await sb.from("modules").select("id").eq("course_id", pkg.course_id);
        const modIds = (mods ?? []).map((m: { id: string }) => m.id);
        if (modIds.length > 0) {
          const { count: brokenCount } = await sb
            .from("lessons")
            .select("id", { count: "exact", head: true })
            .in("module_id", modIds)
            .or("content.is.null,qc_status.eq.tier1_failed,content->>_placeholder.eq.true,content->>_regenerating.eq.true");
          if ((brokenCount ?? 0) > 0) {
            console.warn(`[stuck-scan] HOLLOW GUARD: generate_learning_content for ${zs.package_id.slice(0,8)} has ${brokenCount} broken lessons — NOT finalizing, resetting to running`);
            await sb.from("package_steps").update({
              status: "running",
              meta: {
                ...meta, force_running: true,
                hollow_guard_blocked_at: new Date().toISOString(),
                broken_lessons: brokenCount,
                last_progress_note: `HOLLOW_GUARD: ${brokenCount} broken lessons, cannot finalize`,
              },
            }).eq("package_id", zs.package_id).eq("step_key", zs.step_key);
            zombieResults.push({ package_id: zs.package_id, step_key: zs.step_key, action: `HOLLOW GUARD: reset to running (${brokenCount} broken lessons)` });
            continue;
          }
        }
      }
    }

    // ── HOLLOW COMPLETION GUARD: generate_exam_pool ──
    if (zs.step_key === "generate_exam_pool") {
      const { data: pkg } = await sb.from("course_packages").select("curriculum_id, meta").eq("id", zs.package_id).maybeSingle();
      if (pkg?.curriculum_id) {
        const { count: qCount } = await sb.from("exam_questions").select("id", { count: "exact", head: true }).eq("curriculum_id", pkg.curriculum_id).neq("status", "rejected").not("qc_status", "in", "(tier1_failed,rejected)");
        const pkgMeta = (pkg.meta ?? {}) as Record<string, unknown>;
        const examTarget = Number(pkgMeta?.exam_target ?? 1000);
        const minRequired = Math.max(50, Math.floor(examTarget * 0.05));
        if ((qCount ?? 0) < minRequired) {
          console.warn(`[stuck-scan] HOLLOW GUARD: ${zs.step_key} for ${zs.package_id.slice(0,8)} has ${qCount ?? 0} exam questions (min=${minRequired}) — NOT finalizing, resetting to queued`);
          await sb.from("package_steps").update({
            status: "queued", started_at: null, finished_at: null,
            updated_at: new Date().toISOString(), job_id: null, runner_id: null,
            last_error: `HOLLOW_COMPLETION: ${qCount ?? 0}/${minRequired} questions`,
            meta: { ...meta, note: `HOLLOW_GUARD: ${qCount ?? 0}/${minRequired} questions, reset by stuck-scan`, hollow_guard_at: new Date().toISOString(), last_error_class: "permanent", last_error_kind: "hollow_completion" },
          }).eq("package_id", zs.package_id).eq("step_key", zs.step_key);

          await safeRpc(sb, "cancel_jobs_for_package", {
            p_package_id: zs.package_id, p_job_type: "package_validate_exam_pool",
            p_statuses: ["pending", "processing"],
            p_reason: `HOLLOW_GUARD: ${qCount ?? 0}/${minRequired} questions`,
          });

          await sb.from("auto_heal_log").insert({
            action_type: "watchdog_postcondition_guard", trigger_source: "stuck-scan",
            target_type: "package_step", target_id: zs.package_id,
            result_status: "blocked_done_heal",
            result_detail: `HOLLOW_COMPLETION: ${zs.step_key} has ${qCount ?? 0}/${minRequired} questions`,
            metadata: { step_key: zs.step_key, curriculum_id: pkg.curriculum_id, question_count: qCount ?? 0, min_required: minRequired },
          });

          zombieResults.push({ package_id: zs.package_id, step_key: zs.step_key, action: `HOLLOW GUARD: reset to queued (${qCount ?? 0}/${minRequired} questions)` });
          continue;
        }
      }
    }

    // ── HOLLOW COMPLETION GUARD: auto_seed_exam_blueprints ──
    if (zs.step_key === "auto_seed_exam_blueprints") {
      const { data: pkg } = await sb.from("course_packages").select("curriculum_id").eq("id", zs.package_id).maybeSingle();
      if (pkg?.curriculum_id) {
        const { count: bpCount } = await sb.from("question_blueprints").select("id", { count: "exact", head: true }).eq("curriculum_id", pkg.curriculum_id);
        if ((bpCount ?? 0) < 1) {
          console.warn(`[stuck-scan] HOLLOW GUARD: ${zs.step_key} for ${zs.package_id.slice(0,8)} has 0 blueprints — NOT finalizing, resetting to queued`);
          await sb.from("package_steps").update({
            status: "queued", started_at: null, finished_at: null,
            updated_at: new Date().toISOString(), job_id: null, runner_id: null,
            last_error: "HOLLOW_COMPLETION: 0 blueprints",
            meta: { ...meta, note: "HOLLOW_GUARD: 0 blueprints, reset by stuck-scan", hollow_guard_at: new Date().toISOString(), last_error_class: "permanent", last_error_kind: "hollow_completion" },
          }).eq("package_id", zs.package_id).eq("step_key", zs.step_key);

          await sb.from("auto_heal_log").insert({
            action_type: "watchdog_postcondition_guard", trigger_source: "stuck-scan",
            target_type: "package_step", target_id: zs.package_id,
            result_status: "blocked_done_heal",
            result_detail: `HOLLOW_COMPLETION: ${zs.step_key} has 0 blueprints`,
            metadata: { step_key: zs.step_key, curriculum_id: pkg.curriculum_id, blueprint_count: 0 },
          });

          zombieResults.push({ package_id: zs.package_id, step_key: zs.step_key, action: "HOLLOW GUARD: reset to queued (0 blueprints)" });
          continue;
        }
      }
    }

    // Finalize step via SSOT markStepDone
    const age = zs.started_at ? Date.now() - new Date(zs.started_at).getTime() : Infinity;
    try {
      await markStepDone(sb, {
        packageId: zs.package_id, stepKey: zs.step_key,
        meta: { finalized_by: "stuck-scan", note: "zombie finalization" },
      });
      await sb.from("package_steps").update({ last_error: null })
        .eq("package_id", zs.package_id).eq("step_key", zs.step_key);
    } catch (postCondErr: unknown) {
      const msg = postCondErr instanceof Error ? postCondErr.message : String(postCondErr);
      console.warn(`[stuck-scan] ⛔ markStepDone BLOCKED for ${zs.step_key} (${zs.package_id.slice(0,8)}): ${msg} — resetting to queued`);
      await sb.from("package_steps").update({
        status: "queued", started_at: null, finished_at: null,
        last_error: `stuck-scan post-condition failed: ${msg.slice(0, 500)}`,
      }).eq("package_id", zs.package_id).eq("step_key", zs.step_key);
      zombieResults.push({ package_id: zs.package_id, step_key: zs.step_key, action: "POST_CONDITION_BLOCKED: reset to queued" });
      continue;
    }

    // Cancel jobs scoped to this step
    const jobTypeForCleanup = jobType;
    await safeRpc(sb, "cancel_jobs_for_package", {
      p_package_id: zs.package_id, p_job_type: jobTypeForCleanup,
      p_statuses: ["pending", "failed"],
      p_reason: `stuck-scan zombie finalize: cleanup for step ${zs.step_key}`,
    });
    await safeRpc(sb, "cancel_stale_processing_jobs_for_package", {
      p_package_id: zs.package_id, p_job_type: jobTypeForCleanup,
      p_stale_minutes: 15,
      p_reason: `stuck-scan zombie finalize: cleanup stale processing for step ${zs.step_key}`,
    });

    await sb.from("auto_heal_log").insert({
      action_type: "zombie_step_auto_finalize", trigger_source: "stuck-scan",
      target_type: "package_step", target_id: zs.package_id,
      result_status: "applied",
      result_detail: `Step ${zs.step_key} was ${zs.status} with meta.ok=${meta.ok}, batch_complete=${meta.batch_complete} for ${Math.round(age / 60000)}min — forced to done + jobs cancelled`,
      metadata: { step_key: zs.step_key, original_status: zs.status, meta, age_min: Math.round(age / 60000) },
    });

    zombieResults.push({ package_id: zs.package_id, step_key: zs.step_key, action: `forced to done (was ${zs.status}) + jobs cancelled` });
  }

  if (zombieResults.length > 0) {
    console.log(`[stuck-scan] 🧟 Fixed ${zombieResults.length} zombie step(s)`);
  }

  return zombieResults;
}
