/**
 * pipeline-process.ts — Core pipeline processing logic
 * Contains processPackage() and backfillPipelinePool().
 * Extracted from pipeline-runner/index.ts to reduce bundle size.
 */

import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { inferBackoffSeconds, getFanOutConfig, STEP_TO_JOB_TYPE, PIPELINE_GRAPH, type PipelineStepKey } from "./job-map.ts";
import { isCapabilityGranted } from "./capability-gating.ts";
import { markStepDone } from "./steps.ts";
import { classifyStep } from "./step-weight.ts";
import {
  type StepKey, type StepRow, type StepAction, type StepClassContext,
  safeRpc, safeQuery, getLearningContentProgress,
  isTransientStepError, buildStepOrder, pickNextAction, pickParallelActions,
} from "./pipeline-helpers.ts";
import { handleJobFailed } from "./pipeline-handlers.ts";
import { handleEnqueue } from "./pipeline-handlers.ts";
import { enqueueJob } from "./enqueue.ts";
import { updateLoopGuardMeta } from "./loop-guard.ts";
import { backfillPipelinePool } from "./pipeline-backfill.ts";
export { backfillPipelinePool } from "./pipeline-backfill.ts";

// ══════════════════════════════════════════════════════════════
// Process a single acquired package — returns result summary
// ══════════════════════════════════════════════════════════════

