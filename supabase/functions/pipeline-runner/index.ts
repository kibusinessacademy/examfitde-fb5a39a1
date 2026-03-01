import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { inferBackoffSeconds, poolForJobType } from "../_shared/job-map.ts";
import { enqueueJob } from "../_shared/enqueue.ts";

/**
 * pipeline-runner — Pure Orchestrator (v3: Multi-Slot Acquisition)
 *
 * The Runner NEVER executes steps directly. It only:
 * 1. Acquires package leases in a loop (up to max_concurrent_packages)
 * 2. Determines next step via state machine for each acquired package
 * 3. Enqueues worker jobs into job_queue
 * 4. Polls enqueued job status and propagates results
 *
 * KEY CHANGE in v3: Each invocation fills ALL available slots, not just one.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

import { STEP_TO_JOB_TYPE, FULL_STEP_ORDER, type PipelineStepKey } from "../_shared/job-map.ts";

// Re-export type alias for local use
type StepKey = PipelineStepKey;

/**
 * Build a track-aware step order by filtering FULL_STEP_ORDER
 * to only include steps that actually exist in the package's DB rows.
 */
function buildStepOrder(steps: { step_key: string }[]): StepKey[] {
  const existing = new Set(steps.map(s => s.step_key));
  return FULL_STEP_ORDER.filter(k => existing.has(k));
}

// STEP_TO_JOB_TYPE imported from _shared/job-map.ts

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

async function safeRpc(
  sb: ReturnType<typeof createClient>,
  fn: string,
  params: Record<string, unknown>,
) {
  try {
    const result = await sb.rpc(fn, params);
    if (result.error) {
      console.warn(`[runner] RPC ${fn} returned error:`, result.error.message);
    }
    return result;
  } catch (e) {
    console.error(`[runner] RPC ${fn} threw:`, (e as Error).message);
    return { data: null, error: e };
  }
}

async function safeQuery(promise: PromiseLike<unknown>, label?: string) {
  try {
    return await promise;
  } catch (e) {
    console.warn(`[runner] safeQuery${label ? ` (${label})` : ''} error:`, (e as Error).message);
    return null;
  }
}

interface StepRow {
  step_key: string;
  status: string;
  attempts: number;
  max_attempts: number;
  timeout_seconds?: number;
  started_at?: string;
  meta?: Record<string, unknown> | null;
  job_id?: string | null;
  last_error?: string | null;
  updated_at?: string | null;
}

// inferBackoffSeconds imported from _shared/job-map.ts

// ── State machine: pick next actionable step ──
type StepAction =
  | { action: "enqueue"; stepKey: StepKey }
  | { action: "poll"; stepKey: StepKey; jobId: string }
  | { action: "exhausted"; stepKey: StepKey }
  | { action: "timed_out"; stepKey: StepKey }
  | null;

function pickNextAction(steps: StepRow[], stepOrder: StepKey[]): StepAction {
  const byKey = new Map<string, StepRow>();
  for (const s of steps) byKey.set(s.step_key, s);

  for (const k of stepOrder) {
    const s = byKey.get(k);
    if (!s) continue;

    if (s.status === "done" || s.status === "skipped") continue;
    if (s.status === "blocked") continue;

    // NOTE: Zombie detection is handled BEFORE pickNextAction in processPackage.
    // pickNextAction stays "pure" — poll/enqueue/exhausted only.

    // Poll if step has a linked job (enqueued, running, OR timed-out steps)
    // FIX: timeout steps with a job_id must poll the job first — the job may
    // already be completed while expire_stale_steps() timed out the step.
    if ((s.status === "enqueued" || s.status === "running" || s.status === "timeout") && s.job_id) {
      return { action: "poll", stepKey: k, jobId: s.job_id };
    }

    // Running WITHOUT job_id = orphaned step → auto-recover
    if (s.status === "running" && !s.job_id) {
      console.warn(`[runner] ⚠️ Step ${k} is 'running' without job_id (orphaned) — will reset and re-enqueue`);
      return { action: "enqueue", stepKey: k };
    }

    // Enqueued WITHOUT job_id = same orphan class
    if (s.status === "enqueued" && !s.job_id) {
      console.warn(`[runner] ⚠️ Step ${k} is 'enqueued' without job_id (orphaned) — will re-enqueue`);
      return { action: "enqueue", stepKey: k };
    }

    // Running without job_id was already handled above (orphan recovery).
    if (s.status === "running") {
      console.warn(`[runner] Unexpected: step ${k} is running but wasn't caught by earlier checks`);
      return null;
    }

    // Timeout WITHOUT job_id = needs re-enqueue
    if (s.status === "timeout" && !s.job_id) {
      if (s.attempts < s.max_attempts) {
        return { action: "enqueue", stepKey: k };
      }
      return { action: "exhausted", stepKey: k };
    }

    const retryable = s.status === "queued" || s.status === "failed" || s.status === "timeout";
    if (retryable && s.attempts < s.max_attempts) {
      return { action: "enqueue", stepKey: k };
    }
    if (retryable && s.attempts >= s.max_attempts) {
      return { action: "exhausted", stepKey: k };
    }
  }

  return null;
}

