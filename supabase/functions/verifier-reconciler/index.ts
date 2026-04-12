import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { verifyGenerateLearningContentComplete, verifyFinalizeLearningContentComplete } from "../_shared/rootstep-verifier.ts";
import { markStepDone } from "../_shared/steps.ts";

/**
 * verifier-reconciler — Standalone Step Verifier (v3)
 *
 * Runs independently of pipeline-runner leases and WIP limits.
 * Checks building packages for steps that are materially complete
 * but have not been finalized due to verifier starvation.
 *
 * v3 changes:
 *   - Added META_BASED_VERIFIERS for generate_blueprint_variants and other
 *     meta-gated steps that were causing Finalization Deadlocks
 *   - DAG-ordered: artifact verifiers run first, then meta-based
 *   - Unified audit logging
 *
 * Designed to run as a cron job every 2-3 minutes.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json; charset=utf-8" },
  });
}

// ═══════════════════════════════════════════════════════════════
// Layer 1: Artifact-based verifiers (deep DB checks)
// DAG-ordered: generate must finalize before finalize_learning_content
// ═══════════════════════════════════════════════════════════════
const ROOTSTEP_VERIFIERS = [
  { stepKey: "generate_learning_content", jobType: "package_generate_learning_content", verify: verifyGenerateLearningContentComplete },
  { stepKey: "finalize_learning_content", jobType: "package_finalize_learning_content", verify: verifyFinalizeLearningContentComplete },
] as const;

// ═══════════════════════════════════════════════════════════════
// Layer 2: Meta-based verifiers (meta.ok / meta.batch_complete)
// For steps where completion is signaled via meta flags but
// the step status never transitions to "done" — causing
// Finalization Deadlocks and infinite cancel loops.
// ═══════════════════════════════════════════════════════════════
interface MetaVerifier {
  stepKey: string;
  jobType: string;
  /** Additional child job types to check for in-flight work */
  childJobTypes?: string[];
  /** Check if meta indicates completion */
  isComplete: (meta: Record<string, unknown>) => { ok: boolean; reason: string };
}

/**
 * Standard meta-completion check: accepts both meta.ok=true AND meta.batch_complete=true
 * as valid completion signals. This prevents Finalization Deadlocks where the generator
 * writes batch_complete but not ok.
 */
function standardMetaCheck(meta: Record<string, unknown>): { ok: boolean; reason: string } {
  if (meta?.ok === true) return { ok: true, reason: "meta.ok=true" };
  if (meta?.batch_complete === true) return { ok: true, reason: "meta.batch_complete=true" };
  return { ok: false, reason: "meta.ok and meta.batch_complete both falsy" };
}