export async function processPackage(
  sb: ReturnType<typeof createClient>,
  packageId: string,
  runnerId: string,
  stepClassCtx?: StepClassContext,
): Promise<Record<string, unknown>> {
  const shortId = packageId.slice(0, 8);

  // ── Load package metadata ──
  const { data: pkg, error: pkgErr } = await sb
    .from("course_packages")
    .select("id,title,status,published_at,pipeline_mode,course_id,curriculum_id,certification_id,feature_flags")
    .eq("id", packageId)
    .single();

  if (pkgErr || !pkg) {
    await safeRpc(sb, "release_package_lease", { p_package_id: packageId, p_runner_id: runnerId });
    return { packageId, error: pkgErr?.message ?? "package not found" };
  }

  // ── Executability guard (self-heal status drift) ──
  // HARDENED: Allow council_review for council-related processing
  const PROCESS_ALLOWED_STATUSES = new Set(["building", "council_review"]);
  if (pkg.published_at || !PROCESS_ALLOWED_STATUSES.has(pkg.status)) {
    const normalizedStatus = pkg.published_at ? "published" : pkg.status;

    if (pkg.published_at && pkg.status !== "published") {
      await safeQuery(
        sb.from("course_packages").update({
          status: "published",
          last_error: "OPS_NORMALIZE:PUBLISHED_STATUS",
          updated_at: new Date().toISOString(),
        }).eq("id", packageId),
      );
    }

    await safeRpc(sb, "release_package_lease", { p_package_id: packageId, p_runner_id: runnerId });
    return {
      packageId,
      skipped: true,
      reason: pkg.published_at ? "already_published" : "package_not_building",
      package_status: normalizedStatus,
    };
  }

  // ── Auto-resolve missing curriculum_id ──
  if (!pkg.curriculum_id && pkg.course_id) {
    const { data: course } = await sb
      .from("courses")
      .select("curriculum_id")
      .eq("id", pkg.course_id)
      .single();

    if (course?.curriculum_id) {
      await safeQuery(
        sb.from("course_packages").update({ curriculum_id: course.curriculum_id }).eq("id", packageId),
      );
      pkg.curriculum_id = course.curriculum_id;
      console.log(`[runner] Auto-resolved curriculum_id for ${shortId}`);
    }
  }

  // ── Block if missing required IDs ──
  if (!pkg.curriculum_id || !pkg.course_id) {
    await safeQuery(
      sb.from("course_packages")
        .update({ status: "blocked", blocked_reason: "missing_curriculum_or_course_id" })
        .eq("id", packageId),
    );
    await safeRpc(sb, "release_package_lease", { p_package_id: packageId, p_runner_id: runnerId });
    return { packageId, blocked: true, reason: "missing_curriculum_or_course_id" };
  }

  const mode = (pkg.pipeline_mode ?? "factory") as "factory" | "production";

  // ── Load steps & determine next action ──
  const { data: steps, error: stepsErr } = await sb
    .from("package_steps")
    .select("step_key,status,attempts,max_attempts,timeout_seconds,started_at,meta,job_id,last_error,updated_at")
    .eq("package_id", packageId);

  if (stepsErr) {
    await safeRpc(sb, "release_package_lease", { p_package_id: packageId, p_runner_id: runnerId });
    return { packageId, error: stepsErr.message };
  }

  // ── Backbone Guard: ensure all mandatory steps exist ──
  // This heals packages that were created before new steps were added to the DAG.
  if (steps && steps.length > 0 && steps.length < 25) {
    try {
      const { data: bbResult } = await safeRpc(sb, "assert_step_backbone", { p_package_id: packageId });
      if (bbResult && (bbResult as any)?.missing > 0) {
        console.log(`[runner] 🩹 Backbone healed ${shortId}: inserted ${(bbResult as any).inserted} missing steps`);
        // Re-load steps after backbone heal
        const { data: refreshedSteps } = await sb
          .from("package_steps")
          .select("step_key,status,attempts,max_attempts,timeout_seconds,started_at,meta,job_id,last_error,updated_at")
          .eq("package_id", packageId);
        if (refreshedSteps) {
          (steps as any[]).length = 0;
          (steps as any[]).push(...refreshedSteps);
        }
      }
    } catch (_bbErr) {
      // Non-fatal — log and continue
      console.warn(`[runner] Backbone guard error for ${shortId}: ${(_bbErr as Error).message}`);
    }
  }

  // ── SSOT Step Reconciliation: skip steps that don't belong to this track ──
  try {
    const { data: reconResult } = await safeRpc(sb, "fn_reconcile_package_steps_to_ssot", { p_package_id: packageId });
    if (reconResult && (reconResult as any)?.steps_fixed > 0) {
      console.log(`[runner] 🔧 Reconciled ${shortId}: skipped ${(reconResult as any).steps_fixed} drifted steps (${(reconResult as any).fixed_steps?.join(",")})`);
      // Re-load steps after reconciliation
      const { data: refreshedSteps } = await sb
        .from("package_steps")
        .select("step_key,status,attempts,max_attempts,timeout_seconds,started_at,meta,job_id,last_error,updated_at")
        .eq("package_id", packageId);
      if (refreshedSteps) {
        (steps as any[]).length = 0;
        (steps as any[]).push(...refreshedSteps);
      }
    }
  } catch (_reconErr) {
    console.warn(`[runner] Reconcile guard error for ${shortId}: ${(_reconErr as Error).message}`);
  }

  {
    const nowMs = Date.now();
    const pendingSteps = (steps || []).filter((s: any) => s.status !== 'done' && s.status !== 'skipped' && s.status !== 'blocked');
    const allBackedOff = pendingSteps.length > 0 && pendingSteps.every((s: any) => {
      const nra = (s.meta as Record<string, unknown>)?.next_run_at;
      if (typeof nra !== 'string') return false;
      const nraMs = Date.parse(nra);
      return !Number.isNaN(nraMs) && nraMs > nowMs;
    });
    if (allBackedOff) {
      console.log(`[runner] 💤 All ${pendingSteps.length} pending steps for ${shortId} have future next_run_at — releasing early`);
      await safeRpc(sb, "release_package_lease", { p_package_id: packageId, p_runner_id: runnerId });
      return { packageId, skipped: true, reason: "all_steps_backed_off", pending: pendingSteps.length };
    }
  }

  // ── Bootstrap: If no steps exist, invoke build-course-package to create them ──
  if (!steps || steps.length === 0) {
    console.log(`[runner] Package ${shortId} has no steps — invoking build-course-package to bootstrap`);
    try {
      const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
      const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

      await safeRpc(sb, "try_claim_pipeline_lock", { p_package_id: packageId, p_locked_by: runnerId });

      const buildRes = await fetch(`${SUPABASE_URL}/functions/v1/build-course-package`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        },
        body: JSON.stringify({
          packageId,
          courseId: pkg.course_id,
          curriculumId: pkg.curriculum_id,
          certificationId: pkg.certification_id,
        }),
      });

      const buildData = await buildRes.json().catch(() => ({}));

      if (!buildRes.ok) {
        console.error(`[runner] build-course-package failed for ${shortId}: ${JSON.stringify(buildData)}`);
        await safeQuery(
          sb.from("course_packages")
            .update({ status: "blocked", blocked_reason: `build_init_failed: ${buildData.error || buildRes.status}` })
            .eq("id", packageId),
        );
        await safeRpc(sb, "release_package_lease", { p_package_id: packageId, p_runner_id: runnerId });
        return { packageId, error: "build_init_failed", detail: buildData };
      }

      console.log(`[runner] ✅ build-course-package bootstrapped ${shortId}: enqueued=${buildData.enqueued}`);
      await safeRpc(sb, "release_package_lease", { p_package_id: packageId, p_runner_id: runnerId });
      return { packageId, bootstrapped: true, enqueued: buildData.enqueued };
    } catch (buildErr) {
      console.error(`[runner] Bootstrap error for ${shortId}:`, (buildErr as Error).message);
      await safeRpc(sb, "release_package_lease", { p_package_id: packageId, p_runner_id: runnerId });
      return { packageId, error: `bootstrap_error: ${(buildErr as Error).message}` };
    }
  }

  // ── Step Completeness Guard ──
  {
    const ELITE_MANDATORY_STEPS: StepKey[] = [
      "elite_harden",
      "generate_lesson_minichecks",
      "validate_lesson_minichecks",
      "enqueue_handbook_expand",
      "expand_handbook",
      "validate_handbook_depth",
    ];
    const existingKeys = new Set((steps ?? []).map((s: StepRow) => s.step_key));
    const missingElite = ELITE_MANDATORY_STEPS.filter(k => !existingKeys.has(k));
    if (missingElite.length > 0 && (pkg as any).track === "AUSBILDUNG_VOLL") {
      console.warn(`[runner] 🛡️ Step Completeness Guard: ${shortId} missing Elite steps: ${missingElite.join(", ")}`);
      for (const mk of missingElite) {
        await safeQuery(
          sb.rpc("ensure_package_step", {
            p_package_id: packageId,
            p_step_key: mk,
            p_status: "queued",
            p_meta: { auto_created: true, reason: "step_completeness_guard" },
          }),
          `insert_missing_step_${mk}`,
        );
        (steps as StepRow[]).push({
          step_key: mk, status: "queued",
          meta: { auto_created: true },
        } as unknown as StepRow);
      }
    }
  }

  // ── Guardrail: prevent premature exhaustion for long-running learning generation ──
  {
    const learningStep = (steps ?? []).find((s: StepRow) => s.step_key === "generate_learning_content");
    if (learningStep && (learningStep.max_attempts ?? 0) < 20) {
      await safeQuery(
        sb.from("package_steps")
          .update({ max_attempts: 20 })
          .eq("package_id", packageId)
          .eq("step_key", "generate_learning_content"),
        "raise_generate_learning_content_max_attempts",
      );
      learningStep.max_attempts = 20;
    }
  }

  // ── DAG-aware sequence integrity guard ──
  // Instead of linear STEP_ORDER, use the PIPELINE_GRAPH DAG to check:
  // A step should only be "done" if ALL its DAG predecessors are done/skipped.
  // This prevents false resets of parallel branches.
  const STEP_ORDER = buildStepOrder((steps ?? []) as { step_key: string }[]);
  {
    // Build DAG dependency lookup
    const dagDeps = new Map<string, string[]>();
    for (const node of PIPELINE_GRAPH) {
      dagDeps.set(node.key, node.dependsOn ?? []);
    }

    const byKey = new Map<string, StepRow>();
    for (const s of (steps ?? []) as StepRow[]) byKey.set(s.step_key, s);

    // Self-heal: clear stale "Sequence guard" last_errors
    for (const s of (steps ?? []) as StepRow[]) {
      if (!s.last_error || !s.last_error.includes("Sequence guard: predecessor")) continue;
      const match = s.last_error.match(/predecessor (.+) not done/);
      if (!match) continue;
      const predKey = match[1];
      const pred = byKey.get(predKey);
      if (pred && (pred.status === "done" || pred.status === "skipped")) {
        console.log(`[runner] 🩹 Stale guard heal: clearing last_error + stale meta on ${s.step_key}`);
        const cleanedMeta = { ...(s.meta as Record<string, unknown> ?? {}) };
        for (const k of ["reason", "blocked_reason", "next_run_at", "sequence_guard"]) {
          delete cleanedMeta[k];
        }
        await safeQuery(
          sb.from("package_steps").update({
            last_error: null,
            meta: cleanedMeta,
            updated_at: new Date().toISOString(),
          }).eq("package_id", packageId).eq("step_key", s.step_key),
          "stale_sequence_guard_heal",
        );
        s.last_error = null;
        (s as any).meta = cleanedMeta;
      }
    }

    // DAG-aware integrity: A "done" step whose DAG predecessors are NOT all done/skipped
    // must be reset. This replaces the old linear check that destroyed parallel branches.
    const resetStepKeys: string[] = [];
    for (const k of STEP_ORDER) {
      const s = byKey.get(k);
      if (!s || s.status !== "done") continue;

      const deps = dagDeps.get(k) ?? [];
      const unmetDeps = deps.filter(dep => {
        const depStep = byKey.get(dep);
        if (!depStep) return true;
        // Capability-enforcement: validate_learning_content with repair_required
        // must check capability even when done
        if (dep === "validate_learning_content") {
          const meta = (depStep.meta ?? {}) as Record<string, unknown>;
          const gateClass = meta.gate_class as string | undefined;
          if (gateClass === "repair_required") {
            return !isCapabilityGranted(k, meta);
          }
          if (gateClass === "major_regeneration_required" || gateClass === "hard_fail") {
            return true; // unmet — block all downstream
          }
        }
        if (depStep.status === "done" || depStep.status === "skipped") return false;
        // Non-done validate_learning_content: check capability bypass
        if (dep === "validate_learning_content") {
          return !isCapabilityGranted(k, (depStep.meta ?? {}) as Record<string, unknown>);
        }
        return true;
      });

      if (unmetDeps.length > 0) {
        console.warn(`[runner] 🔧 DAG sequence fix: resetting ${k} to queued (unmet DAG deps: ${unmetDeps.join(", ")})`);
        await safeQuery(
          sb.from("package_steps").update({
            status: "queued", job_id: null, runner_id: null,
            started_at: null, finished_at: null,
            last_error: `Sequence guard: predecessor ${unmetDeps[0]} not done`,
          }).eq("package_id", packageId).eq("step_key", k),
          "dag_sequence_guard_reset",
        );
        s.status = "queued";
        resetStepKeys.push(k);
      }
    }

    if (resetStepKeys.length > 0) {
      for (const rk of resetStepKeys) {
        const jobType = STEP_TO_JOB_TYPE[rk as StepKey];
        if (jobType) {
          await safeRpc(sb, "cancel_jobs_for_package", {
            p_package_id: packageId,
            p_job_type: jobType,
            p_statuses: ["pending", "failed"],
            p_reason: `dag_sequence_guard: predecessor reset invalidated this job`,
          });
        }
      }
      console.log(`[runner] 🧹 DAG sequence fix: cancelled stale jobs for ${resetStepKeys.length} reset steps`);
    }
  }

  // ── FINALIZATION GUARD (Dictionary-based) ──
  {
    type FinalizationRule = {
      stepKey: string;
      jobType: string;
      actionType: string;
      cancelStatuses: string[];
      shouldFinalize: (meta: any) => { ok: boolean; reason: string; snapshot: Record<string, any> };
    };

    const FINALIZATION_RULES: FinalizationRule[] = [
      {
        stepKey: "scaffold_learning_course",
        jobType: "package_scaffold_learning_course",
        actionType: "finalize_scaffold_learning_course",
        cancelStatuses: ["pending", "failed"],
        shouldFinalize: (meta) => {
          const ok = meta?.ok === true;
          return { ok, reason: ok ? "meta.ok=true" : "meta.ok!=true", snapshot: { ok: !!ok } };
        },
      },
      {
        stepKey: "generate_exam_pool",
        jobType: "package_generate_exam_pool",
        actionType: "finalize_generate_exam_pool",
        cancelStatuses: ["pending", "failed"],
        shouldFinalize: (meta) => {
          const totalQ = typeof meta?.total_questions === "number" ? meta.total_questions : 0;
          const target = typeof meta?.exam_target === "number" ? meta.exam_target : 1700;
          const ok = totalQ >= target;
          return { ok, reason: ok ? `${totalQ}>=${target}` : `${totalQ}<${target}`, snapshot: { total_questions: totalQ, exam_target: target } };
        },
      },
      {
        stepKey: "generate_learning_content",
        jobType: "package_generate_learning_content",
        actionType: "finalize_generate_learning_content",
        cancelStatuses: ["pending", "failed"],
        shouldFinalize: (meta) => {
          const needsRegen = typeof meta?.needs_regen === "number" ? meta.needs_regen : null;
          const completionGate = meta?.completion_gate as Record<string, unknown> | undefined;
          const gateNeedsRegen = typeof completionGate?.needs_regen === "number" ? completionGate.needs_regen : null;
          const batchComplete = meta?.batch_complete === true;
          const artifactDone = needsRegen === 0 || gateNeedsRegen === 0;
          // Material completion: ≥95% generated lessons = done (needs_regen becomes rework backlog)
          const completionRatio = typeof meta?.completion_guard?.completion_ratio === "number" ? meta.completion_guard.completion_ratio : null;
          const materiallyComplete = completionRatio !== null && completionRatio >= 0.95;
          const ok = artifactDone || batchComplete || materiallyComplete;
          const reason = artifactDone
            ? `needs_regen=0 (artifact-done)`
            : materiallyComplete
              ? `material_completion: ratio=${completionRatio} >= 0.95`
              : batchComplete
                ? "meta.batch_complete=true"
                : `needs_regen=${needsRegen ?? "null"}, batch_complete=${meta?.batch_complete}, ratio=${completionRatio}`;
          return { ok, reason, snapshot: { needs_regen: needsRegen, gate_needs_regen: gateNeedsRegen, batch_complete: batchComplete, completion_ratio: completionRatio, materially_complete: materiallyComplete } };
        },
      },
      {
        stepKey: "finalize_learning_content",
        jobType: "package_finalize_learning_content",
        actionType: "finalize_finalize_learning_content",
        cancelStatuses: ["pending", "failed"],
        shouldFinalize: (meta) => {
          const ok = meta?.ok === true || meta?.finalized_at != null;
          const reason = ok ? (meta?.ok ? "meta.ok=true" : "meta.finalized_at set") : "not_ready";
          return { ok, reason, snapshot: { ok: !!meta?.ok, finalized_at: meta?.finalized_at ?? null } };
        },
      },
      {
        stepKey: "validate_learning_content",
        jobType: "package_validate_learning_content",
        actionType: "finalize_validate_learning_content",
        cancelStatuses: ["pending", "failed"],
        shouldFinalize: (meta) => {
          const ok = meta?.ok === true;
          const reason = ok ? "meta.ok=true" : (meta?.error ? `meta.error=${String(meta.error).slice(0, 80)}` : "meta.ok!=true");
          return { ok, reason, snapshot: { ok: !!ok, error: meta?.error ?? null } };
        },
      },
      {
        stepKey: "validate_exam_pool",
        jobType: "package_validate_exam_pool",
        actionType: "finalize_validate_exam_pool",
        cancelStatuses: ["pending", "failed"],
        shouldFinalize: (meta) => {
          const ok = meta?.ok === true || meta?.validation_passed === true;
          const reason = meta?.ok === true
            ? "meta.ok=true"
            : meta?.validation_passed === true
              ? "meta.validation_passed=true"
              : "meta.ok!=true";
          return { ok, reason, snapshot: { ok: !!ok, ok_flag: meta?.ok === true, validation_passed: meta?.validation_passed === true } };
        },
      },
      {
        stepKey: "auto_seed_exam_blueprints",
        jobType: "package_auto_seed_exam_blueprints",
        actionType: "finalize_auto_seed_exam_blueprints",
        cancelStatuses: ["pending", "failed"],
        shouldFinalize: (meta) => {
          const ok = meta?.ok === true;
          return { ok, reason: ok ? "meta.ok=true" : "meta.ok!=true", snapshot: { ok: !!ok } };
        },
      },
      {
        stepKey: "validate_blueprints",
        jobType: "package_validate_blueprints",
        actionType: "finalize_validate_blueprints",
        cancelStatuses: ["pending", "failed"],
        shouldFinalize: (meta) => {
          const ok = meta?.ok === true;
          return { ok, reason: ok ? "meta.ok=true" : "meta.ok!=true", snapshot: { ok: !!ok } };
        },
      },
      // ── Previously missing: Blueprint-Variant chain finalization rules ──
      {
        stepKey: "generate_blueprint_variants",
        jobType: "package_generate_blueprint_variants",
        actionType: "finalize_generate_blueprint_variants",
        cancelStatuses: ["pending", "failed"],
        shouldFinalize: (meta) => {
          const ok = meta?.ok === true || meta?.batch_complete === true;
          const reason = meta?.ok ? "meta.ok=true" : meta?.batch_complete ? "meta.batch_complete=true" : "not_ready";
          return { ok, reason, snapshot: { ok: !!meta?.ok, batch_complete: !!meta?.batch_complete } };
        },
      },
      {
        stepKey: "validate_blueprint_variants",
        jobType: "package_validate_blueprint_variants",
        actionType: "finalize_validate_blueprint_variants",
        cancelStatuses: ["pending", "failed"],
        shouldFinalize: (meta) => {
          const ok = meta?.ok === true;
          return { ok, reason: ok ? "meta.ok=true" : "meta.ok!=true", snapshot: { ok: !!ok } };
        },
      },
      {
        stepKey: "promote_blueprint_variants",
        jobType: "package_promote_blueprint_variants",
        actionType: "finalize_promote_blueprint_variants",
        cancelStatuses: ["pending", "failed"],
        shouldFinalize: (meta) => {
          const ok = meta?.ok === true;
          return { ok, reason: ok ? "meta.ok=true" : "meta.ok!=true", snapshot: { ok: !!ok } };
        },
      },
      {
        stepKey: "generate_oral_exam",
        jobType: "package_generate_oral_exam",
        actionType: "finalize_generate_oral_exam",
        cancelStatuses: ["pending", "failed"],
        shouldFinalize: (meta) => {
          const ok = meta?.ok === true;
          return { ok, reason: ok ? "meta.ok=true" : "meta.ok!=true", snapshot: { ok: !!ok } };
        },
      },
      {
        stepKey: "validate_oral_exam",
        jobType: "package_validate_oral_exam",
        actionType: "finalize_validate_oral_exam",
        cancelStatuses: ["pending", "failed"],
        shouldFinalize: (meta) => {
          const ok = meta?.ok === true;
          return { ok, reason: ok ? "meta.ok=true" : "meta.ok!=true", snapshot: { ok: !!ok } };
        },
      },
      // ── Previously missing: generate_handbook finalization rule ──
      {
        stepKey: "generate_handbook",
        jobType: "package_generate_handbook",
        actionType: "finalize_generate_handbook",
        cancelStatuses: ["pending", "failed"],
        shouldFinalize: (meta) => {
          const ok = meta?.ok === true || meta?.batch_complete === true;
          const reason = meta?.ok ? "meta.ok=true" : meta?.batch_complete ? "meta.batch_complete=true" : "not_ready";
          return { ok, reason, snapshot: { ok: !!meta?.ok, batch_complete: !!meta?.batch_complete } };
        },
      },
      {
        stepKey: "validate_handbook",
        jobType: "package_validate_handbook",
        actionType: "finalize_validate_handbook",
        cancelStatuses: ["pending", "failed"],
        shouldFinalize: (meta) => {
          const ok = meta?.ok === true;
          return { ok, reason: ok ? "meta.ok=true" : "meta.ok!=true", snapshot: { ok: !!ok } };
        },
      },
      {
        stepKey: "validate_lesson_minichecks",
        jobType: "package_validate_lesson_minichecks",
        actionType: "finalize_validate_lesson_minichecks",
        cancelStatuses: ["pending", "failed"],
        shouldFinalize: (meta) => {
          const ok = meta?.ok === true;
          return { ok, reason: ok ? "meta.ok=true" : "meta.ok!=true", snapshot: { ok: !!ok } };
        },
      },
      {
        stepKey: "validate_tutor_index",
        jobType: "package_validate_tutor_index",
        actionType: "finalize_validate_tutor_index",
        cancelStatuses: ["pending", "failed"],
        shouldFinalize: (meta) => {
          const ok = meta?.ok === true;
          return { ok, reason: ok ? "meta.ok=true" : "meta.ok!=true", snapshot: { ok: !!ok } };
        },
      },
      {
        stepKey: "validate_handbook_depth",
        jobType: "package_validate_handbook_depth",
        actionType: "finalize_validate_handbook_depth",
        cancelStatuses: ["pending", "failed"],
        shouldFinalize: (meta) => {
          // validate_handbook_depth is a soft gate — always ok=true
          const ok = meta?.ok === true || meta?.basis_pass === true;
          const reason = meta?.ok === true ? "meta.ok=true" : meta?.basis_pass === true ? "meta.basis_pass=true" : "not_ready";
          return { ok, reason, snapshot: { ok: !!meta?.ok, basis_pass: !!meta?.basis_pass, quality_tier: meta?.quality_tier } };
        },
      },
      // ── NEW: Previously missing finalization rules (were relying on 5-min zombie timeout) ──
      {
        stepKey: "generate_glossary",
        jobType: "package_generate_glossary",
        actionType: "finalize_generate_glossary",
        cancelStatuses: ["pending", "failed"],
        shouldFinalize: (meta) => {
          const ok = meta?.ok === true;
          return { ok, reason: ok ? "meta.ok=true" : "meta.ok!=true", snapshot: { ok: !!ok } };
        },
      },
      {
        stepKey: "generate_lesson_minichecks",
        jobType: "package_generate_lesson_minichecks",
        actionType: "finalize_generate_lesson_minichecks",
        cancelStatuses: ["pending", "failed"],
        shouldFinalize: (meta) => {
          const ok = meta?.ok === true || meta?.batch_complete === true;
          const reason = meta?.ok ? "meta.ok=true" : meta?.batch_complete ? "meta.batch_complete=true" : "not_ready";
          return { ok, reason, snapshot: { ok: !!meta?.ok, batch_complete: !!meta?.batch_complete } };
        },
      },
      {
        stepKey: "elite_harden",
        jobType: "package_elite_harden",
        actionType: "finalize_elite_harden",
        cancelStatuses: ["pending", "failed"],
        shouldFinalize: (meta) => {
          const ok = meta?.ok === true;
          return { ok, reason: ok ? "meta.ok=true" : "meta.ok!=true", snapshot: { ok: !!ok } };
        },
      },
      {
        stepKey: "build_ai_tutor_index",
        jobType: "package_build_ai_tutor_index",
        actionType: "finalize_build_ai_tutor_index",
        cancelStatuses: ["pending", "failed"],
        shouldFinalize: (meta) => {
          const ok = meta?.ok === true;
          return { ok, reason: ok ? "meta.ok=true" : "meta.ok!=true", snapshot: { ok: !!ok } };
        },
      },
      {
        stepKey: "run_integrity_check",
        jobType: "package_run_integrity_check",
        actionType: "finalize_run_integrity_check",
        cancelStatuses: ["pending", "failed"],
        shouldFinalize: (meta) => {
          const ok = meta?.ok === true || meta?.integrity_passed === true;
          const reason = meta?.ok ? "meta.ok=true" : meta?.integrity_passed ? "meta.integrity_passed=true" : "not_ready";
          return { ok, reason, snapshot: { ok: !!meta?.ok, integrity_passed: !!meta?.integrity_passed } };
        },
      },
      {
        stepKey: "quality_council",
        jobType: "package_quality_council",
        actionType: "finalize_quality_council",
        cancelStatuses: ["pending", "failed"],
        shouldFinalize: (meta) => {
          const ok = meta?.ok === true || meta?.approved === true;
          const reason = meta?.ok ? "meta.ok=true" : meta?.approved ? "meta.approved=true" : "not_ready";
          return { ok, reason, snapshot: { ok: !!meta?.ok, approved: !!meta?.approved } };
        },
      },
      {
        stepKey: "auto_publish",
        jobType: "package_auto_publish",
        actionType: "finalize_auto_publish",
        cancelStatuses: ["pending", "failed"],
        shouldFinalize: (meta) => {
          const ok = meta?.ok === true || meta?.published === true;
          const reason = meta?.ok ? "meta.ok=true" : meta?.published ? "meta.published=true" : "not_ready";
          return { ok, reason, snapshot: { ok: !!meta?.ok, published: !!meta?.published } };
        },
      },
      {
        stepKey: "enqueue_handbook_expand",
        jobType: "package_enqueue_handbook_expand",
        actionType: "finalize_enqueue_handbook_expand",
        cancelStatuses: ["pending", "failed"],
        shouldFinalize: (meta) => {
          const ok = meta?.ok === true || meta?.enqueued === true;
          const reason = meta?.ok ? "meta.ok=true" : meta?.enqueued ? "meta.enqueued=true" : "not_ready";
          return { ok, reason, snapshot: { ok: !!meta?.ok, enqueued: !!meta?.enqueued } };
        },
      },
      {
        stepKey: "expand_handbook",
        jobType: "handbook_expand_section",
        actionType: "finalize_expand_handbook",
        cancelStatuses: ["pending", "failed"],
        shouldFinalize: (meta) => {
          const ok = meta?.ok === true || meta?.batch_complete === true;
          const reason = meta?.ok ? "meta.ok=true" : meta?.batch_complete ? "meta.batch_complete=true" : "not_ready";
          return { ok, reason, snapshot: { ok: !!meta?.ok, batch_complete: !!meta?.batch_complete } };
        },
      },
      // ── Defense-in-depth: self-finalizing steps that also need fallback rules ──
      {
        stepKey: "fanout_learning_content",
        jobType: "package_fanout_learning_content",
        actionType: "finalize_fanout_learning_content",
        cancelStatuses: ["pending", "failed"],
        shouldFinalize: (meta) => {
          const ok = meta?.ok === true || meta?.finalized_at != null;
          const reason = meta?.ok ? "meta.ok=true" : meta?.finalized_at ? "meta.finalized_at set" : "not_ready";
          return { ok, reason, snapshot: { ok: !!meta?.ok, finalized_at: meta?.finalized_at ?? null } };
        },
      },
      {
        stepKey: "repair_exam_pool_quality",
        jobType: "package_repair_exam_pool_quality",
        actionType: "finalize_repair_exam_pool_quality",
        cancelStatuses: ["pending", "failed"],
        shouldFinalize: (meta) => {
          const ok = meta?.ok === true || meta?.repair_complete === true;
          const reason = meta?.ok ? "meta.ok=true" : meta?.repair_complete ? "meta.repair_complete=true" : "not_ready";
          return { ok, reason, snapshot: { ok: !!meta?.ok, repair_complete: !!meta?.repair_complete } };
        },
      },
    ];

    const byKey = new Map<string, StepRow>();
    for (const s of (steps ?? []) as StepRow[]) byKey.set(s.step_key, s);

    for (const rule of FINALIZATION_RULES) {
      const step = byKey.get(rule.stepKey);
      if (!step) continue;
      if (!["queued", "running", "enqueued"].includes(step.status)) continue;

      const { data: latestCompletedJob } = await sb
        .from("job_queue")
        .select("id, result, completed_at")
        .eq("package_id", packageId)
        .eq("job_type", rule.jobType)
        .eq("status", "completed")
        .order("completed_at", { ascending: false })
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      // ── DEADLOCK PREVENTION GUARD (v3): a completed job is enough to re-open finalization ──
      // Some recovery paths null out step.job_id / started_at before the package runner polls the
      // completion. In that case the latest completed job becomes the SSOT for finalization.
      const DISPATCHER_DRIVEN_STEPS = new Set(["generate_learning_content"]);
      if (!step.started_at && !DISPATCHER_DRIVEN_STEPS.has(rule.stepKey)) {
        if (!latestCompletedJob?.id) {
          continue; // Truly never started — skip finalization
        }

        const healedStartedAt = latestCompletedJob.completed_at ?? new Date().toISOString();
        console.warn(`[runner] 🩹 DEADLOCK GUARD: ${shortId}/${rule.stepKey} has completed job ${String(latestCompletedJob.id).slice(0, 8)} but started_at=null — healing`);
        await safeQuery(
          sb.from("package_steps").update({
            started_at: healedStartedAt,
          }).eq("package_id", packageId).eq("step_key", rule.stepKey),
          "deadlock_guard_heal_started_at",
        );
        step.started_at = healedStartedAt;
      }

      const stepMeta = (step.meta ?? {}) as Record<string, unknown>;
      const completedResult = latestCompletedJob?.result && typeof latestCompletedJob.result === "object" && !Array.isArray(latestCompletedJob.result)
        ? latestCompletedJob.result as Record<string, unknown>
        : {};
      const finalizationMeta = {
        ...stepMeta,
        ...completedResult,
        ...(latestCompletedJob?.id ? {
          completion_job_id: latestCompletedJob.id,
          completion_job_completed_at: latestCompletedJob.completed_at,
        } : {}),
      };

      const cond = rule.shouldFinalize(finalizationMeta);
      if (!cond.ok) continue;

      const { data: activeCnt, error: activeErr } = await safeRpc(sb, "count_active_jobs", {
        p_package_id: packageId,
        p_job_type: rule.jobType,
      });
      if (activeErr) {
        console.log(`[runner] FINALIZE_SKIP ${shortId}/${rule.stepKey}: rpc_error=${(activeErr as any).message}`);
        continue;
      }
      if ((activeCnt ?? 1) !== 0) {
        console.log(`[runner] FINALIZE_WAIT ${shortId}/${rule.stepKey}: ${activeCnt} active jobs remaining`);
        continue;
      }

      if (!["queued", "running", "enqueued"].includes(step.status)) continue;

      let applied = false;
      try {
        await markStepDone(sb, {
          packageId,
          stepKey: rule.stepKey,
          meta: {
            ...finalizationMeta,
            finalized_by: "pipeline-runner",
            finalization_reason: cond.reason,
            finalization_snapshot: cond.snapshot,
            finalization_source: latestCompletedJob?.id ? "latest_completed_job" : "step_meta",
          },
        });
        await safeQuery(
          sb.from("package_steps").update({ last_error: null }).eq("package_id", packageId).eq("step_key", rule.stepKey),
          "clear_last_error_after_finalize",
        );
        applied = true;
      } catch (postCondErr: unknown) {
        const msg = postCondErr instanceof Error ? postCondErr.message : String(postCondErr);
        console.warn(`[runner] ⛔ markStepDone BLOCKED finalization of ${rule.stepKey} for ${shortId}: ${msg}`);
        await safeQuery(sb.from("auto_heal_log").insert({
          action_type: rule.actionType,
          trigger_source: "pipeline-runner",
          target_type: "course_package",
          target_id: packageId,
          result_status: "blocked",
          result_detail: `Post-condition blocked finalization: ${msg.slice(0, 500)}`,
          metadata: { step_key: rule.stepKey, error: msg.slice(0, 300) },
        }), "finalization_blocked_log");
        continue;
      }

      if (applied) {
        await safeRpc(sb, "cancel_jobs_for_package", {
          p_package_id: packageId,
          p_job_type: rule.jobType,
          p_statuses: rule.cancelStatuses,
        });
        console.log(`[runner] 🏁 Finalized ${rule.stepKey} for ${shortId}: ${cond.reason}, 0 active jobs`);
        await safeQuery(sb.from("auto_heal_log").insert({
          action_type: rule.actionType,
          trigger_source: "pipeline-runner",
          target_type: "course_package",
          target_id: packageId,
          result_status: "applied",
          result_detail: `Finalized ${rule.stepKey}: ${cond.reason}`,
          metadata: { step_key: rule.stepKey, job_type: rule.jobType, condition: cond.snapshot, active_jobs: 0 },
        }), "finalization_log");
        step.status = "done";
      }
    }
  }

  // ── ZOMBIE STEP AUTO-FINALIZATION (DAG-aware) ──
  {
    const ZOMBIE_MIN_AGE_MS = 3 * 60 * 1000;
    const ZOMBIFIABLE_STEPS = new Set([
      "validate_learning_content", "validate_exam_pool", "validate_blueprints",
      "validate_oral_exam", "validate_handbook", "validate_lesson_minichecks",
      "validate_tutor_index", "validate_handbook_depth",
      "run_integrity_check", "quality_council",
      "auto_publish", "enqueue_handbook_expand",
    ]);
    // Build DAG dependency lookup for zombie check
    const dagDepsZombie = new Map<string, string[]>();
    for (const node of PIPELINE_GRAPH) {
      dagDepsZombie.set(node.key, node.dependsOn ?? []);
    }
    const byKey = new Map<string, StepRow>();
    for (const s of (steps ?? []) as StepRow[]) byKey.set(s.step_key, s);

    function isTerminalStatus(st: string) { return st === "done" || st === "skipped"; }

    for (const k of STEP_ORDER) {
      const s = byKey.get(k);
      if (!s || !["running", "enqueued"].includes(s.status)) continue;
      if (!ZOMBIFIABLE_STEPS.has(k)) continue;
      const meta = (s.meta ?? {}) as Record<string, unknown>;

      const hasOkField = meta.ok !== undefined && meta.ok !== null;
      if (!hasOkField) continue;
      if (meta.ok !== true) continue;

      const startedAt = s.started_at ? new Date(s.started_at).getTime() : 0;
      if (!startedAt || startedAt <= 0) continue;

      const age = Date.now() - startedAt;
      if (age <= ZOMBIE_MIN_AGE_MS) continue;

      // DAG-aware predecessor check: ALL DAG predecessors must be done/skipped
      const deps = dagDepsZombie.get(k) ?? [];
      const unmetDeps = deps.filter(dep => {
        const depStep = byKey.get(dep);
        if (!depStep) return true;
        // Capability-enforcement for zombie check
        if (dep === "validate_learning_content" && depStep) {
          const meta = (depStep.meta ?? {}) as Record<string, unknown>;
          const gateClass = meta.gate_class as string | undefined;
          if (gateClass === "repair_required") {
            return !isCapabilityGranted(k, meta);
          }
          if (gateClass === "major_regeneration_required" || gateClass === "hard_fail") {
            return true;
          }
        }
        if (!isTerminalStatus(depStep.status)) {
          if (dep === "validate_learning_content" && depStep) {
            return !isCapabilityGranted(k, (depStep.meta ?? {}) as Record<string, unknown>);
          }
          return true;
        }
        return false;
      });
      if (unmetDeps.length > 0) {
        console.warn(`[runner] 🧟 ZOMBIE blocked: step ${k} DAG predecessors not done: ${unmetDeps.join(", ")}`);
        continue;
      }

      console.warn(`[runner] 🧟 ZOMBIE auto-fix: step ${k} for ${shortId} — forcing to done`);

      try {
        await markStepDone(sb, {
          packageId,
          stepKey: k,
          meta: { finalized_by: "zombie-auto-fix", age_minutes: Math.round(age / 60000) },
        });
        await safeQuery(
          sb.from("package_steps").update({ last_error: null }).eq("package_id", packageId).eq("step_key", k),
          "zombie_clear_error",
        );
      } catch (postCondErr: unknown) {
        const msg = postCondErr instanceof Error ? postCondErr.message : String(postCondErr);
        console.warn(`[runner] ⛔ ZOMBIE markStepDone BLOCKED for ${k}: ${msg}`);
        await safeQuery(
          sb.from("package_steps").update({
            status: "queued", started_at: null, finished_at: null,
            last_error: `ZOMBIE post-condition failed: ${msg.slice(0, 500)}`,
          }).eq("package_id", packageId).eq("step_key", k),
          "zombie_post_condition_reset",
        );
        continue;
      }

      const jobType = STEP_TO_JOB_TYPE[k as StepKey];
      if (jobType) {
        await safeRpc(sb, "cancel_jobs_for_package", {
          p_package_id: packageId,
          p_job_type: jobType,
          p_statuses: ["pending", "failed"],
          p_reason: `pipeline-runner zombie finalize: cleanup for step ${k}`,
        });
        await safeRpc(sb, "cancel_stale_processing_jobs_for_package", {
          p_package_id: packageId,
          p_job_type: jobType,
          p_stale_minutes: 15,
          p_reason: `pipeline-runner zombie finalize: cleanup stale processing for step ${k}`,
        });
      }

      await safeQuery(sb.from("auto_heal_log").insert({
        action_type: "zombie_step_auto_finalize",
        trigger_source: "pipeline-runner",
        target_type: "package_step",
        target_id: packageId,
        result_status: "applied",
        result_detail: `Step ${k} was running with meta.ok=true for ${Math.round(age / 60000)}min — forced to done`,
        metadata: { step_key: k, meta, age_min: Math.round(age / 60000) },
      }), "zombie_log");

      s.status = "done";
    }
  }

  // ── ESCALATION LOOP BREAKER ──
  {
    const ESCALATION_MAX = 10;
    const byKey = new Map<string, StepRow>();
    for (const s of (steps ?? []) as StepRow[]) byKey.set(s.step_key, s);
    for (const k of STEP_ORDER) {
      const s = byKey.get(k);
      if (!s) continue;
      if (s.status === "done" || s.status === "skipped" || s.status === "blocked") continue;
      if (s.attempts < ESCALATION_MAX) continue;

      const updatedAt = s.updated_at ? new Date(s.updated_at).getTime() : 0;
      const ageMs = updatedAt > 0 ? (Date.now() - updatedAt) : Infinity;
      if (ageMs < 10 * 60 * 1000) continue;

      const lastErr = String(s.last_error || "");
      const metaErr = String(((s.meta ?? {}) as Record<string, unknown>)?.error || "");
      if (!lastErr && !metaErr) continue;

      const isValidation = k.startsWith("validate_");
      const jobType = STEP_TO_JOB_TYPE[k as StepKey];

      if (isValidation) {
        console.error(`[runner] 🛑 ESCALATION BREAKER: validation step ${k} for ${shortId} has ${s.attempts} attempts — forcing skip`);
        await safeQuery(
          sb.from("package_steps").update({
            status: "skipped",
            last_error: `Escalation breaker: ${s.attempts} attempts exceeded max ${ESCALATION_MAX}`,
            finished_at: new Date().toISOString(),
          }).eq("package_id", packageId).eq("step_key", k),
          "escalation_breaker_skip",
        );
        if (jobType) {
          await safeRpc(sb, "cancel_jobs_for_package", {
            p_package_id: packageId, p_job_type: jobType, p_statuses: ["pending", "failed"],
            p_reason: `escalation breaker: skip ${k}`,
          });
        }
        await safeQuery(sb.from("auto_heal_log").insert({
          action_type: "escalation_loop_breaker",
          trigger_source: "pipeline-runner",
          target_type: "package_step",
          target_id: packageId,
          result_status: "escalated",
          result_detail: `Validation step ${k} skipped after ${s.attempts} attempts`,
          metadata: { step_key: k, attempts: s.attempts, type: "validation_skip" },
        }), "escalation_log");
        await safeQuery(sb.from("admin_notifications").insert({
          title: `Pipeline-Eskalation: ${k}`,
          body: `Validierungsstep ${k} für Paket ${shortId} wurde nach ${s.attempts} Versuchen übersprungen.`,
          category: "ops", severity: "warning",
          entity_type: "course_package", entity_id: packageId,
          metadata: { step_key: k, attempts: s.attempts },
        }), "escalation_notify");
        s.status = "skipped";
      } else {
        console.error(`[runner] 🛑 ESCALATION: critical step ${k} for ${shortId} has ${s.attempts} attempts — flagging`);
        await safeQuery(
          sb.from("course_packages").update({
            stuck_reason: `Escalation loop: step ${k} has ${s.attempts} attempts — manual review required`,
          }).eq("id", packageId),
          "escalation_flag_package",
        );
        if (jobType) {
          await safeRpc(sb, "cancel_jobs_for_package", {
            p_package_id: packageId, p_job_type: jobType, p_statuses: ["pending", "failed"],
            p_reason: `escalation breaker: halt ${k}`,
          });
        }
        await safeQuery(sb.from("auto_heal_log").insert({
          action_type: "escalation_loop_breaker",
          trigger_source: "pipeline-runner",
          target_type: "package_step",
          target_id: packageId,
          result_status: "escalated",
          result_detail: `Critical step ${k} flagged for manual review after ${s.attempts} attempts`,
          metadata: { step_key: k, attempts: s.attempts, type: "manual_review" },
        }), "escalation_log");
        await safeQuery(sb.from("admin_notifications").insert({
          title: `🚨 Pipeline-Eskalation: ${k}`,
          body: `Kritischer Step ${k} für Paket ${shortId} hängt nach ${s.attempts} Versuchen. Manuelle Prüfung ERFORDERLICH.`,
          category: "ops", severity: "error",
          entity_type: "course_package", entity_id: packageId,
          metadata: { step_key: k, attempts: s.attempts },
        }), "escalation_notify_critical");
        break;
      }
    }
  }

  // ═══════════════════════════════════════════════════════
  // PARALLEL BRANCH SCHEDULING (DAG-aware)
  // ═══════════════════════════════════════════════════════
  const parallelActions = pickParallelActions((steps ?? []) as StepRow[], STEP_ORDER);
  const nextAction = parallelActions.length > 0 ? parallelActions[0] : pickNextAction((steps ?? []) as StepRow[], STEP_ORDER);

  // Fire ALL parallel enqueue actions that won't be handled by the main flow.
  // BUG FIX: Previously started at i=1, assuming parallelActions[0] === first enqueue.
  // When parallelActions[0] is a "poll" (active job on another branch), enqueue actions
  // for independent branches (minichecks, handbook) were silently dropped.
  if (parallelActions.length > 0) {
    const enqueueActions = parallelActions.filter(a => a?.action === "enqueue");
    // The main flow below handles nextAction. Skip that one if it's an enqueue.
    const mainIsEnqueue = nextAction?.action === "enqueue";
    const startIdx = mainIsEnqueue ? 1 : 0;
    if (enqueueActions.length > startIdx) {
      console.log(`[runner] 🔀 Parallel branches detected: ${enqueueActions.map(a => (a as any).stepKey).join(", ")} (main=${nextAction?.action}:${(nextAction as any)?.stepKey})`);
      for (let i = startIdx; i < enqueueActions.length; i++) {
        const pa = enqueueActions[i] as { action: "enqueue"; stepKey: StepKey };
        try {
          await handleEnqueue(sb, packageId, runnerId, shortId, pa, steps as StepRow[], STEP_ORDER, pkg, mode, stepClassCtx);
          console.log(`[runner] 🔀 Parallel-enqueued: ${pa.stepKey}`);
        } catch (e) {
          console.warn(`[runner] Parallel enqueue failed for ${pa.stepKey}: ${(e as Error).message}`);
        }
      }
    }
  }

  // ── Handle: step in backoff — idle without blocking/erroring ──
  if (nextAction?.action === "wait") {
    // Check if any parallel action is NOT a wait (other branches can proceed)
    const nonWaitAction = parallelActions.find(a => a?.action !== "wait");
    if (nonWaitAction) {
      console.log(`[runner] ⏳ Step ${nextAction.stepKey} in backoff, but parallel branch ${(nonWaitAction as any).stepKey} available`);
      // Fall through to handle the non-wait action below by reassigning
      // (handled by parallelActions[0] logic above)
    } else {
      console.log(`[runner] ⏳ Step ${nextAction.stepKey} in backoff for ${shortId} — waiting (strict sequencing)`);
      await safeRpc(sb, "release_package_lease", { p_package_id: packageId, p_runner_id: runnerId });
      return { packageId, waiting: true, stepKey: nextAction.stepKey, reason: "backoff" };
    }
  }

  // ── All steps done / no actionable step ──
  if (!nextAction) {
    const statuses = (steps ?? []).map((s: StepRow) => s.status);
    const allDone = statuses.length > 0 && statuses.every((s: string) => s === "done" || s === "skipped");

    if (allDone) {
      const executedSteps = (steps ?? []).filter((s: StepRow) => s.started_at !== null);
      if (executedSteps.length === 0) {
        console.error(`[runner] 🚨 GHOST COMPLETION BLOCKED for ${shortId}`);
        await safeQuery(sb.from("course_packages").update({ 
          status: "quality_gate_failed", 
          blocked_reason: "GHOST_COMPLETION: All steps done but none were ever executed" 
        }).eq("id", packageId));
        await safeQuery(sb.from("admin_notifications").insert({
          title: `🚨 Ghost Completion blockiert: ${shortId}`,
          body: `Alle ${statuses.length} Steps als "done" markiert aber keiner wurde je gestartet.`,
          category: "ops", severity: "error",
          entity_type: "course_package", entity_id: packageId,
        }));
        await safeRpc(sb, "release_package_lease", { p_package_id: packageId, p_runner_id: runnerId });
        return { packageId, ghost_completion_blocked: true, steps: statuses.length };
      }

      const { data: pkgIntegrity } = await safeQuery(
        sb.from("course_packages").select("integrity_passed").eq("id", packageId).maybeSingle()
      ) as any;
      const integrityPassed = pkgIntegrity?.integrity_passed === true;

      if (integrityPassed) {
        await safeQuery(sb.from("course_packages").update({ status: "done" }).eq("id", packageId));
        console.log(`[runner] Package ${shortId} → done (integrity_passed=true)`);
      } else {
        await safeQuery(sb.from("course_packages").update({ 
          status: "quality_gate_failed",
          blocked_reason: "ALL_STEPS_DONE_BUT_INTEGRITY_FAILED",
        }).eq("id", packageId));
        console.log(`[runner] Package ${shortId} → quality_gate_failed`);
      }

      try {
        const backfilled = await backfillPipelinePool(sb);
        if (backfilled > 0) {
          console.log(`[runner] 🏭 Backfilled ${backfilled} package(s)`);
        }
      } catch (e) {
        console.warn(`[runner] Backfill failed: ${(e as Error)?.message}`);
      }
    } else {
      const hasEnqueued = statuses.includes("enqueued");
      if (!hasEnqueued) {
        await safeQuery(
          sb.from("course_packages")
            .update({ status: "blocked", blocked_reason: "no_runnable_steps" })
            .eq("id", packageId),
        );
      }
    }

    await safeRpc(sb, "release_package_lease", { p_package_id: packageId, p_runner_id: runnerId });
    return { packageId, finished: statuses.every((s: string) => s === "done" || s === "skipped") };
  }

  // ── Handle: exhausted retries ──
  if (nextAction.action === "exhausted") {
    const stepKey = nextAction.stepKey;
    const currentStep = steps.find((s: any) => s.step_key === stepKey);
    const stepMeta = (currentStep?.meta ?? {}) as Record<string, any>;

    if (stepKey === "generate_learning_content") {
      const { data: recoveryResult } = await sb.rpc("auto_recover_exhausted_content_step", {
        p_package_id: packageId,
      });
      const recovery = recoveryResult as { recovered: boolean; real?: number; total?: number } | null;
      if (recovery?.recovered) {
        console.log(`[runner] ♻️ Auto-recovered exhausted generate_learning_content for ${shortId}`);
        await safeRpc(sb, "release_package_lease", { p_package_id: packageId, p_runner_id: runnerId });
        return { packageId, stepKey, auto_recovered: true, real: recovery.real, total: recovery.total };
      }

      const { data: realness } = await sb.rpc("package_lessons_realness", { p_package_id: packageId });
      const fpReal = Number(realness?.real_content ?? 0);
      const fpPh = Number(realness?.placeholders ?? 0);
      const fpAvg = Number(realness?.avg_len ?? 0);
      const fpTotal = Number(realness?.lessons_total ?? 0);
      const prevFpReal = Number(stepMeta.fp_real ?? 0);

      if (fpReal > prevFpReal) {
        console.log(`[runner] ♻️ STEP_EXHAUSTED but progress detected (${prevFpReal}→${fpReal})`);
        await safeQuery(
          sb.from("package_steps").update({
            status: "queued",
            started_at: null, finished_at: null,
            attempts: 0,
            meta: {
              ...stepMeta,
              attempts: 0,
              fp_real: fpReal, fp_placeholders: fpPh, fp_avg_len: fpAvg,
              progress_reset: true,
              progress_reset_at: new Date().toISOString(),
              last_progress_note: `Progress reset: ${prevFpReal}→${fpReal}/${fpTotal} real`,
              next_run_at: new Date(Date.now() + 30_000).toISOString(),
              backoff_seconds: 30,
            },
            last_error: null,
          }).eq("package_id", packageId).eq("step_key", stepKey),
          "progress_reset_exhausted",
        );
        await safeRpc(sb, "release_package_lease", { p_package_id: packageId, p_runner_id: runnerId });
        return { packageId, stepKey, progress_reset: true, fpReal, fpTotal };
      }

      const escalationBackoff = 6 * 3600;
      console.warn(`[runner] ⚠️ STEP_EXHAUSTED + no progress for ${shortId} — escalating (6h backoff)`);
      await safeQuery(
        sb.from("package_steps").update({
          status: "queued",
          started_at: null, finished_at: null,
          attempts: 0,
          meta: {
            ...stepMeta,
            fp_real: fpReal, fp_placeholders: fpPh, fp_avg_len: fpAvg,
            escalation_backoff: true,
            escalation_at: new Date().toISOString(),
            next_run_at: new Date(Date.now() + escalationBackoff * 1000).toISOString(),
            backoff_seconds: escalationBackoff,
            last_progress_note: `Escalation: no progress (${fpReal}/${fpTotal} real) — 6h backoff`,
          },
          last_error: `Escalation: no progress after max attempts — next retry in 6h`,
        }).eq("package_id", packageId).eq("step_key", stepKey),
        "escalation_backoff_reset",
      );
      await safeQuery(sb.from("admin_notifications").insert({
        title: `⚠️ Content stagniert: ${shortId}`,
        body: `generate_learning_content für Paket ${shortId}: ${fpReal}/${fpTotal} echte Lektionen, kein Fortschritt. 6h Backoff aktiv.`,
        category: "ops", severity: "warning",
        entity_type: "course_package", entity_id: packageId,
        metadata: { fp_real: fpReal, fp_total: fpTotal, fp_placeholders: fpPh },
      }), "escalation_notify");
      await safeRpc(sb, "release_package_lease", { p_package_id: packageId, p_runner_id: runnerId });
      return { packageId, stepKey, escalation_backoff: true, fpReal, fpTotal };
    }

    console.error(`[runner] STEP_EXHAUSTED: ${stepKey} for ${shortId}`);
    await safeRpc(sb, "step_fail", {
      p_package_id: packageId,
      p_step_key: stepKey,
      p_error: `Exhausted after ${currentStep?.max_attempts ?? '?'} attempts`,
    });
    await safeQuery(
      sb.from("course_packages")
        .update({ status: "quality_gate_failed", last_error: `Step ${stepKey}: exhausted` })
        .eq("id", packageId),
    );
    await safeQuery(
      sb.from("auto_heal_log").insert({
        action_type: "step_exhausted",
        trigger_source: "pipeline_runner",
        target_type: "package_step",
        target_id: packageId,
        result_status: "error",
        result_detail: `Step ${stepKey}: exhausted ${currentStep?.attempts}/${currentStep?.max_attempts} attempts`,
        metadata: { step: stepKey, attempts: currentStep?.attempts, meta: stepMeta },
        error_message: stepMeta.last_fail_reason ?? stepMeta.error ?? null,
      }),
    );
    await safeQuery(
      sb.from("admin_notifications").insert({
        category: "ops",
        severity: "error",
        title: `Step exhausted: ${stepKey}`,
        body: `Paket ${shortId}: ${stepKey} failed after ${currentStep?.attempts} attempts`,
        entity_type: "course_package",
        entity_id: packageId,
        metadata: { packageId, stepKey, attempts: currentStep?.attempts },
      }),
    );
    await safeRpc(sb, "release_package_lease", { p_package_id: packageId, p_runner_id: runnerId });
    return { packageId, stepKey, exhausted: true };
  }

  // ── Handle: step timed out ──
  if (nextAction.action === "timed_out") {
    console.warn(`[runner] Step ${nextAction.stepKey} timed out for ${shortId}`);
    await safeRpc(sb, "step_fail", {
      p_package_id: packageId,
      p_step_key: nextAction.stepKey,
      p_error: "STEP_TIMEOUT",
    });
    await safeQuery(
      sb.from("course_packages")
        .update({ status: "building", last_error: `Step ${nextAction.stepKey}: TIMEOUT` })
        .eq("id", packageId),
    );
    await safeRpc(sb, "release_package_lease", { p_package_id: packageId, p_runner_id: runnerId });
    return { packageId, stepKey: nextAction.stepKey, timeout_reset: true };
  }

  // ── POLL: Check status of an enqueued worker job ──
  if (nextAction.action === "poll") {
    return await handlePoll(sb, packageId, runnerId, shortId, nextAction, steps as StepRow[], STEP_ORDER, mode);
  }

  // ── ENQUEUE: Create a worker job ──
  if (nextAction.action === "enqueue") {
    return await handleEnqueue(sb, packageId, runnerId, shortId, nextAction, steps as StepRow[], STEP_ORDER, pkg, mode, stepClassCtx);
  }

  // Fallback
  await safeRpc(sb, "release_package_lease", { p_package_id: packageId, p_runner_id: runnerId });
  return { packageId, noop: true };
}