// ══════════════════════════════════════════════════════════════
// Process a single acquired package — returns result summary
// ══════════════════════════════════════════════════════════════
async function processPackage(
  sb: ReturnType<typeof createClient>,
  packageId: string,
  runnerId: string,
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
  // Never process packages that are already published or not in building state.
  if (pkg.published_at || pkg.status !== "building") {
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

  // ── Bootstrap: If no steps exist, invoke build-course-package to create them ──
  if (!steps || steps.length === 0) {
    console.log(`[runner] Package ${shortId} has no steps — invoking build-course-package to bootstrap`);
    try {
      const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
      const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

      // Ensure pipeline lock is held by this package before build-course-package checks it
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

  // ── Sequence integrity guard: reset out-of-order "done" steps ──
  // Uses track-aware step order (only steps that exist for this package)
  const STEP_ORDER = buildStepOrder((steps ?? []) as { step_key: string }[]);
  {
    const byKey = new Map<string, StepRow>();
    for (const s of (steps ?? []) as StepRow[]) byKey.set(s.step_key, s);
    let lastIncompleteSeq = -1;
    for (let i = 0; i < STEP_ORDER.length; i++) {
      const s = byKey.get(STEP_ORDER[i]);
      if (!s) continue;
      if (s.status !== "done" && s.status !== "skipped") {
        lastIncompleteSeq = i;
      } else if (s.status === "done" && lastIncompleteSeq >= 0) {
        // This step is "done" but a predecessor is not — reset it
        console.warn(`[runner] 🔧 Sequence fix: resetting ${STEP_ORDER[i]} to queued (predecessor ${STEP_ORDER[lastIncompleteSeq]} not done)`);
        await safeQuery(
          sb.from("package_steps").update({
            status: "queued", job_id: null, runner_id: null,
            started_at: null, finished_at: null,
            last_error: `Sequence guard: predecessor ${STEP_ORDER[lastIncompleteSeq]} not done`,
          }).eq("package_id", packageId).eq("step_key", STEP_ORDER[i]),
          "sequence_guard_reset",
        );
        // Update in-memory too so pickNextAction sees corrected state
        s.status = "queued";
      }
    }
  }

  // ── FINALIZATION GUARD (Dictionary-based) ──
  // Auto-close steps that met their target. Runs BEFORE pickNextAction
  // so the state machine sees corrected states.
  // Only covers steps with real job_queue entries — no heuristics for inline steps.
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
          const ok = meta?.batch_complete === true;
          const reason = ok ? "meta.batch_complete=true" : "meta.batch_complete!=true";
          return { ok, reason, snapshot: { batch_complete: meta?.batch_complete === true } };
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
    ];

    const byKey = new Map<string, StepRow>();
    for (const s of (steps ?? []) as StepRow[]) byKey.set(s.step_key, s);

    for (const rule of FINALIZATION_RULES) {
      const step = byKey.get(rule.stepKey);
      if (!step) continue;
      if (!["queued", "running", "enqueued"].includes(step.status)) continue;

      const meta = (step.meta ?? {}) as any;
      const cond = rule.shouldFinalize(meta);
      if (!cond.ok) continue;

      // Fail-soft: if RPC errors, skip finalization (never finalize blind)
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

      // Compare-and-set: only finalize if status still matches (race-safe)
      const { data: updatedRows, error: updErr } = await sb
        .from("package_steps")
        .update({
          status: "done",
          last_error: null,
          finished_at: new Date().toISOString(),
        })
        .eq("package_id", packageId)
        .eq("step_key", rule.stepKey)
        .in("status", ["queued", "running", "enqueued"])
        .select("step_key");

      const applied = !!(updatedRows && updatedRows.length > 0);

      if (applied) {
        // Cancel orphaned jobs only when we actually finalized
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
        // Update in-memory so pickNextAction sees 'done'
        step.status = "done";
      } else {
        // Race: status changed between check and update — log as skipped
        await safeQuery(sb.from("auto_heal_log").insert({
          action_type: rule.actionType,
          trigger_source: "pipeline-runner",
          target_type: "course_package",
          target_id: packageId,
          result_status: "skipped",
          result_detail: `Skipped ${rule.stepKey}: race (status changed)`,
          metadata: { step_key: rule.stepKey, job_type: rule.jobType, condition: cond.snapshot, error: updErr?.message ?? null },
        }), "finalization_log_skip");
      }
    }
  }

   // ── ZOMBIE STEP AUTO-FINALIZATION (with age guard) ──
   // Detect steps stuck in "running"/"enqueued"/"queued" where meta already indicates success.
   // Only auto-fix if age > 5 minutes to avoid finalizing fresh steps.
   // BUG 1 FIX: batch_complete must NOT override ok=false.
   // BUG 4 FIX: Predecessor must be done/skipped before force-finalizing.
   // BUG 5 FIX: Steps that were never started must NOT be zombified.
   {
     const ZOMBIE_MIN_AGE_MS = 5 * 60 * 1000;
     // GUARDRAIL 1: Only these steps are safe to auto-finalize (idempotent read-only or meta-only steps)
     const ZOMBIFIABLE_STEPS = new Set([
       "validate_learning_content", "validate_exam_pool", "validate_blueprints",
       "validate_oral_exam", "validate_handbook", "validate_lesson_minichecks",
       "validate_tutor_index", "run_integrity_check", "quality_council",
       "auto_publish", "elite_harden",
     ]);
     const byKey = new Map<string, StepRow>();
     for (const s of (steps ?? []) as StepRow[]) byKey.set(s.step_key, s);

     function isTerminalStatus(st: string) { return st === "done" || st === "skipped"; }

     for (const k of STEP_ORDER) {
       const s = byKey.get(k);
       // Only zombie-fix running/enqueued steps that are in the whitelist
       if (!s || !["running", "enqueued"].includes(s.status)) continue;
       if (!ZOMBIFIABLE_STEPS.has(k)) continue; // GUARDRAIL 1: not whitelisted → skip
       const meta = (s.meta ?? {}) as Record<string, unknown>;

        // BUG 1 FIX (hardened): Zombie-fix ONLY when meta.ok === true.
        // No ok field at all → do NOT zombify (safest: avoids batch_complete false-positives).
        const hasOkField = meta.ok !== undefined && meta.ok !== null;
        if (!hasOkField) continue;          // 🔒 no ok semantics → skip entirely
        if (meta.ok !== true) continue;     // 🔒 ok=false is NOT success

       // BUG 5 FIX: Steps that were never started are not zombies — skip them
       const startedAt = s.started_at ? new Date(s.started_at).getTime() : 0;
       if (!startedAt || startedAt <= 0) continue;

       // Age guard: only auto-finalize if step has been running > 5 minutes
       const age = Date.now() - startedAt;
       if (age <= ZOMBIE_MIN_AGE_MS) continue;

       // BUG 4 FIX: Check that predecessor step is done/skipped before finalizing
       const stepIdx = STEP_ORDER.indexOf(k as StepKey);
       if (stepIdx > 0) {
         const prevKey = STEP_ORDER[stepIdx - 1];
         const prev = byKey.get(prevKey);
         if (!prev || !isTerminalStatus(prev.status)) {
           console.warn(`[runner] 🧟 ZOMBIE blocked: step ${k} predecessor ${prevKey} is ${prev?.status ?? 'missing'} — not finalizing`);
           continue;
         }
       }

       console.warn(`[runner] 🧟 ZOMBIE auto-fix: step ${k} for ${shortId} is ${s.status} with meta.ok=${meta.ok} for ${Math.round(age / 60000)}min — forcing to done`);

      // 1) Finalize step (match on current status for race safety)
      await safeQuery(
        sb.from("package_steps").update({
          status: "done", finished_at: new Date().toISOString(),
          last_error: null,
        }).eq("package_id", packageId).eq("step_key", k).in("status", ["running", "enqueued"]),
        "zombie_auto_finalize",
      );

      // 2) Cancel pending/failed jobs via RPC
      const jobType = STEP_TO_JOB_TYPE[k as StepKey];
      if (jobType) {
        await safeRpc(sb, "cancel_jobs_for_package", {
          p_package_id: packageId,
          p_job_type: jobType,
          p_statuses: ["pending", "failed"],
          p_reason: `pipeline-runner zombie finalize: cleanup for step ${k}`,
        });
        // Also cancel stale processing jobs (Bankkaufmann pattern)
        await safeRpc(sb, "cancel_stale_processing_jobs_for_package", {
          p_package_id: packageId,
          p_job_type: jobType,
          p_stale_minutes: 15,
          p_reason: `pipeline-runner zombie finalize: cleanup stale processing for step ${k}`,
        });
      }

      // 3) Log
      await safeQuery(sb.from("auto_heal_log").insert({
        action_type: "zombie_step_auto_finalize",
        trigger_source: "pipeline-runner",
        target_type: "package_step",
        target_id: packageId,
        result_status: "applied",
        result_detail: `Step ${k} was running with meta.ok=${meta.ok}, batch_complete=${meta.batch_complete} for ${Math.round(age / 60000)}min — forced to done + jobs cancelled`,
        metadata: { step_key: k, meta, age_min: Math.round(age / 60000) },
      }), "zombie_log");

      // 4) Update in-memory
      s.status = "done";
    }
  }

  // ── ESCALATION LOOP BREAKER (scoped by step type) ──
  // - validate_* steps: safe to skip (content exists, just validation loops)
  // - generate_* / other critical steps: DO NOT skip — flag for manual review
  {
    const ESCALATION_MAX = 10;
    const byKey = new Map<string, StepRow>();
    for (const s of (steps ?? []) as StepRow[]) byKey.set(s.step_key, s);
    for (const k of STEP_ORDER) {
      const s = byKey.get(k);
      if (!s) continue;
      if (s.status === "done" || s.status === "skipped" || s.status === "blocked") continue;
      if (s.attempts < ESCALATION_MAX) continue;

      // Age guard: only act on loops that have been stable > 10min
      const updatedAt = s.updated_at ? new Date(s.updated_at).getTime() : 0;
      const ageMs = updatedAt > 0 ? (Date.now() - updatedAt) : Infinity;
      if (ageMs < 10 * 60 * 1000) continue;

      // Signature guard: require some failure signal
      const lastErr = String(s.last_error || "");
      const metaErr = String(((s.meta ?? {}) as Record<string, unknown>)?.error || "");
      if (!lastErr && !metaErr) continue;

      const isValidation = k.startsWith("validate_");
      const jobType = STEP_TO_JOB_TYPE[k as StepKey];

      if (isValidation) {
        // Safe to skip validation steps
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
          result_detail: `Validation step ${k} skipped after ${s.attempts} attempts (loop detected)`,
          metadata: { step_key: k, attempts: s.attempts, type: "validation_skip" },
        }), "escalation_log");
        await safeQuery(sb.from("admin_notifications").insert({
          title: `Pipeline-Eskalation: ${k}`,
          body: `Validierungsstep ${k} für Paket ${shortId} wurde nach ${s.attempts} Versuchen übersprungen. Inhalt prüfen.`,
          category: "ops", severity: "warning",
          entity_type: "course_package", entity_id: packageId,
          metadata: { step_key: k, attempts: s.attempts },
        }), "escalation_notify");
        s.status = "skipped";
      } else {
        // NOT safe to skip generate_* or critical steps — halt and flag
        console.error(`[runner] 🛑 ESCALATION: critical step ${k} for ${shortId} has ${s.attempts} attempts — flagging for manual review (NOT skipping)`);
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
          result_detail: `Critical step ${k} flagged for manual review after ${s.attempts} attempts (NOT skipped)`,
          metadata: { step_key: k, attempts: s.attempts, type: "manual_review" },
        }), "escalation_log");
        await safeQuery(sb.from("admin_notifications").insert({
          title: `🚨 Pipeline-Eskalation: ${k}`,
          body: `Kritischer Step ${k} für Paket ${shortId} hängt nach ${s.attempts} Versuchen. Manuelle Prüfung ERFORDERLICH.`,
          category: "ops", severity: "error",
          entity_type: "course_package", entity_id: packageId,
          metadata: { step_key: k, attempts: s.attempts },
        }), "escalation_notify_critical");
        // Don't update s.status — leave as-is, pipeline will halt naturally
        break; // Stop processing this package
      }
    }
  }

  const nextAction = pickNextAction((steps ?? []) as StepRow[], STEP_ORDER);

  // ── All steps done / no actionable step ──
  if (!nextAction) {
    const statuses = (steps ?? []).map((s: StepRow) => s.status);
    const allDone = statuses.length > 0 && statuses.every((s: string) => s === "done" || s === "skipped");

    if (allDone) {
      await safeQuery(sb.from("course_packages").update({ status: "published" }).eq("id", packageId));
      console.log(`[runner] Package ${shortId} → done`);

      // 🚀 Backfill: keep active pipeline pool at TARGET_POOL_SIZE
      try {
        const backfilled = await backfillPipelinePool(sb);
        if (backfilled > 0) {
          console.log(`[runner] 🏭 Backfilled ${backfilled} package(s) to maintain pool`);
        }
      } catch (e) {
        console.warn(`[runner] Backfill failed (non-blocking): ${(e as Error)?.message}`);
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
    await safeQuery(
      sb.from("course_packages")
        .update({ status: "failed", last_error: `Attempts exhausted on step ${nextAction.stepKey}` })
        .eq("id", packageId),
    );
    await safeQuery(
      sb.from("ops_alerts").insert({
        source: "pipeline-runner",
        severity: "error",
        message: `STEP_EXHAUSTED: ${nextAction.stepKey} pkg ${shortId}`,
        payload: { packageId, stepKey: nextAction.stepKey },
      }),
    );
    await safeRpc(sb, "release_package_lease", { p_package_id: packageId, p_runner_id: runnerId });
    return { packageId, stepKey: nextAction.stepKey, exhausted: true };
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
    const { stepKey, jobId } = nextAction;
    console.log(`[runner] Polling job ${jobId.slice(0, 8)} for step ${stepKey} (pkg ${shortId})`);

    const { data: job } = await sb
      .from("job_queue")
      .select("status,result,error,last_error,batch_cursor,updated_at,locked_at")
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

    // Job still pending → check if step is already "running" (state mismatch = deadlock)
    if (job.status === "pending") {
      const currentStep = (steps ?? []).find((s: StepRow) => s.step_key === stepKey);

      // DEADLOCK FIX: step=running but job=pending means the job was reset after a batch
      // failure but the step was never reset. The job-runner won't re-pick this up
      // because the step holds a stale state. Reset step to 'enqueued' so runner
      // can properly track it, and check for staleness.
      const jobAge = job.updated_at
        ? Date.now() - new Date(job.updated_at as string).getTime()
        : 0;
      const PENDING_STALE_MS = 10 * 60 * 1000; // 10 minutes

      if (currentStep?.status === "running" && jobAge > PENDING_STALE_MS) {
        console.warn(`[runner] ⚠️ Deadlock: step ${stepKey} running but job ${jobId.slice(0, 8)} pending for ${Math.round(jobAge / 60000)}min — resetting`);
        await safeQuery(
          sb.from("package_steps").update({
            status: "queued",
            job_id: null,
            runner_id: null,
            started_at: null,
            last_error: `Deadlock reset: job pending ${Math.round(jobAge / 60000)}min while step running`,
          }).eq("package_id", packageId).eq("step_key", stepKey),
          "reset_deadlocked_step",
        );
        await safeRpc(sb, "release_package_lease", { p_package_id: packageId, p_runner_id: runnerId });
        return { packageId, stepKey, deadlock_reset: true, jobAge: Math.round(jobAge / 60000) };
      }

      await safeRpc(sb, "renew_package_lease", {
        p_package_id: packageId,
        p_runner_id: runnerId,
        p_lease_seconds: 120,
      });
      await safeRpc(sb, "step_heartbeat", {
        p_package_id: packageId,
        p_step_key: stepKey,
      });
      return { packageId, stepKey, waiting: true, jobStatus: "pending" };
    }

    // Job processing → check for stuck jobs
    if (job.status === "processing") {
      const currentStep = (steps ?? []).find((s: StepRow) => s.step_key === stepKey);

      const jobAge = job.updated_at
        ? Date.now() - new Date(job.updated_at as string).getTime()
        : 0;

      // FIX: Detect zombie jobs — processing but locked_at is null means the
      // edge function completed/crashed but the result was never written back.
      // These jobs will NEVER complete on their own. Reset after 5 minutes.
      const ZOMBIE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes
      const STUCK_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes
      const isZombie = !job.locked_at && jobAge > ZOMBIE_THRESHOLD_MS;

      if (isZombie || jobAge > STUCK_THRESHOLD_MS) {
        const reason = isZombie
          ? `Zombie job: processing with no lock for ${Math.round(jobAge / 60000)}min`
          : `Stuck processing for ${Math.round(jobAge / 60000)}min`;
        console.warn(`[runner] ⚠️ Job ${jobId.slice(0, 8)} ${reason} — force-resetting`);
        await safeQuery(
          sb.from("job_queue").update({
            status: "failed",
            last_error: reason,
            updated_at: new Date().toISOString(),
          }).eq("id", jobId),
          "force_fail_stuck_job",
        );
        await safeQuery(
          sb.from("package_steps").update({
            status: "queued",
            job_id: null,
            runner_id: null,
            started_at: null,
            last_error: reason,
          }).eq("package_id", packageId).eq("step_key", stepKey),
          "reset_stuck_step",
        );
        await safeRpc(sb, "release_package_lease", { p_package_id: packageId, p_runner_id: runnerId });
        return { packageId, stepKey, stuck_reset: true, zombie: isZombie, jobAge: Math.round(jobAge / 60000) };
      }

      if (currentStep?.status !== "running") {
        await safeRpc(sb, "step_start", {
          p_package_id: packageId,
          p_step_key: stepKey,
          p_runner_id: runnerId,
        });
      } else {
        await safeRpc(sb, "step_heartbeat", {
          p_package_id: packageId,
          p_step_key: stepKey,
        });
      }
      await safeRpc(sb, "renew_package_lease", {
        p_package_id: packageId,
        p_runner_id: runnerId,
        p_lease_seconds: 120,
      });
      return { packageId, stepKey, waiting: true, jobStatus: "processing" };
    }

    // Job completed
    if (job.status === "completed") {
      const result = (job.result ?? {}) as Record<string, unknown>;

      // Check if step is already marked done (idempotency guard against re-polling)
      const currentStep = (steps ?? []).find((s: StepRow) => s.step_key === stepKey);
      if (currentStep?.status === "done") {
        console.log(`[runner] Step ${stepKey} already done for ${shortId} — skipping redundant step_done`);
        await safeRpc(sb, "release_package_lease", { p_package_id: packageId, p_runner_id: runnerId });
        return { packageId, stepKey, already_done: true };
      }

      if (result.batch_complete === false && result.batch_cursor) {
        await safeQuery(
          sb.from("package_steps")
            .update({
              status: "queued",
              job_id: null,
              runner_id: null,
              meta: { batch_cursor: result.batch_cursor },
            })
            .eq("package_id", packageId)
            .eq("step_key", stepKey),
        );
        console.log(`[runner] 🔄 Step ${stepKey} batch incomplete — re-queued`);
        await safeRpc(sb, "release_package_lease", { p_package_id: packageId, p_runner_id: runnerId });
        return { packageId, stepKey, batch_continue: true };
      }

      // ══ AUTO-HEAL: Validation steps that complete with ok=false ══
      // When a QG step succeeds technically but fails content validation,
      // reset the predecessor generation step to trigger regeneration.
      const VALIDATION_PREDECESSOR: Record<string, StepKey> = {
        validate_blueprints: "auto_seed_exam_blueprints",
        validate_tutor_index: "build_ai_tutor_index",
        validate_learning_content: "generate_learning_content",
        validate_exam_pool: "generate_exam_pool",
        validate_oral_exam: "generate_oral_exam",
        validate_handbook: "generate_handbook",
      };

      if (result.ok === false && VALIDATION_PREDECESSOR[stepKey]) {
        const predecessorStep = VALIDATION_PREDECESSOR[stepKey];
        const attempts = currentStep?.attempts ?? 0;
        const MAX_HEAL_RETRIES = 7;

        if (attempts < MAX_HEAL_RETRIES) {
          console.warn(`[runner] 🔄 Auto-heal: ${stepKey} failed validation (attempt ${attempts + 1}/${MAX_HEAL_RETRIES}) — resetting predecessor ${predecessorStep}`);

          // ── Targeted re-seed: if validate_blueprints reports missing LF IDs,
          // pass them to the seeder so it only generates for those LFs (budget-efficient)
          const targetLfIds: string[] | undefined = result.missing_lf_ids;
          const hasTargetedLfs = stepKey === "validate_blueprints" && Array.isArray(targetLfIds) && targetLfIds.length > 0;

          if (hasTargetedLfs) {
            console.log(`[runner] 🎯 Targeted re-seed: ${targetLfIds!.length} missing LFs → passing target_lf_ids to seeder`);
          }

          // Kill-switch: if targeted re-seed already failed before, don't loop — escalate
          if (hasTargetedLfs && currentStep?.meta?.target_lf_ids?.length) {
            console.error(`[runner] 🛑 Kill-switch: targeted re-seed already attempted for ${stepKey} but failed again — escalating to quality_gate_failed`);
            await safeQuery(
              sb.from("package_steps")
                .update({
                  status: "failed",
                  last_error: `Targeted re-seed failed twice — manual intervention required. Missing LFs: ${targetLfIds!.length}`,
                })
                .eq("package_id", packageId)
                .eq("step_key", stepKey),
              "kill_switch_targeted_reseed",
            );
            await safeQuery(
              sb.from("auto_heal_log").insert({
                action_type: "targeted_reseed_kill_switch",
                trigger_source: "pipeline_runner",
                target_type: "package_step",
                target_id: packageId,
                result_status: "escalated",
                result_detail: `targeted re-seed already ran but ${stepKey} still fails — stopping loop`,
                metadata: { step: stepKey, missing_lf_ids: targetLfIds },
              }),
            );
            await safeRpc(sb, "release_package_lease", { p_package_id: packageId, p_runner_id: runnerId });
            return { packageId, stepKey, kill_switch: true, reason: "targeted_reseed_already_failed" };
          }

          // Reset predecessor to queued so it regenerates — preserve attempts for forensics
          const predecessorUpdate: any = { status: "queued", job_id: null, runner_id: null, started_at: null };
          // Store target_lf_ids in the step metadata so the job-runner can pass them to the seeder
          if (hasTargetedLfs) {
            predecessorUpdate.last_error = `Auto-heal: targeted re-seed for ${targetLfIds!.length} missing LFs`;
            predecessorUpdate.meta = { target_lf_ids: targetLfIds };
          }
          await safeQuery(
            sb.from("package_steps")
              .update(predecessorUpdate)
              .eq("package_id", packageId)
              .eq("step_key", predecessorStep),
            "auto_heal_reset_predecessor",
          );

          // Reset this validation step to queued (will re-run after predecessor)
          await safeQuery(
            sb.from("package_steps")
              .update({
                status: "queued",
                job_id: null,
                runner_id: null,
                started_at: null,
                last_error: `Auto-heal: validation failed, regenerating ${predecessorStep} (attempt ${attempts + 1})${hasTargetedLfs ? ` [targeted: ${targetLfIds!.length} LFs]` : ""}`,
              })
              .eq("package_id", packageId)
              .eq("step_key", stepKey),
            "auto_heal_reset_validation",
          );

          await safeQuery(
            sb.from("auto_heal_log").insert({
              action_type: "validation_auto_heal",
              trigger_source: "pipeline_runner",
              target_type: "package_step",
              target_id: packageId,
              result_status: "ok",
              result_detail: `${stepKey} failed → reset ${predecessorStep} (attempt ${attempts + 1}/${MAX_HEAL_RETRIES})${hasTargetedLfs ? ` [targeted: ${targetLfIds!.length} LFs]` : ""}`,
              metadata: { step: stepKey, predecessor: predecessorStep, attempt: attempts + 1, issues: result.issues, target_lf_ids: targetLfIds },
            }),
          );

          await safeRpc(sb, "release_package_lease", { p_package_id: packageId, p_runner_id: runnerId });
          return { packageId, stepKey, auto_heal: true, predecessor: predecessorStep, attempt: attempts + 1, targeted_lf_count: targetLfIds?.length };
        } else {
          // Max retries exhausted — fail the package
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
      // Root orchestrator jobs (e.g. generate_exam_pool) may complete with
      // fan_out_skipped=true when sub-jobs already exist. But if those sub-jobs
      // are still pending, marking the step "done" would orphan them permanently.
      // Check for pending sub-jobs before finalizing fan-out steps.
      const FAN_OUT_STEPS: Set<string> = new Set([
        "generate_exam_pool",
        "auto_seed_exam_blueprints",
        "generate_learning_content",
        "generate_oral_exam",
      ]);
      if (FAN_OUT_STEPS.has(stepKey) && result.fan_out_skipped === true) {
        const jobType = STEP_TO_JOB_TYPE[stepKey as StepKey];
        const { data: pendingSubJobs } = await safeRpc(sb, "count_active_jobs", {
          p_package_id: packageId,
          p_job_type: jobType,
        });
        if ((pendingSubJobs ?? 0) > 0) {
          console.warn(`[runner] ⚠️ Fan-out guard: ${stepKey} root completed with fan_out_skipped but ${pendingSubJobs} sub-jobs still active — NOT marking done`);
          // Reset step to queued so the runner picks up the sub-jobs on next tick
          await safeQuery(
            sb.from("package_steps").update({
              status: "enqueued",
              job_id: null,
              runner_id: null,
              last_error: `Fan-out guard: ${pendingSubJobs} sub-jobs still active`,
            }).eq("package_id", packageId).eq("step_key", stepKey),
            "fan_out_guard_reset",
          );
          await safeRpc(sb, "release_package_lease", { p_package_id: packageId, p_runner_id: runnerId });
          return { packageId, stepKey, fan_out_guard: true, pending_sub_jobs: pendingSubJobs };
        }
      }

      await sb.rpc("step_done", {
        p_package_id: packageId,
        p_step_key: stepKey,
        p_meta: result,
      });

      // Re-query actual done count from DB (not stale in-memory snapshot)
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
          build_progress: progress,
          current_step: stepIndex + 1,
        }).eq("id", packageId),
      );

      if (stepKey === "auto_publish") {
        await safeQuery(
          sb.from("course_packages").update({ status: "published" }).eq("id", packageId),
        );
      }

      // Clear the job_id from the step so the next runner invocation doesn't re-poll the same completed job
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

    // Job failed — auto-heal with up to 7 retries for ALL steps
    if (job.status === "failed") {
      const rawErrorMsg = job.last_error || job.error || "Worker job failed";
      // Normalize unknown errors for better classification + backoff
      const errorMsg = rawErrorMsg === "Job failed: unknown"
        ? "UNKNOWN_EDGE_FAILURE"
        : rawErrorMsg;
      const MAX_STEP_RETRIES = 7;
      // FIX: currentStep must be resolved HERE (not from the "completed" block scope)
      const failedStep = (steps ?? []).find((s: StepRow) => s.step_key === stepKey);
      const stepAttempts = failedStep?.attempts ?? 0;

      if (stepAttempts < MAX_STEP_RETRIES) {
        console.warn(`[runner] 🔄 Auto-heal: ${stepKey} job failed (attempt ${stepAttempts + 1}/${MAX_STEP_RETRIES}) — re-queuing`);

        // Backoff: unknown/rate-limit/timeouts should not hot-loop
        const backoffSec = inferBackoffSeconds(errorMsg);

        // Re-queue the step for retry
        await safeQuery(
          sb.from("package_steps")
            .update({
              status: "queued",
              job_id: null,
              runner_id: null,
              started_at: null,
              meta: { ...(failedStep?.meta ?? {}), retry_after_sec: backoffSec, last_fail_reason: errorMsg },
              last_error: `Auto-heal retry ${stepAttempts + 1}/${MAX_STEP_RETRIES}: ${errorMsg.slice(0, 200)}`,
            })
            .eq("package_id", packageId)
            .eq("step_key", stepKey),
          "auto_heal_retry_step",
        );

        await safeQuery(
          sb.from("auto_heal_log").insert({
            action_type: "step_job_retry",
            trigger_source: "pipeline_runner",
            target_type: "package_step",
            target_id: packageId,
            result_status: "ok",
            result_detail: `${stepKey} job failed → re-queued (attempt ${stepAttempts + 1}/${MAX_STEP_RETRIES})`,
            metadata: { step: stepKey, attempt: stepAttempts + 1, error: errorMsg.slice(0, 500) },
          }),
        );

        await safeQuery(
          sb.from("course_packages")
            .update({ status: "building", last_error: `Step ${stepKey}: retry ${stepAttempts + 1}/${MAX_STEP_RETRIES}` })
            .eq("id", packageId),
        );

        await safeRpc(sb, "release_package_lease", { p_package_id: packageId, p_runner_id: runnerId });
        return { packageId, stepKey, auto_heal_retry: true, attempt: stepAttempts + 1, maxRetries: MAX_STEP_RETRIES };
      }

      // Retries exhausted
      console.error(`[runner] ❌ Step ${stepKey} failed after ${MAX_STEP_RETRIES} auto-heal retries: ${errorMsg}`);

      await safeRpc(sb, "step_fail", {
        p_package_id: packageId,
        p_step_key: stepKey,
        p_error: `Exhausted after ${MAX_STEP_RETRIES} retries: ${errorMsg}`,
      });

      await safeQuery(
        sb.from("package_steps")
          .update({ job_id: null })
          .eq("package_id", packageId)
          .eq("step_key", stepKey),
      );

      await safeQuery(
        sb.from("course_packages")
          .update({ status: "quality_gate_failed", last_error: `Step ${stepKey}: failed after ${MAX_STEP_RETRIES} retries` })
          .eq("id", packageId),
      );

      await safeRpc(sb, "release_package_lease", { p_package_id: packageId, p_runner_id: runnerId });
      return { packageId, stepKey, job_failed: true, retries_exhausted: true, error: errorMsg };
    }

    // Unknown job status
    await safeRpc(sb, "release_package_lease", { p_package_id: packageId, p_runner_id: runnerId });
    return { packageId, stepKey, jobStatus: job.status };
  }

  // ── ENQUEUE: Create a worker job ──
  if (nextAction.action === "enqueue") {
    const stepKey = nextAction.stepKey;
    const jobType = STEP_TO_JOB_TYPE[stepKey];
    const currentStep = (steps ?? []).find((s: StepRow) => s.step_key === stepKey);
    const stepMeta = currentStep?.meta;
    const batchCursor = (stepMeta?.batch_cursor as Record<string, unknown>) ?? null;

    // Backoff support: allow step meta to request delayed enqueue
    const retryAfterSec = typeof stepMeta?.retry_after_sec === "number" && stepMeta.retry_after_sec > 0
      ? Math.min(300, Math.max(5, Math.floor(stepMeta.retry_after_sec)))
      : 0;
    // ── FIX: Reset orphaned steps to 'queued' before re-enqueue ──
    // This prevents step_start from double-counting attempts on steps
    // that were stuck in 'running' or 'enqueued' without a valid job
    if (currentStep?.status === "running" || currentStep?.status === "enqueued") {
      console.warn(`[runner] Resetting orphaned step ${stepKey} (was ${currentStep.status}) → queued`);
      await safeQuery(
        sb.from("package_steps")
          .update({ status: "queued", job_id: null, runner_id: null, started_at: null })
          .eq("package_id", packageId)
          .eq("step_key", stepKey),
        "reset_orphan",
      );
    }

    // ── INTEGRITY GATE: block exam_pool if content not ready ──
    // Only applies to FULL track packages that have learning content steps.
    // Exam-First packages skip this check entirely (no lessons to validate).
    const hasActiveLearningContent = (steps ?? []).some((s: StepRow) => s.step_key === "generate_learning_content" && s.status !== "skipped");
    if (stepKey === "generate_exam_pool" && pkg.course_id && hasActiveLearningContent) {
      const { data: canProceed } = await sb.rpc("can_generate_exam_pool", {
        p_course_id: pkg.course_id,
      });
      if (!canProceed) {
        console.warn(`[runner] ⛔ Content integrity gate BLOCKED generate_exam_pool for ${shortId} — resetting generate_learning_content`);

        // First try auto-repair (clear flags on lessons that actually have content)
        const { data: repairResult } = await sb.rpc("repair_placeholder_lessons", {
          p_course_id: pkg.course_id,
        });
        const repaired = repairResult as { fixed_flags: number; still_empty: number; ready: boolean } | null;

        if (repaired?.ready) {
          console.log(`[runner] ✅ Auto-repair fixed ${repaired.fixed_flags} flags — content now ready, proceeding`);
        } else {
          // Still not ready — reset generate_learning_content to re-generate missing content
          await safeQuery(
            sb.from("package_steps").update({
              status: "queued",
              job_id: null,
              runner_id: null,
              started_at: null,
              last_error: `Integrity gate: ${repaired?.still_empty ?? '?'} lessons still empty — re-generating content`,
            }).eq("package_id", packageId).eq("step_key", "generate_learning_content"),
            "integrity_gate_reset_content",
          );
          // Reset this step too so it re-checks after content is done
          await safeQuery(
            sb.from("package_steps").update({
              status: "queued",
              job_id: null,
              runner_id: null,
              started_at: null,
              last_error: `Waiting for content integrity (${repaired?.still_empty ?? '?'} lessons empty)`,
            }).eq("package_id", packageId).eq("step_key", stepKey),
            "integrity_gate_reset_exam",
          );
          await safeQuery(
            sb.from("auto_heal_log").insert({
              action_type: "integrity_gate_block",
              trigger_source: "pipeline_runner",
              target_type: "package",
              target_id: packageId,
              result_status: "healed",
              result_detail: `Blocked exam_pool, reset generate_learning_content (${repaired?.still_empty} empty lessons, ${repaired?.fixed_flags} flags fixed)`,
            }),
            "log_integrity_gate",
          );
          await safeRpc(sb, "release_package_lease", { p_package_id: packageId, p_runner_id: runnerId });
          return { packageId, stepKey, integrity_gate_blocked: true, still_empty: repaired?.still_empty };
        }
      }
    }

    console.log(`[runner] Enqueuing ${jobType} for step ${stepKey} (pkg ${shortId})`);

    const payload: Record<string, unknown> = {
      package_id: packageId,
      course_id: pkg.course_id,
      curriculum_id: pkg.curriculum_id,
      certification_id: pkg.certification_id,
      mode,
      feature_flags: pkg.feature_flags ?? {},
    };
    if (batchCursor) payload.batch_cursor = batchCursor;
    // v4.1: Pass target_lf_ids from step meta (set by auto-heal for targeted re-seed)
    if (currentStep?.meta?.target_lf_ids && Array.isArray(currentStep.meta.target_lf_ids)) {
      payload.target_lf_ids = currentStep.meta.target_lf_ids;
      console.log(`[runner] 🎯 Injecting target_lf_ids (${currentStep.meta.target_lf_ids.length} LFs) into ${jobType} payload`);
    }

    // Sane max_attempts: expensive steps get 5, validation 3, default 10
    const STEP_MAX_ATTEMPTS: Partial<Record<StepKey, number>> = {
      generate_handbook: 5,
      generate_exam_pool: 5,
      generate_oral_exam: 5,
      generate_learning_content: 5,
      generate_lesson_minichecks: 5,
      scaffold_learning_course: 3,
      validate_blueprints: 3,
      validate_exam_pool: 3,
      validate_oral_exam: 3,
      validate_handbook: 3,
      validate_tutor_index: 3,
      validate_learning_content: 3,
      validate_lesson_minichecks: 3,
      elite_harden: 5,
      run_integrity_check: 3,
      quality_council: 3,
      auto_publish: 3,
    };
    const stepMaxAttempts = STEP_MAX_ATTEMPTS[stepKey] ?? 10;

    let jobId: string | null = null;
    let insertErr: { message?: string } | null = null;
    try {
      const inserted = await enqueueJob(sb, {
        job_type: jobType,
        payload,
        package_id: packageId,
        max_attempts: stepMaxAttempts,
        priority: 10,
        run_after: retryAfterSec > 0 ? new Date(Date.now() + retryAfterSec * 1000).toISOString() : null,
        batch_cursor: batchCursor,
      });
      jobId = inserted.id;
    } catch (e) {
      insertErr = { message: (e as Error).message };
    }

    if (insertErr) {
      if (insertErr.message?.includes("duplicate") || insertErr.message?.includes("unique")) {
        console.warn(`[runner] Job already enqueued for ${stepKey} — skipping`);
        const { data: existingJob } = await sb
          .from("job_queue")
          .select("id")
          .eq("job_type", jobType)
          .in("status", ["pending", "processing"])
          .contains("payload", { package_id: packageId })
          .limit(1)
          .maybeSingle();

        if (existingJob) {
          await safeQuery(
            sb.from("package_steps")
              .update({ status: "enqueued", job_id: existingJob.id, runner_id: runnerId })
              .eq("package_id", packageId)
              .eq("step_key", stepKey),
            "link_existing_job",
          );
        }
      } else {
        console.error(`[runner] Failed to enqueue job: ${insertErr.message}`);
        await safeRpc(sb, "release_package_lease", { p_package_id: packageId, p_runner_id: runnerId });
        return { packageId, error: insertErr.message };
      }
    } else {
      await safeQuery(
        sb.from("package_steps")
          .update({ status: "enqueued", job_id: jobId, runner_id: runnerId })
          .eq("package_id", packageId)
          .eq("step_key", stepKey),
        "set_enqueued",
      );
    }

    // BUG FIX: Do NOT call step_start here.
    // step_start transitions to 'running' and sets last_heartbeat_at = now().
    // But the job is only enqueued (pending), not yet processing.
    // If the job-runner takes minutes to pick it up, expire_stale_steps()
    // will falsely timeout the step. Instead, keep step as 'enqueued' and
    // only transition to 'running' during poll when job status = 'processing'.

    // Keep lease — slot stays occupied
    console.log(`[runner] 📤 Enqueued ${jobType} (job ${(jobId ?? "?").slice(0, 8)}) for ${shortId}`);
    return { packageId, stepKey, enqueued: true, jobId };
  }

  // Fallback
  await safeRpc(sb, "release_package_lease", { p_package_id: packageId, p_runner_id: runnerId });
  return { packageId, noop: true };
}

// ══════════════════════════════════════════════════════════════
// Backfill: Maintain a pool of TARGET_POOL_SIZE active packages
// When one finishes, enqueue exactly enough to refill the pool.
// ══════════════════════════════════════════════════════════════
const TARGET_POOL_SIZE = 10;

async function backfillPipelinePool(
  sb: ReturnType<typeof createClient>,
): Promise<number> {
  // Priority Gate: Don't backfill non-Top-30 while Top-30 are incomplete
  const { count: top30Incomplete } = await sb
    .from("course_packages")
    .select("id", { count: "exact", head: true })
    .lte("priority", 10)
    .not("status", "in", '("published","done")');

  if ((top30Incomplete ?? 0) > 0) {
    console.log(`[runner] 🚧 Top-30 gate: ${top30Incomplete} packages still incomplete — skipping backfill of lower-priority packages`);
    return 0;
  }

  // 1. Count currently active packages (queued, building, planning)
  const { count: activeCount } = await sb
    .from("course_packages")
    .select("id", { count: "exact", head: true })
    .in("status", ["queued", "building", "planning"]);

  const active = activeCount ?? 0;
  const slotsToFill = TARGET_POOL_SIZE - active;

  if (slotsToFill <= 0) {
    console.log(`[runner] Pool full: ${active} active packages (target ${TARGET_POOL_SIZE})`);
    return 0;
  }

  console.log(`[runner] Pool has ${active}/${TARGET_POOL_SIZE} — backfilling ${slotsToFill}`);

  // 2. Get catalog entries ordered by priority
  const { data: catalog } = await sb
    .from("certification_catalog")
    .select("id, title, slug, track, min_question_target, priority_score")
    .order("priority_score", { ascending: false })
    .limit(50);

  if (!catalog?.length) return 0;

  // 3. Get existing packages to skip already-produced certifications
  const { data: existingPackages } = await sb
    .from("course_packages")
    .select("title, status")
    .in("status", ["queued", "building", "done", "published", "planning", "failed"]);

  const existingTitles = new Set(
    (existingPackages ?? []).filter((p: { title: string | null }) => p.title).map((p: { title: string }) => p.title.toLowerCase()),
  );

  // 4. Get existing curricula
  const { data: existingCurricula } = await sb
    .from("curricula")
    .select("id, title, status");

  const curriculaByTitle = new Map<string, { id: string; status: string }>();
  for (const c of existingCurricula ?? []) {
    curriculaByTitle.set(c.title.toLowerCase(), { id: c.id, status: c.status });
  }

  // 5. Filter candidates
  const candidates = catalog.filter((c) => {
    const packageTitle = `ExamFit – ${c.title}`.toLowerCase();
    return !existingTitles.has(packageTitle);
  });

  if (candidates.length === 0) return 0;

  const toEnqueue = candidates.slice(0, slotsToFill);
  let enqueued = 0;

  for (const cert of toEnqueue) {
    const matchKey = cert.title.toLowerCase();
    const existingCurr = curriculaByTitle.get(matchKey) ||
      [...curriculaByTitle.entries()].find(([k]) => k.includes(matchKey) || matchKey.includes(k))?.[1];

    if (existingCurr?.status === "frozen") {
      const { count: pendingSetup } = await sb
        .from("job_queue")
        .select("id", { count: "exact", head: true })
        .eq("job_type", "setup_course_package")
        .in("status", ["pending", "processing"])
        .contains("payload", { curriculum_id: existingCurr.id });

      if ((pendingSetup ?? 0) === 0) {
        await sb.from("job_queue").insert({
          job_type: "setup_course_package",
          status: "pending",
          attempts: 0,
          max_attempts: 100,
          payload: {
            curriculum_id: existingCurr.id,
            catalog_id: cert.id,
            triggered_by: "pool_backfill",
            exam_target: cert.min_question_target || 1000,
          },
          run_after: new Date().toISOString(),
        });
        enqueued++;
        console.log(`[runner] 🏭 Backfill: "${cert.title}" (frozen curriculum)`);
      }
    } else if (!existingCurr) {
      const { count: pendingIngest } = await sb
        .from("job_queue")
        .select("id", { count: "exact", head: true })
        .eq("job_type", "package_curriculum_ingest")
        .in("status", ["pending", "processing"])
        .contains("payload", { catalog_id: cert.id });

      if ((pendingIngest ?? 0) === 0) {
        const { data: newCurr, error: currErr } = await sb
          .from("curricula")
          .insert({
            title: cert.title,
            status: "draft",
            certification_type: cert.track || "ausbildung",
            track: cert.track || "EXAM_FIRST",
          })
          .select("id")
          .single();

        if (!currErr && newCurr) {
          await sb.from("job_queue").insert({
            job_type: "package_curriculum_ingest",
            status: "pending",
            attempts: 0,
            max_attempts: 100,
            payload: {
              curriculum_id: newCurr.id,
              catalog_id: cert.id,
              certification_title: cert.title,
              triggered_by: "pool_backfill",
            },
            run_after: new Date().toISOString(),
          });
          enqueued++;
          console.log(`[runner] 🏭 Backfill: "${cert.title}" (new curriculum)`);
        }
      }
    }
  }

  if (enqueued > 0) {
    await sb.from("auto_heal_log").insert({
      action_type: "pool_backfill",
      trigger_source: "pipeline_runner",
      result_status: "ok",
      result_detail: `Backfilled ${enqueued} to maintain pool of ${TARGET_POOL_SIZE} (was ${active})`,
      metadata: { enqueued, active_before: active, target: TARGET_POOL_SIZE, candidates: toEnqueue.map((c) => c.title) },
    });
  }

  return enqueued;
}

// ══════════════════════════════════════════════════════════════
// ── Runner version & instance ID (for heartbeat + health) ──
const RUNNER_VERSION = "v3.1-hardened";
const RUNNER_INSTANCE_ID = `runner_${crypto.randomUUID().slice(0, 8)}`;

// MAIN: Multi-Slot Acquisition Loop
// ══════════════════════════════════════════════════════════════
Deno.serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response(null, { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // ── Health endpoint: GET ?health=1 or POST { health: true } ──
  const url = new URL(req.url);
  const isHealthCheck = url.searchParams.get("health") === "1";
  let bodyHealth = false;
  if (!isHealthCheck && req.method === "POST") {
    try {
      const cloned = req.clone();
      const b = await cloned.json();
      bodyHealth = b?.health === true || b?.dryRun === true;
    } catch { /* not JSON, proceed normally */ }
  }

  if (isHealthCheck || bodyHealth) {
    // Write heartbeat even on health check
    await safeRpc(sb, "upsert_worker_heartbeat", {
      p_worker_name: "pipeline-runner",
      p_instance_id: RUNNER_INSTANCE_ID,
      p_version: RUNNER_VERSION,
      p_processed_count: 0,
      p_metadata: { type: "health_check" },
    });
    return json({
      ok: true,
      health: true,
      version: RUNNER_VERSION,
      instance: RUNNER_INSTANCE_ID,
      timestamp: new Date().toISOString(),
    });
  }

  // Read max slots from config
  const { data: configRow } = await sb
    .from("ops_pipeline_config")
    .select("value")
    .eq("key", "max_concurrent_packages")
    .maybeSingle();
  // Turbo: Default 5 concurrent packages (was 3) — configurable via ops_pipeline_config
  const maxSlots = parseInt(configRow?.value ?? "5", 10);

  const results: Record<string, unknown>[] = [];
  const processedPackageIds = new Set<string>();

  try {
    // Loop: try to acquire up to maxSlots packages
    for (let slot = 0; slot < maxSlots; slot++) {
      const runnerId = `runner_${crypto.randomUUID().slice(0, 8)}`;

      // Lease duration: 120s (not 600s) — prevents poll starvation.
      const { data: pkgId, error: acquireErr } = await sb.rpc(
        "acquire_next_package_lease",
        { p_runner_id: runnerId, p_lease_seconds: 120 },
      );

      if (acquireErr) {
        const msg = acquireErr.message || "unknown acquire error";
        console.error(`[runner] acquire error on slot ${slot}:`, msg);

        // Self-heal path: stale/non-building lease drift should not stall all slots
        if (msg.includes("PACKAGE_LEASES_NON_BUILDING")) {
          await safeRpc(sb, "ops_hygiene_cleanup", {
            p_max_lease_cleanup: 100,
            p_max_job_cleanup: 200,
          });
          continue;
        }

        break;
      }

      if (!pkgId) {
        console.log(`[runner] No more packages available after ${slot} acquisitions`);
        break;
      }

      const packageId = String(pkgId);

      // ── DEDUP: Skip if already processed in this invocation ──
      if (processedPackageIds.has(packageId)) {
        console.warn(`[runner] Slot ${slot + 1}: package ${packageId.slice(0, 8)} already processed this invocation — releasing duplicate lease`);
        await safeRpc(sb, "release_package_lease", { p_package_id: packageId, p_runner_id: runnerId });
        continue;
      }
      processedPackageIds.add(packageId);

      console.log(`[runner] Acquired slot ${slot + 1}/${maxSlots}: package ${packageId.slice(0, 8)}`);

      const result = await processPackage(sb, packageId, runnerId);
      results.push({ slot: slot + 1, ...result });
    }

    // ── Write heartbeat after processing ──
    const lastErr = results.find(r => (r as Record<string,unknown>).error)
      ? String((results.find(r => (r as Record<string,unknown>).error) as Record<string,unknown>).error)
      : null;
    await safeRpc(sb, "upsert_worker_heartbeat", {
      p_worker_name: "pipeline-runner",
      p_instance_id: RUNNER_INSTANCE_ID,
      p_version: RUNNER_VERSION,
      p_processed_count: results.length,
      p_last_error: lastErr,
      p_metadata: { slots_used: results.length, max_slots: maxSlots },
    });

    if (results.length === 0) {
      return json({ ok: true, idle: true, reason: "no_claimable_packages_or_slots_full" });
    }

    console.log(`[runner] Processed ${results.length} package(s) in this invocation`);
    return json({ ok: true, processed: results.length, version: RUNNER_VERSION, results });

  } catch (e: unknown) {
    const msg = (e as Error)?.message || String(e);
    console.error("[runner] Fatal:", msg);
    // Write error heartbeat
    await safeRpc(sb, "upsert_worker_heartbeat", {
      p_worker_name: "pipeline-runner",
      p_instance_id: RUNNER_INSTANCE_ID,
      p_version: RUNNER_VERSION,
      p_processed_count: 0,
      p_last_error: msg,
      p_metadata: { fatal: true },
    });
    return json({ ok: false, error: msg, version: RUNNER_VERSION }, 500);
  }
});