const META_BASED_VERIFIERS: MetaVerifier[] = [
  {
    stepKey: "generate_blueprint_variants",
    jobType: "package_generate_blueprint_variants",
    isComplete: standardMetaCheck,
  },
  {
    stepKey: "validate_blueprint_variants",
    jobType: "package_validate_blueprint_variants",
    isComplete: standardMetaCheck,
  },
  {
    stepKey: "promote_blueprint_variants",
    jobType: "package_promote_blueprint_variants",
    isComplete: standardMetaCheck,
  },
  {
    stepKey: "validate_exam_pool",
    jobType: "package_validate_exam_pool",
    isComplete: standardMetaCheck,
  },
  {
    stepKey: "generate_oral_exam",
    jobType: "package_generate_oral_exam",
    isComplete: standardMetaCheck,
  },
  {
    stepKey: "validate_oral_exam",
    jobType: "package_validate_oral_exam",
    isComplete: standardMetaCheck,
  },
  {
    stepKey: "generate_handbook",
    jobType: "package_generate_handbook",
    isComplete: standardMetaCheck,
  },
  {
    stepKey: "validate_handbook",
    jobType: "package_validate_handbook",
    isComplete: standardMetaCheck,
  },
  // ── Gate / integrity steps ──
  {
    stepKey: "run_integrity_check",
    jobType: "package_run_integrity_check",
    isComplete: standardMetaCheck,
  },
  {
    stepKey: "quality_council",
    jobType: "package_quality_council",
    isComplete: standardMetaCheck,
  },
  {
    stepKey: "auto_publish",
    jobType: "package_auto_publish",
    isComplete: standardMetaCheck,
  },
  {
    stepKey: "auto_seed_exam_blueprints",
    jobType: "package_auto_seed_exam_blueprints",
    isComplete: standardMetaCheck,
  },
  {
    stepKey: "generate_exam_pool",
    jobType: "package_generate_exam_pool",
    isComplete: standardMetaCheck,
  },
  {
    stepKey: "fanout_learning_content",
    jobType: "package_fanout_learning_content",
    childJobTypes: ["lesson_generate_content_shard"],
    isComplete: standardMetaCheck,
  },
  {
    stepKey: "validate_handbook_depth",
    jobType: "package_validate_handbook_depth",
    isComplete: standardMetaCheck,
  },
  {
    stepKey: "validate_lesson_minichecks",
    jobType: "package_validate_lesson_minichecks",
    isComplete: standardMetaCheck,
  },
  {
    stepKey: "validate_tutor_index",
    jobType: "package_validate_tutor_index",
    isComplete: standardMetaCheck,
  },
  {
    stepKey: "validate_learning_content",
    jobType: "package_validate_learning_content",
    isComplete: standardMetaCheck,
  },
  {
    stepKey: "repair_exam_pool_quality",
    jobType: "package_repair_exam_pool_quality",
    isComplete: standardMetaCheck,
  },
  {
    stepKey: "finalize_learning_content",
    jobType: "package_finalize_learning_content",
    isComplete: standardMetaCheck,
  },
  {
    stepKey: "enqueue_handbook_expand",
    jobType: "package_enqueue_handbook_expand",
    isComplete: standardMetaCheck,
  },
  {
    stepKey: "scaffold_learning_course",
    jobType: "package_scaffold_learning_course",
    isComplete: standardMetaCheck,
  },
  {
    stepKey: "elite_harden",
    jobType: "package_elite_harden",
    isComplete: standardMetaCheck,
  },
  {
    stepKey: "expand_handbook",
    jobType: "handbook_expand_section",
    isComplete: standardMetaCheck,
  },
  {
    stepKey: "generate_lesson_minichecks",
    jobType: "package_generate_lesson_minichecks",
    isComplete: standardMetaCheck,
  },
  {
    stepKey: "generate_glossary",
    jobType: "package_generate_glossary",
    isComplete: standardMetaCheck,
  },
  {
    stepKey: "build_ai_tutor_index",
    jobType: "package_build_ai_tutor_index",
    isComplete: standardMetaCheck,
  },
  {
    stepKey: "validate_blueprints",
    jobType: "package_validate_blueprints",
    isComplete: standardMetaCheck,
  },
  {
    stepKey: "exam_rebalance",
    jobType: "package_exam_rebalance",
    isComplete: standardMetaCheck,
  },
];

// deno-lint-ignore no-explicit-any
type SB = any;

/**
 * Count jobs that are genuinely in-flight (actively being processed RIGHT NOW).
 * Excludes:
 *   - pending/queued jobs (not running, verifier already confirmed artifacts)
 *   - processing jobs with stale locks (> 3 min = abandoned by runner)
 */