// ══════════════════════════════════════════════════════════════
// POLL handler — extracted for readability
// ══════════════════════════════════════════════════════════════

async function handlePoll(
  sb: ReturnType<typeof createClient>,
  packageId: string,
  runnerId: string,
  shortId: string,
  nextAction: { action: "poll"; stepKey: StepKey; jobId: string },
  steps: StepRow[],
  STEP_ORDER: StepKey[],
  mode: string,
): Promise<Record<string, unknown>> {
  const { stepKey, jobId } = nextAction;
  console.log(`[runner] Polling job ${jobId.slice(0, 8)} for step ${stepKey} (pkg ${shortId})`);

  const { data: job } = await sb
    .from("job_queue")
    .select("status,result,error,last_error,batch_cursor,updated_at,locked_at,last_heartbeat_at")
    .eq("id", jobId)
    .single();

  if (!job) {
    console.warn(`[runner] Job ${jobId.slice(0, 8)} not found — resetting step`);
    await safeQuery(
      sb.from("package_steps")
        .update({ status: "queued", job_id: null, runner_id: null })
        .eq("package_id", packageId)
        .eq("step_key", stepKey),
    );
    await safeRpc(sb, "release_package_lease", { p_package_id: packageId, p_runner_id: runnerId });
    return { packageId, stepKey, job_reset: true };
  }

  // Job still pending
  if (job.status === "pending") {
    const currentStep = steps.find((s: StepRow) => s.step_key === stepKey);
    const jobAge = job.updated_at ? Date.now() - new Date(job.updated_at as string).getTime() : 0;
    const PENDING_STALE_MS = 10 * 60 * 1000;

    if (currentStep?.status === "running" && jobAge > PENDING_STALE_MS) {
      console.warn(`[runner] ⚠️ Deadlock: step ${stepKey} running but job pending for ${Math.round(jobAge / 60000)}min`);
      await safeQuery(
        sb.from("package_steps").update({
          status: "queued", job_id: null, runner_id: null, started_at: null,
          last_error: `Deadlock reset: job pending ${Math.round(jobAge / 60000)}min`,
        }).eq("package_id", packageId).eq("step_key", stepKey),
        "reset_deadlocked_step",
      );
      await safeRpc(sb, "release_package_lease", { p_package_id: packageId, p_runner_id: runnerId });
      return { packageId, stepKey, deadlock_reset: true, jobAge: Math.round(jobAge / 60000) };
    }

    await safeRpc(sb, "renew_package_lease", { p_package_id: packageId, p_runner_id: runnerId, p_lease_seconds: 120 });
    await safeRpc(sb, "step_heartbeat", { p_package_id: packageId, p_step_key: stepKey });
    return { packageId, stepKey, waiting: true, jobStatus: "pending" };
  }

  // Job processing — enhanced with liveness guard
  if (job.status === "processing") {
    const currentStep = steps.find((s: StepRow) => s.step_key === stepKey);
    // Use last_heartbeat_at as primary liveness signal
    const heartbeatRef = job.last_heartbeat_at || job.updated_at || job.locked_at;
    const jobAge = heartbeatRef ? Date.now() - new Date(heartbeatRef as string).getTime() : 0;

    const ZOMBIE_THRESHOLD_MS = 5 * 60 * 1000;
    const STUCK_THRESHOLD_MS = 10 * 60 * 1000; // tightened from 30m to 10m with heartbeat
    const isZombie = !job.locked_at && jobAge > ZOMBIE_THRESHOLD_MS;
    const isStaleHeartbeat = jobAge > STUCK_THRESHOLD_MS;

    if (isZombie || isStaleHeartbeat) {
      const reason = isZombie
        ? `Zombie job: processing with no lock for ${Math.round(jobAge / 60000)}min`
        : `Liveness guard: no heartbeat for ${Math.round(jobAge / 60000)}min`;
      console.warn(`[runner] ⚠️ Job ${jobId.slice(0, 8)} ${reason}`);

      // Use kill_stale_processing_jobs_v2 for the specific package
      await safeRpc(sb, "kill_stale_processing_jobs_v2", {
        p_package_id: packageId,
        p_heartbeat_timeout_seconds: Math.round(STUCK_THRESHOLD_MS / 1000),
        p_reason: `pipeline-process: ${reason}`,
        p_requeue: true,
      });

      // Release lease if no alive work remains
      await safeRpc(sb, "release_stale_package_lease_v2", {
        p_package_id: packageId,
        p_reason: `pipeline-process: liveness guard triggered for ${stepKey}`,
      });

      const zombieMeta = (currentStep?.meta ?? {}) as Record<string, any>;
      const zombieBackoffRunAt = new Date(Date.now() + 60_000).toISOString();
      await safeQuery(
        sb.from("package_steps").update({
          status: "queued", job_id: null, runner_id: null, started_at: null,
          last_error: `${reason} [liveness guard — requeued]`,
          meta: {
            ...zombieMeta,
            last_error_kind: "transient",
            last_error_code: "JOB_LIVENESS_GUARD",
            next_run_at: zombieBackoffRunAt,
            liveness_intervened: true,
            liveness_last_run_at: new Date().toISOString(),
          },
        }).eq("package_id", packageId).eq("step_key", stepKey),
        "liveness_guard_reset_step",
      );

      await safeRpc(sb, "release_package_lease", { p_package_id: packageId, p_runner_id: runnerId });
      return { packageId, stepKey, stuck_reset: true, zombie: isZombie, liveness_guard: true };
    }

    if (currentStep?.status !== "running") {
      await safeRpc(sb, "step_start", { p_package_id: packageId, p_step_key: stepKey, p_runner_id: runnerId });
    } else {
      await safeRpc(sb, "step_heartbeat", { p_package_id: packageId, p_step_key: stepKey });
    }
    await safeRpc(sb, "renew_package_lease", { p_package_id: packageId, p_runner_id: runnerId, p_lease_seconds: 120 });
    return { packageId, stepKey, waiting: true, jobStatus: "processing" };
  }

  // Job completed
  if (job.status === "completed") {
    return await handleJobCompleted(sb, packageId, runnerId, shortId, stepKey, job, steps, STEP_ORDER, mode);
  }

  // Job failed
  if (job.status === "failed") {
    return await handleJobFailed(sb, packageId, runnerId, shortId, stepKey, jobId, job, steps);
  }

  // Unknown job status
  await safeRpc(sb, "release_package_lease", { p_package_id: packageId, p_runner_id: runnerId });
  return { packageId, stepKey, jobStatus: job.status };
}

