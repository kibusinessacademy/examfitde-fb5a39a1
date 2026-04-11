import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { verifyGenerateLearningContentComplete, verifyFinalizeLearningContentComplete } from "../_shared/rootstep-verifier.ts";
import { markStepDone } from "../_shared/steps.ts";

/**
 * verifier-reconciler — Standalone Step Verifier (v2)
 *
 * Runs independently of pipeline-runner leases and WIP limits.
 * Checks building packages for steps that are materially complete
 * but have not been finalized due to verifier starvation.
 *
 * v2 changes:
 *   - DAG-ordered step processing (generate_learning_content before finalize)
 *   - Stale-processing exclusion from active-job count
 *   - Graceful prerequisite-block handling
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

// DAG-ordered: generate must finalize before finalize_learning_content
const ROOTSTEP_VERIFIERS = [
  { stepKey: "generate_learning_content", jobType: "package_generate_learning_content", verify: verifyGenerateLearningContentComplete },
  { stepKey: "finalize_learning_content", jobType: "package_finalize_learning_content", verify: verifyFinalizeLearningContentComplete },
] as const;

// deno-lint-ignore no-explicit-any
type SB = any;

/**
 * Count truly active jobs, excluding stale-locked ones (processing with lock_age > 3min)
 */
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
    // processing: only active if lock is fresh
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

      for (const v of ROOTSTEP_VERIFIERS) {
        const step = steps.find((s: { step_key: string }) => s.step_key === v.stepKey);
        if (!step) continue;
        // Only check non-terminal steps
        if (!["queued", "running", "enqueued"].includes(step.status)) {
          // If already done, record for DAG tracking
          if (step.status === "done") finalizedInThisPass.add(v.stepKey);
          continue;
        }

        try {
          const result = await v.verify(sb, packageId);

          // Always write current verifier state into meta (clears stale ready flags)
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

          // Write verifier result into step meta
          const currentMeta = (step.meta ?? {}) as Record<string, unknown>;
          const updatedMeta = {
            ...currentMeta,
            verifier_ready: true,
            verifier_reason: result.reason,
            verifier_snapshot: result.snapshot,
            verifier_checked_at: new Date().toISOString(),
            verifier_source: "standalone_reconciler",
          };

          await sb.from("package_steps").update({ meta: updatedMeta })
            .eq("package_id", packageId).eq("step_key", v.stepKey);

          // Count truly active jobs (excluding stale processing)
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

          // Finalize the step
          try {
            await markStepDone(sb, {
              packageId,
              stepKey: v.stepKey,
              meta: {
                ...updatedMeta,
                finalized_by: "verifier-reconciler",
                finalization_reason: result.reason,
                finalization_snapshot: result.snapshot,
                finalization_source: "standalone_reconciler",
              },
            });

            // Cancel remaining pending/failed jobs for this step
            await sb.from("job_queue").update({
              status: "cancelled",
              last_error: "verifier_reconciler_finalized",
              updated_at: new Date().toISOString(),
              locked_at: null,
              locked_by: null,
            })
              .eq("package_id", packageId)
              .eq("job_type", v.jobType)
              .in("status", ["pending", "failed"]);

            finalizedInThisPass.add(v.stepKey);
            console.log(`[verifier-reconciler] ✅ Finalized ${shortId}/${v.stepKey}: ${result.reason}`);
            results.push({ packageId, stepKey: v.stepKey, action: `finalized: ${result.reason}` });

            // Log to auto_heal_log
            await sb.from("auto_heal_log").insert({
              action_type: `reconciler_finalize_${v.stepKey}`,
              trigger_source: "verifier-reconciler",
              target_type: "course_package",
              target_id: packageId,
              result_status: "applied",
              result_detail: `Standalone verifier finalized ${v.stepKey}: ${result.reason}`,
              metadata: result.snapshot,
            });
          } catch (finalizeErr) {
            const msg = (finalizeErr as Error).message;
            // Gracefully handle prerequisite blocks — this is expected for DAG ordering
            if (msg.includes("verify MISMATCH") || msg.includes("rolled back by a trigger")) {
              console.warn(`[verifier-reconciler] ⏸️ Prereq-blocked ${shortId}/${v.stepKey}: upstream step not yet done — will retry next cycle`);
              results.push({ packageId, stepKey: v.stepKey, action: `prereq_blocked: awaiting upstream` });
            } else {
              console.warn(`[verifier-reconciler] ⛔ markStepDone blocked ${shortId}/${v.stepKey}: ${msg}`);
              results.push({ packageId, stepKey: v.stepKey, action: `blocked: ${msg.slice(0, 100)}` });
            }
          }
        } catch (vErr) {
          console.warn(`[verifier-reconciler] Error verifying ${shortId}/${v.stepKey}: ${(vErr as Error).message}`);
        }
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