async function countInFlightJobs(sb: SB, packageId: string, jobType: string): Promise<number> {
  const { data: jobs } = await sb
    .from("job_queue")
    .select("id, status, locked_at")
    .eq("package_id", packageId)
    .eq("job_type", jobType)
    .in("status", ["processing", "running"]);

  if (!jobs || jobs.length === 0) return 0;

  const now = Date.now();
  const STALE_THRESHOLD_MS = 3 * 60_000;

  return jobs.filter((j: { status: string; locked_at: string | null }) => {
    if (j.status === "running") return true;
    if (!j.locked_at) return false;
    const lockAge = now - new Date(j.locked_at).getTime();
    return lockAge < STALE_THRESHOLD_MS;
  }).length;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const startMs = Date.now();
  const results: Array<{ packageId: string; stepKey: string; action: string }> = [];

  try {
    // Find ALL building/council_review packages — no lease required
    const { data: packages, error: pkgErr } = await sb
      .from("course_packages")
      .select("id")
      .in("status", ["building", "council_review"])
      .limit(100);

    if (pkgErr || !packages || packages.length === 0) {
      return json({ ok: true, idle: true, packages: 0, runtime_ms: Date.now() - startMs });
    }

    for (const pkg of packages) {
      const packageId = pkg.id;
      const shortId = packageId.slice(0, 8);

      // Load steps for this package
      const { data: steps } = await sb
        .from("package_steps")
        .select("step_key, status, meta")
        .eq("package_id", packageId);

      if (!steps) continue;

      // Track which steps we finalized in this pass (for DAG ordering)
      const finalizedInThisPass = new Set<string>();

      // ── Layer 1: Artifact-based root verifiers ──
      for (const v of ROOTSTEP_VERIFIERS) {
        const step = steps.find((s: { step_key: string }) => s.step_key === v.stepKey);
        if (!step) continue;
        if (!["queued", "running", "enqueued"].includes(step.status)) {
          if (step.status === "done") finalizedInThisPass.add(v.stepKey);
          continue;
        }

        try {
          const result = await v.verify(sb, packageId);

          // Always write current verifier state into meta
          const currentMeta = (step.meta ?? {}) as Record<string, unknown>;
          const metaUpdate = {
            ...currentMeta,
            verifier_ready: result.ready,
            verifier_reason: result.reason,
            verifier_snapshot: result.snapshot,
            verifier_checked_at: new Date().toISOString(),
            verifier_source: "standalone_reconciler",
          };
          await sb.from("package_steps").update({ meta: metaUpdate })
            .eq("package_id", packageId).eq("step_key", v.stepKey);

          if (!result.ready) {
            results.push({ packageId, stepKey: v.stepKey, action: `not_ready: ${result.reason}` });
            continue;
          }

          const activeChildren = await countInFlightJobs(sb, packageId, v.jobType);
          if (activeChildren > 0) {
            results.push({ packageId, stepKey: v.stepKey, action: `verifier_ready, ${activeChildren} truly active jobs remaining` });
            continue;
          }

          // Also check child job types for generate_learning_content
          if (v.stepKey === "generate_learning_content") {
            const childActive = await countInFlightJobs(sb, packageId, "lesson_generate_content")
              + await countInFlightJobs(sb, packageId, "lesson_generate_competency_bundle");
            if (childActive > 0) {
              results.push({ packageId, stepKey: v.stepKey, action: `verifier_ready, ${childActive} child jobs still active` });
              continue;
            }
          }

          // Finalize
          await finalizeStep(sb, packageId, shortId, v.stepKey, v.jobType, result.reason, result.snapshot, results, finalizedInThisPass);
        } catch (vErr) {
          console.warn(`[verifier-reconciler] Error verifying ${shortId}/${v.stepKey}: ${(vErr as Error).message}`);
        }
      }

      // ── Layer 2: Meta-based verifiers ──
      for (const mv of META_BASED_VERIFIERS) {
        const step = steps.find((s: { step_key: string }) => s.step_key === mv.stepKey);
        if (!step) continue;
        if (!["queued", "running", "enqueued"].includes(step.status)) {
          if (step.status === "done") finalizedInThisPass.add(mv.stepKey);
          continue;
        }

        const meta = (step.meta ?? {}) as Record<string, unknown>;
        const check = mv.isComplete(meta);

        if (!check.ok) continue; // Not ready per meta

        // Check no in-flight jobs
        const activeJobs = await countInFlightJobs(sb, packageId, mv.jobType);
        if (mv.childJobTypes) {
          for (const ct of mv.childJobTypes) {
            const c = await countInFlightJobs(sb, packageId, ct);
            if (c > 0) {
              results.push({ packageId, stepKey: mv.stepKey, action: `meta_ready but ${c} child jobs in ${ct}` });
              continue;
            }
          }
        }
        if (activeJobs > 0) {
          results.push({ packageId, stepKey: mv.stepKey, action: `meta_ready (${check.reason}), ${activeJobs} active jobs` });
          continue;
        }

        // Write verifier state + finalize
        const metaUpdate = {
          ...meta,
          verifier_ready: true,
          verifier_reason: check.reason,
          verifier_checked_at: new Date().toISOString(),
          verifier_source: "standalone_reconciler_meta",
        };
        await sb.from("package_steps").update({ meta: metaUpdate })
          .eq("package_id", packageId).eq("step_key", mv.stepKey);

        await finalizeStep(sb, packageId, shortId, mv.stepKey, mv.jobType, check.reason, { meta_check: check.reason }, results, finalizedInThisPass);
      }

      // Budget guard: don't exceed 50s
      if (Date.now() - startMs > 45_000) {
        console.warn(`[verifier-reconciler] Budget limit reached, stopping early`);
        break;
      }
    }
  } catch (e) {
    console.error(`[verifier-reconciler] Fatal: ${(e as Error).message}`);
    return json({ ok: false, error: (e as Error).message }, 500);
  }

  const runtimeMs = Date.now() - startMs;
  console.log(`[verifier-reconciler] Done: ${results.length} actions in ${runtimeMs}ms`);
  return json({ ok: true, actions: results.length, results, runtime_ms: runtimeMs });
});