// ══════════════════════════════════════════════════════════════
// Handle job completed
// ══════════════════════════════════════════════════════════════

async function handleJobCompleted(
  sb: ReturnType<typeof createClient>,
  packageId: string,
  runnerId: string,
  shortId: string,
  stepKey: StepKey,
  job: any,
  steps: StepRow[],
  STEP_ORDER: StepKey[],
  mode: string,
): Promise<Record<string, unknown>> {
  const result = (job.result ?? {}) as Record<string, unknown>;
  const currentStep = steps.find((s: StepRow) => s.step_key === stepKey);

  if (currentStep?.status === "done") {
    console.log(`[runner] Step ${stepKey} already done for ${shortId}`);
    await safeRpc(sb, "release_package_lease", { p_package_id: packageId, p_runner_id: runnerId });
    return { packageId, stepKey, already_done: true };
  }

  // ── BATCH CONTINUATION GUARD ──
  if (result.batch_complete === false) {
    // ── LOOP GUARD: Track zero-progress runs for batch steps ──
    const loopMeta = updateLoopGuardMeta(
      (currentStep?.meta ?? {}) as Record<string, unknown>,
      {
        generated: typeof result.generated === "number" ? result.generated : undefined,
        inserted: typeof result.inserted === "number" ? result.inserted : undefined,
        noop_reason: typeof result.noop_reason === "string" ? result.noop_reason : null,
      },
    );

    if (!result.batch_cursor) {
      console.log(`[runner] 🔄 Step ${stepKey} batch incomplete (cursorless/idempotent) — re-queued`);
      await safeQuery(
        sb.from("package_steps").update({
          status: "queued", job_id: null, runner_id: null, last_error: null,
          meta: {
            ...loopMeta,
            last_batch_at: new Date().toISOString(),
            progress: result.progress ?? null,
            total_populated: result.total_populated ?? null,
            remaining: result.remaining ?? null,
          },
        }).eq("package_id", packageId).eq("step_key", stepKey),
        "batch_cursorless_requeue",
      );
      await safeRpc(sb, "release_package_lease", { p_package_id: packageId, p_runner_id: runnerId });
      return { packageId, stepKey, batch_continue: true, cursorless: true, progress: result.progress };
    }

    if (result.batch_cursor) {
      if (stepKey === "generate_learning_content") {
        const beforeReal = Number(currentStep?.meta?.last_real_count ?? 0);
        const progress = await getLearningContentProgress(sb, packageId);
        const afterReal = Number(progress?.real ?? 0);
        const afterTotal = Number(progress?.total ?? 0);
        const progressed = (progress?.ok === true) && afterReal > beforeReal;

        let inFlight: { in_flight: boolean; recent_writes: number } | null = null;
        if (!progressed && progress?.ok && progress.course_id) {
          const { data: flightCheck } = await sb.rpc("check_lesson_writes_in_flight", {
            p_course_id: progress.course_id,
            p_window_minutes: 5,
          });
          inFlight = (flightCheck as { in_flight: boolean; recent_writes: number } | null) ?? null;
        }

        const isTransientResult = result.transient === true;

        const prevStall = Number((currentStep?.meta as Record<string, unknown>)?.stall_runs ?? 0) || 0;
        const isStall = !progressed && !inFlight?.in_flight && !isTransientResult;
        const stallRuns = progressed ? 0 : (inFlight?.in_flight || isTransientResult ? prevStall : prevStall + 1);
        const shouldConsumeAttempt = isStall && stallRuns >= 4;

        const nextAttempts = progressed || inFlight?.in_flight
          ? 0
          : isTransientResult
            ? (currentStep?.attempts ?? 0)
            : shouldConsumeAttempt
              ? (currentStep?.attempts ?? 0) + 1
              : (currentStep?.attempts ?? 0);

        const deltaReal = afterReal - beforeReal;
        const statusNote = isTransientResult
          ? `Transient LLM error — no stall penalty (${afterReal}/${afterTotal})`
          : progressed
            ? `Progress: ${beforeReal}→${afterReal}/${afterTotal} (+${deltaReal})`
            : inFlight?.in_flight
              ? `Deferred: writes in-flight (${inFlight.recent_writes})`
              : `Stall ${stallRuns}/4 — no progress (${afterReal}/${afterTotal})`;

        const transientBackoffMs = isTransientResult ? 60_000 : 0;

        await safeQuery(
          sb.from("package_steps").update({
            status: "queued", job_id: null, runner_id: null,
            attempts: nextAttempts,
            meta: {
              ...(currentStep?.meta ?? {}),
              batch_cursor: result.batch_cursor,
              last_progress_at: progressed ? new Date().toISOString() : (currentStep?.meta as Record<string, unknown>)?.last_progress_at ?? null,
              last_real_count: afterReal,
              last_total_count: afterTotal,
              last_progress_note: statusNote,
              stall_runs: stallRuns,
              ...(isTransientResult ? { last_transient_at: new Date().toISOString() } : {}),
              ...(transientBackoffMs > 0 ? { next_run_at: new Date(Date.now() + transientBackoffMs).toISOString(), backoff_seconds: transientBackoffMs / 1000 } : {}),
            },
            last_error: (progressed || inFlight?.in_flight || isTransientResult) ? null : statusNote,
          }).eq("package_id", packageId).eq("step_key", stepKey),
          "learning_batch_progress_update",
        );

        if (progressed && deltaReal > 0 && deltaReal < 5 && afterReal < afterTotal) {
          const boostJobType = "package_generate_learning_content";
          const { data: existingBoost } = await safeQuery(
            sb.from("job_queue")
              .select("id")
              .eq("package_id", packageId)
              .eq("job_type", boostJobType)
              .in("status", ["pending", "processing"])
              .limit(1),
            "check_existing_boost",
          ) as any;

          const boostRows = Array.isArray(existingBoost) ? existingBoost : (existingBoost as any)?.data ?? [];
          if (!Array.isArray(boostRows) || boostRows.length === 0) {
            console.log(`[runner] ⚡ Low-progress boost: only ${deltaReal} lessons this run`);
            try {
              await enqueueJob(sb, {
                job_type: boostJobType,
                package_id: packageId,
                priority: 70,
                payload: { package_id: packageId, reason: "low_progress_boost", real: afterReal, total: afterTotal },
                max_attempts: 8,
              });
            } catch (boostErr) {
              console.warn(`[runner] Low-progress boost enqueue failed: ${(boostErr as Error).message}`);
            }
          }
        }

        console.log(`[runner] 🔄 Step ${stepKey} batch incomplete — re-queued (${statusNote})`);
        await safeRpc(sb, "release_package_lease", { p_package_id: packageId, p_runner_id: runnerId });
        return { packageId, stepKey, batch_continue: true, progressed, afterReal, afterTotal, stallRuns, transient: isTransientResult || undefined };
      }

      await safeQuery(
        sb.from("package_steps").update({
          status: "queued", job_id: null, runner_id: null,
          meta: { batch_cursor: result.batch_cursor },
        }).eq("package_id", packageId).eq("step_key", stepKey),
      );
      console.log(`[runner] 🔄 Step ${stepKey} batch incomplete — re-queued`);
      await safeRpc(sb, "release_package_lease", { p_package_id: packageId, p_runner_id: runnerId });
      return { packageId, stepKey, batch_continue: true };
    }
  }

  // ── AUTO-HEAL: Validation steps that complete with ok=false ──
  const VALIDATION_HEAL_MAP: Record<string, string> = {
    validate_handbook: "generate_handbook",
    validate_exam_pool: "generate_exam_pool",
    validate_learning_content: "generate_learning_content",
    validate_oral_exam: "generate_oral_exam",
    validate_lesson_minichecks: "generate_lesson_minichecks",
    validate_blueprints: "auto_seed_exam_blueprints",
  };

  if (VALIDATION_HEAL_MAP[stepKey] && result.ok === false) {
    const predecessorStep = VALIDATION_HEAL_MAP[stepKey];
    const MAX_HEAL_RETRIES = 3;
    const healKey = `heal_${stepKey}_attempts`;
    const currentStepForHeal = steps.find((s: StepRow) => s.step_key === stepKey);
    const attempts = Number(((currentStepForHeal?.meta ?? {}) as Record<string, unknown>)[healKey] ?? 0) || 0;

    if (attempts < MAX_HEAL_RETRIES) {
      console.warn(`[runner] ⚠️ Auto-heal: ${stepKey} failed validation — resetting ${predecessorStep} (attempt ${attempts + 1}/${MAX_HEAL_RETRIES})`);

      const targetLfIds = result.missing_lf_ids ?? result.target_lf_ids;
      const hasTargetedLfs = Array.isArray(targetLfIds) && targetLfIds.length > 0;

      if (hasTargetedLfs) {
        const prevMeta = ((currentStepForHeal?.meta ?? {}) as Record<string, unknown>);
        const alreadyTriedTargeted = Array.isArray(prevMeta.last_target_lf_ids) && prevMeta.last_target_lf_ids.length > 0;
        if (alreadyTriedTargeted) {
          console.error(`[runner] ❌ Targeted re-seed already tried — stopping loop`);
          await safeQuery(
            sb.from("package_steps").update({
              status: "failed",
              last_error: `Targeted re-seed failed twice — manual intervention required`,
            }).eq("package_id", packageId).eq("step_key", stepKey),
            "kill_switch_targeted_reseed",
          );
          await safeRpc(sb, "release_package_lease", { p_package_id: packageId, p_runner_id: runnerId });
          return { packageId, stepKey, kill_switch: true, reason: "targeted_reseed_already_failed" };
        }
      }

      const predecessorUpdate: any = { status: "queued", job_id: null, runner_id: null, started_at: null };
      if (hasTargetedLfs) {
        predecessorUpdate.last_error = `Auto-heal: targeted re-seed for ${targetLfIds!.length} missing LFs`;
        predecessorUpdate.meta = { target_lf_ids: targetLfIds };
      }
      await safeQuery(
        sb.from("package_steps").update(predecessorUpdate)
          .eq("package_id", packageId).eq("step_key", predecessorStep),
        "auto_heal_reset_predecessor",
      );

      await safeQuery(
        sb.from("package_steps").update({
          status: "queued", job_id: null, runner_id: null, started_at: null,
          last_error: `Auto-heal: validation failed, regenerating ${predecessorStep} (attempt ${attempts + 1})`,
          meta: { ...(currentStepForHeal?.meta ?? {}), [healKey]: attempts + 1, last_target_lf_ids: targetLfIds ?? null },
        }).eq("package_id", packageId).eq("step_key", stepKey),
        "auto_heal_reset_validation",
      );

      await safeQuery(sb.from("auto_heal_log").insert({
        action_type: "validation_auto_heal",
        trigger_source: "pipeline_runner",
        target_type: "package_step",
        target_id: packageId,
        result_status: "ok",
        result_detail: `${stepKey} failed → reset ${predecessorStep} (attempt ${attempts + 1}/${MAX_HEAL_RETRIES})`,
        metadata: { step: stepKey, predecessor: predecessorStep, attempt: attempts + 1, issues: result.issues, target_lf_ids: targetLfIds },
      }));

      await safeRpc(sb, "release_package_lease", { p_package_id: packageId, p_runner_id: runnerId });
      return { packageId, stepKey, auto_heal: true, predecessor: predecessorStep, attempt: attempts + 1, targeted_lf_count: targetLfIds?.length };
    } else {
      console.error(`[runner] ❌ Auto-heal exhausted for ${stepKey} after ${MAX_HEAL_RETRIES} retries`);
      await safeQuery(
        sb.from("course_packages")
          .update({ status: "quality_gate_failed", last_error: `${stepKey}: validation failed after ${MAX_HEAL_RETRIES} auto-heal retries` })
          .eq("id", packageId),
      );
      await safeRpc(sb, "step_fail", { p_package_id: packageId, p_step_key: stepKey, p_error: `Auto-heal exhausted after ${MAX_HEAL_RETRIES} retries` });
      await safeRpc(sb, "release_package_lease", { p_package_id: packageId, p_runner_id: runnerId });
      return { packageId, stepKey, auto_heal_exhausted: true };
    }
  }

  // ── FAN-OUT COMPLETION GUARD ──
  const fanOutCfg = getFanOutConfig(stepKey);
  if (fanOutCfg && result.fan_out_skipped === true) {
    const { data: completion } = await safeRpc(sb, "check_fan_out_completion", {
      p_package_id: packageId,
      p_step_key: stepKey,
      p_subjob_types: fanOutCfg.subjobTypes,
      p_completion_mode: fanOutCfg.completionMode,
      p_completion_rpc: fanOutCfg.completionRpc ?? null,
    });
    const comp = completion as Record<string, unknown> | null;
    if (comp && !comp.ok) {
      const activeCount = Number(comp.active_subjobs ?? 0);
      const failedCount = Number(comp.failed_subjobs ?? 0);
      const completedCount = Number(comp.completed_subjobs ?? 0);

      // SOFT-FAIL GATE: Steps with softFailOnSubjobError=true (e.g. expand_handbook)
      // treat failed subjobs as non-blocking. If no active jobs remain, the step
      // is done regardless of failures — quality is tracked at the artifact level
      // (e.g. handbook_sections.expand_status), not at the job level.
      if (fanOutCfg.softFailOnSubjobError && activeCount === 0) {
        console.log(`[pipeline] ${stepKey}: soft-fail gate — ${completedCount} completed, ${failedCount} failed (non-blocking). Marking done.`);
        // Fall through to normal step completion below
      } else if (failedCount > 0 && activeCount === 0) {
        await safeQuery(
          sb.from("package_steps").update({
            status: "failed", job_id: null, runner_id: null,
            last_error: `Fan-out: ${failedCount} subjobs failed, ${completedCount} completed`,
          }).eq("package_id", packageId).eq("step_key", stepKey),
          "fan_out_failed",
        );
        await safeRpc(sb, "release_package_lease", { p_package_id: packageId, p_runner_id: runnerId });
        return { packageId, stepKey, fan_out_guard: true, completion: comp };
      } else {
        await safeQuery(
          sb.from("package_steps").update({
            status: "enqueued", job_id: null, runner_id: null,
            last_error: `Fan-out guard: ${activeCount} subjobs active`,
          }).eq("package_id", packageId).eq("step_key", stepKey),
          "fan_out_guard_reset",
        );
        await safeRpc(sb, "release_package_lease", { p_package_id: packageId, p_runner_id: runnerId });
        return { packageId, stepKey, fan_out_guard: true, completion: comp };
      }
    }
  }

  if (stepKey === "generate_learning_content") {
    const progress = await getLearningContentProgress(sb, packageId);
    const total = Number(progress?.total ?? 0);
    const real = Number(progress?.real ?? 0);
    const COMPLETION_THRESHOLD = 0.95;
    const completionRatio = total > 0 ? real / total : 0;
    const materiallyComplete = total > 0 && completionRatio >= COMPLETION_THRESHOLD;
    const isComplete = (progress?.ok === true && total > 0 && real >= total) || materiallyComplete;

    if (!isComplete) {
      await safeQuery(
        sb.from("package_steps").update({
          status: "queued", job_id: null, runner_id: null,
          attempts: real > Number(currentStep?.meta?.last_real_count ?? 0) ? 0 : currentStep?.attempts ?? 0,
          meta: {
            ...(currentStep?.meta ?? {}),
            last_real_count: real,
            last_total_count: total,
            last_progress_at: real > Number(currentStep?.meta?.last_real_count ?? 0) ? new Date().toISOString() : currentStep?.meta?.last_progress_at ?? null,
            completion_guard: {
              mode: "material_completion",
              total_lessons: total,
              generated_lessons: real,
              completion_ratio: completionRatio,
              threshold: COMPLETION_THRESHOLD,
            },
          },
          last_error: `Completion guard: ${real}/${total} real lessons (ratio=${completionRatio.toFixed(3)}, threshold=${COMPLETION_THRESHOLD})`,
        }).eq("package_id", packageId).eq("step_key", stepKey),
        "learning_completion_guard",
      );
      await safeRpc(sb, "release_package_lease", { p_package_id: packageId, p_runner_id: runnerId });
      return { packageId, stepKey, completion_guard_deferred: true, real, total, completionRatio };
    }

    // Materially complete but needs_regen > 0 → enqueue rework jobs
    if (materiallyComplete && real < total) {
      const needsRegenCount = total - real;
      console.log(`[runner] ✅ Material completion for ${shortId}: ${real}/${total} (${(completionRatio * 100).toFixed(1)}%) — enqueuing ${needsRegenCount} regen jobs`);
      try {
        await sb.rpc("enqueue_learning_content_regen_for_package", {
          p_package_id: packageId,
          p_limit: 50,
        });
      } catch (regenErr) {
        console.warn(`[runner] Regen enqueue failed for ${shortId}: ${(regenErr as Error).message}`);
      }
    }
  }

  // ── GENERATE_HANDBOOK COMPLETION GUARD ──
  // Mirrors generate_learning_content guard: verify actual artifact coverage before marking done.
  // Prevents premature step_done when batch_complete=false slips through.
  if (stepKey === "generate_handbook") {
    const { data: pkgForHandbook } = await sb
      .from("course_packages")
      .select("curriculum_id")
      .eq("id", packageId)
      .maybeSingle();
    const hbCurrId = pkgForHandbook?.curriculum_id;

    if (hbCurrId) {
      // Count chapters with populated sections — per-chapter quality check
      const { data: hbChapters } = await sb
        .from("handbook_chapters")
        .select("id")
        .eq("curriculum_id", hbCurrId);

      const totalChapters = hbChapters?.length ?? 0;
      let coveredChapters = 0;
      const emptyChapterIds: string[] = [];

      if (hbChapters?.length) {
        const chIds = hbChapters.map((c: any) => c.id);
        // Load all sections with content to check per-chapter coverage
        const { data: allSections } = await sb
          .from("handbook_sections")
          .select("chapter_id, content_markdown")
          .in("chapter_id", chIds);

        // v18: Use SSOT threshold from handbook-write-guard (800 chars for basis)
        // Was hardcoded 500 — caused drift vs. post-conditions/validate-handbook
        for (const ch of hbChapters) {
          const chSections = (allSections ?? []).filter(
            (s: any) => s.chapter_id === ch.id
              && typeof s.content_markdown === "string"
              && s.content_markdown.trim().length >= 800
          );
          if (chSections.length > 0) {
            coveredChapters++;
          } else {
            emptyChapterIds.push(ch.id);
          }
        }
      }

      // Hardened v8: 100% chapter coverage required
      const minCoverage = 1.0;
      const minNeeded = Math.max(1, Math.ceil(totalChapters * minCoverage));
      const handbookReady = coveredChapters >= minNeeded;

      if (!handbookReady) {
        console.warn(`[runner] 📚 Handbook completion guard: ${coveredChapters}/${totalChapters} chapters (need ${minNeeded}) — requeuing ${shortId}`);
        await safeQuery(
          sb.from("package_steps").update({
            status: "queued", job_id: null, runner_id: null,
            meta: {
              ...(currentStep?.meta ?? {}),
              last_coverage_check: { covered: coveredChapters, total: totalChapters, needed: minNeeded },
              last_coverage_at: new Date().toISOString(),
            },
            last_error: `Handbook completion guard: ${coveredChapters}/${totalChapters} chapters with content (need ${minNeeded})`,
          }).eq("package_id", packageId).eq("step_key", stepKey),
          "handbook_completion_guard",
        );
        await safeRpc(sb, "release_package_lease", { p_package_id: packageId, p_runner_id: runnerId });
        return { packageId, stepKey, handbook_completion_guard: true, covered: coveredChapters, total: totalChapters };
      }
    }
  }

  await safeRpc(sb, "mark_step_done", {
    p_package_id: packageId,
    p_step_key: stepKey,
    p_meta: result,
  });

  const { count: doneCount } = await sb
    .from("package_steps")
    .select("step_key", { count: "exact", head: true })
    .eq("package_id", packageId)
    .in("status", ["done", "skipped"]);
  const totalSteps = STEP_ORDER.length;
  const progress = Math.round(((doneCount ?? 0) / totalSteps) * 100);
  const stepIndex = STEP_ORDER.indexOf(stepKey as StepKey);
  await safeQuery(
    sb.from("course_packages").update({
      current_step: stepIndex + 1,
    }).eq("id", packageId),
  );

  if (stepKey === "auto_publish") {
    await safeQuery(
      sb.from("course_packages").update({ status: "published" }).eq("id", packageId),
    );
  }

  await safeQuery(
    sb.from("package_steps")
      .update({ job_id: null })
      .eq("package_id", packageId)
      .eq("step_key", stepKey),
  );

  console.log(`[runner] ✅ Step ${stepKey} done for ${shortId} (progress ${progress}%)`);
  await safeRpc(sb, "release_package_lease", { p_package_id: packageId, p_runner_id: runnerId });
  return { packageId, stepKey, mode, progress };
}

// handleJobFailed, handleEnqueue, and backfillPipelinePool are now in
// pipeline-handlers.ts and pipeline-backfill.ts respectively.