/**
 * Shared finalization logic: markStepDone, cancel residual jobs, audit log.
 */
async function finalizeStep(
  sb: SB,
  packageId: string,
  shortId: string,
  stepKey: string,
  jobType: string,
  reason: string,
  snapshot: Record<string, unknown>,
  results: Array<{ packageId: string; stepKey: string; action: string }>,
  finalizedInThisPass: Set<string>,
) {
  try {
    await markStepDone(sb, {
      packageId,
      stepKey,
      meta: {
        verifier_ready: true,
        verifier_reason: reason,
        finalized_by: "verifier-reconciler",
        finalization_reason: reason,
        finalization_snapshot: snapshot,
        finalization_source: "standalone_reconciler",
      },
    });

    // Cancel remaining pending/failed jobs
    await sb.from("job_queue").update({
      status: "cancelled",
      last_error: "verifier_reconciler_finalized",
      updated_at: new Date().toISOString(),
      locked_at: null,
      locked_by: null,
    })
      .eq("package_id", packageId)
      .eq("job_type", jobType)
      .in("status", ["pending", "failed"]);

    finalizedInThisPass.add(stepKey);
    console.log(`[verifier-reconciler] ✅ Finalized ${shortId}/${stepKey}: ${reason}`);
    results.push({ packageId, stepKey, action: `finalized: ${reason}` });

    // Audit log
    await sb.from("auto_heal_log").insert({
      action_type: `reconciler_finalize_${stepKey}`,
      trigger_source: "verifier-reconciler",
      target_type: "course_package",
      target_id: packageId,
      result_status: "applied",
      result_detail: `Standalone verifier finalized ${stepKey}: ${reason}`,
      metadata: snapshot,
    });
  } catch (finalizeErr) {
    const msg = (finalizeErr as Error).message;
    if (msg.includes("verify MISMATCH") || msg.includes("rolled back by a trigger")) {
      console.warn(`[verifier-reconciler] ⏸️ Prereq-blocked ${shortId}/${stepKey}: upstream step not yet done — will retry next cycle`);
      results.push({ packageId, stepKey, action: `prereq_blocked: awaiting upstream` });
    } else {
      console.warn(`[verifier-reconciler] ⛔ markStepDone blocked ${shortId}/${stepKey}: ${msg}`);
      results.push({ packageId, stepKey, action: `blocked: ${msg.slice(0, 100)}` });
    }
  }
}
