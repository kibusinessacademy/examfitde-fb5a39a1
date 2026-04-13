/**
 * ops-step-orphan-healer  (v2)
 *
 * Cron-driven (every 5 min) self-healing function that detects and fixes
 * seven classes of pipeline stalls:
 *
 * 1. ORPHANED STEPS: step queued/failed with prereqs met, no active job → enqueue
 * 2. BLOCKED-WITHOUT-UPSTREAM: step blocked, no active upstream → skip
 * 3. ZERO-JOB GAPS: building package, queued steps, 0 jobs → enqueue first runnable
 * 4. EXHAUSTED-RETRY JOBS: failed jobs at max_attempts → cancel job, reset step → re-enqueue
 * 5. QG-FAILED AUTO-RETRY: package quality_gate_failed, 0 active jobs → set building, reset failed step
 * 6. STALE PROCESSING: job processing > 15min → fail job, reset step to queued
 * 7. HOLLOW DONE: step done but postcondition_verified != true → reset to queued
 */

import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import {
  STEP_TO_JOB_TYPE,
  PIPELINE_GRAPH,
  type PipelineStepKey,
} from "../_shared/job-map.ts";
import { enqueueJob } from "../_shared/enqueue.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

type HealPattern =
  | "orphaned_step"
  | "blocked_no_upstream"
  | "zero_jobs_gap"
  | "exhausted_retry"
  | "qg_failed_auto_retry"
  | "stale_processing"
  | "hollow_done";

interface HealAction {
  package_id: string;
  title: string;
  pattern: HealPattern;
  step_key: string;
  action: string;
  job_type?: string;
}

// Steps that MUST have postcondition_verified before being considered truly done
const HOLLOW_GUARD_STEPS = new Set([
  "generate_learning_content",
  "finalize_learning_content",
  "generate_exam_pool",
  "generate_lesson_minichecks",
  "generate_handbook",
  "generate_oral_exam",
  // NOTE: run_integrity_check REMOVED — governance step, must not be reset by healers
]);

// Governance steps: NEVER enqueued, reset, or skipped by this healer
const GOVERNANCE_STEPS = new Set([
  "run_integrity_check",
  "quality_council",
  "auto_publish",
]);
const GOVERNANCE_JOB_TYPES = new Set([
  "package_run_integrity_check",
  "package_quality_council",
  "package_auto_publish",
]);

// ── DAG helpers ──

function getPrereqs(stepKey: string): string[] {
  const node = PIPELINE_GRAPH.find((n) => n.key === stepKey);
  return node?.dependsOn ?? [];
}

function prereqsMet(stepKey: string, stepMap: Map<string, string>): boolean {
  return getPrereqs(stepKey).every((dep) => {
    const s = stepMap.get(dep);
    return s === "done" || s === "skipped";
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const actions: HealAction[] = [];
  const errors: string[] = [];

  try {
    // ════════════════════════════════════════════════
    // PATTERN 4: EXHAUSTED-RETRY JOBS (global, not per-package)
    //   HARDENED: skip governance job types
    // ════════════════════════════════════════════════
    try {
      const { data: exhausted } = await sb
        .from("job_queue")
        .select("id, job_type, package_id, attempts, max_attempts")
        .eq("status", "failed")
        .not("package_id", "is", null)
        .limit(50);

      if (exhausted?.length) {
        const atMax = exhausted.filter((j: any) => j.attempts >= (j.max_attempts || 5));
        for (const job of atMax) {
          // GOVERNANCE EXCLUSION
          if (GOVERNANCE_JOB_TYPES.has(job.job_type)) continue;
          try {
            // Cancel the exhausted job
            await sb
              .from("job_queue")
              .update({ status: "cancelled", completed_at: new Date().toISOString() })
              .eq("id", job.id)
              .eq("status", "failed");

            // Find and reset the corresponding step
            const stepKey = Object.entries(STEP_TO_JOB_TYPE).find(
              ([, jt]) => jt === job.job_type,
            )?.[0];

            if (stepKey && !GOVERNANCE_STEPS.has(stepKey)) {
              await sb
                .from("package_steps")
                .update({ status: "queued", updated_at: new Date().toISOString() })
                .eq("package_id", job.package_id)
                .eq("step_key", stepKey)
                .in("status", ["failed", "running"]);

              actions.push({
                package_id: job.package_id,
                title: "",
                pattern: "exhausted_retry",
                step_key: stepKey,
                action: "cancel_and_reset",
                job_type: job.job_type,
              });
            }
          } catch (e) {
            errors.push(`Exhausted ${job.id.slice(0, 8)}: ${(e as Error).message}`);
          }
        }
      }
    } catch (e) {
      errors.push(`Exhausted-scan: ${(e as Error).message}`);
    }

    // ════════════════════════════════════════════════
    // PATTERN 5: QG-FAILED AUTO-RETRY
    // ════════════════════════════════════════════════
    try {
      const { data: qgFailed } = await sb
        .from("course_packages")
        .select("id, title, curriculum_id")
        .eq("status", "quality_gate_failed");

      if (qgFailed?.length) {
        for (const pkg of qgFailed) {
          // Check no active jobs exist
          const { data: active } = await sb
            .from("job_queue")
            .select("id")
            .eq("package_id", pkg.id)
            .in("status", ["pending", "processing"])
            .limit(1);

          if (active && active.length > 0) continue;

          // Find the failed step that caused QG failure
          const { data: failedSteps } = await sb
            .from("package_steps")
            .select("step_key, status")
            .eq("package_id", pkg.id)
            .eq("status", "failed");

          // Reset package to building
          await sb
            .from("course_packages")
            .update({ status: "building", blocked_reason: null })
            .eq("id", pkg.id);

          // Reset each failed step to queued
          if (failedSteps?.length) {
            for (const step of failedSteps) {
              await sb
                .from("package_steps")
                .update({ status: "queued", updated_at: new Date().toISOString() })
                .eq("package_id", pkg.id)
                .eq("step_key", step.step_key)
                .eq("status", "failed");

              actions.push({
                package_id: pkg.id,
                title: pkg.title ?? "",
                pattern: "qg_failed_auto_retry",
                step_key: step.step_key,
                action: "reset_to_building",
              });
            }
          } else {
            actions.push({
              package_id: pkg.id,
              title: pkg.title ?? "",
              pattern: "qg_failed_auto_retry",
              step_key: "package_status",
              action: "reset_to_building",
            });
          }
        }
      }
    } catch (e) {
      errors.push(`QG-failed scan: ${(e as Error).message}`);
    }

    // ════════════════════════════════════════════════
    // PATTERN 6: STALE PROCESSING JOBS (> 15 min)
    //   HARDENED: skip governance jobs, respect heartbeats
    // ════════════════════════════════════════════════
    try {
      const fifteenMinAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();
      const { data: stale } = await sb
        .from("job_queue")
        .select("id, job_type, package_id, started_at, last_heartbeat_at")
        .eq("status", "processing")
        .lt("started_at", fifteenMinAgo)
        .not("package_id", "is", null)
        .limit(30);

      if (stale?.length) {
        for (const job of stale) {
          // GOVERNANCE EXCLUSION
          if (GOVERNANCE_JOB_TYPES.has(job.job_type)) continue;
          // HEARTBEAT CHECK: skip if heartbeat is recent (<10min)
          if (job.last_heartbeat_at) {
            const hbAge = Date.now() - new Date(job.last_heartbeat_at).getTime();
            if (hbAge < 10 * 60_000) continue;
          }
          try {
            await sb
              .from("job_queue")
              .update({
                status: "failed",
                completed_at: new Date().toISOString(),
                error: `Stale processing > 15 min (started ${job.started_at})`,
              })
              .eq("id", job.id)
              .eq("status", "processing");

            const stepKey = Object.entries(STEP_TO_JOB_TYPE).find(
              ([, jt]) => jt === job.job_type,
            )?.[0];

            if (stepKey && !GOVERNANCE_STEPS.has(stepKey)) {
              await sb
                .from("package_steps")
                .update({ status: "queued", updated_at: new Date().toISOString() })
                .eq("package_id", job.package_id)
                .eq("step_key", stepKey)
                .eq("status", "running");

              actions.push({
                package_id: job.package_id,
                title: "",
                pattern: "stale_processing",
                step_key: stepKey,
                action: "fail_and_reset",
                job_type: job.job_type,
              });
            }
          } catch (e) {
            errors.push(`Stale ${job.id.slice(0, 8)}: ${(e as Error).message}`);
          }
        }
      }
    } catch (e) {
      errors.push(`Stale-scan: ${(e as Error).message}`);
    }

    // ════════════════════════════════════════════════
    // LOAD BUILDING PACKAGES (for patterns 1, 2, 3, 7)
    // ════════════════════════════════════════════════
    const { data: buildingPkgs, error: pkgErr } = await sb
      .from("course_packages")
      .select("id, title, curriculum_id, status")
      .eq("status", "building");

    if (pkgErr) throw pkgErr;
    if (!buildingPkgs?.length && actions.length === 0) {
      return respond({ ok: true, healed: 0, actions: [], message: "No building packages" });
    }

    for (const pkg of buildingPkgs ?? []) {
      try {
        const [stepsRes, jobsRes] = await Promise.all([
          sb
            .from("package_steps")
            .select("step_key, status, meta")
            .eq("package_id", pkg.id),
          sb
            .from("job_queue")
            .select("job_type, status")
            .eq("package_id", pkg.id)
            .in("status", ["pending", "processing"]),
        ]);

        if (stepsRes.error || !stepsRes.data?.length) continue;
        if (jobsRes.error) continue;

        const steps = stepsRes.data as Array<{ step_key: string; status: string; meta: any }>;
        const activeJobs = jobsRes.data as Array<{ job_type: string; status: string }>;

        const stepMap = new Map(steps.map((s) => [s.step_key, s.status]));
        const activeJobTypes = new Set(activeJobs.map((j) => j.job_type));

        // ── Pattern 7: HOLLOW DONE ──
        for (const step of steps) {
          if (step.status !== "done") continue;
          if (!HOLLOW_GUARD_STEPS.has(step.step_key)) continue;

          const verified = step.meta?.postcondition_verified === true;
          if (verified) continue;

          // Step is done but not verified → reset to queued
          try {
            await sb
              .from("package_steps")
              .update({
                status: "queued",
                updated_at: new Date().toISOString(),
                meta: { ...(step.meta || {}), hollow_reset_by: "ops-step-orphan-healer", hollow_reset_at: new Date().toISOString() },
              })
              .eq("package_id", pkg.id)
              .eq("step_key", step.step_key)
              .eq("status", "done");

            // Update stepMap for downstream patterns
            stepMap.set(step.step_key, "queued");

            actions.push({
              package_id: pkg.id,
              title: pkg.title ?? "",
              pattern: "hollow_done",
              step_key: step.step_key,
              action: "reset_to_queued",
            });
          } catch (e) {
            errors.push(`Hollow ${step.step_key} for ${pkg.id.slice(0, 8)}: ${(e as Error).message}`);
          }
        }

        // ── Pattern A: Orphaned steps ──
        //    HARDENED: skip governance steps
        for (const step of steps) {
          if (step.status !== "queued" && step.status !== "failed") continue;
          // GOVERNANCE EXCLUSION
          if (GOVERNANCE_STEPS.has(step.step_key)) continue;

          const jobType = STEP_TO_JOB_TYPE[step.step_key as PipelineStepKey];
          if (!jobType) continue;
          if (!prereqsMet(step.step_key, stepMap)) continue;
          if (activeJobTypes.has(jobType)) continue;

          try {
            await enqueueJob(sb, {
              job_type: jobType,
              payload: {
                package_id: pkg.id,
                source: "ops-step-orphan-healer",
                heal_pattern: "orphaned_step",
              },
              package_id: pkg.id,
              priority: 5,
            });

            actions.push({
              package_id: pkg.id,
              title: pkg.title ?? "",
              pattern: "orphaned_step",
              step_key: step.step_key,
              action: "enqueue",
              job_type: jobType,
            });
          } catch (e) {
            errors.push(`Enqueue ${jobType} for ${pkg.id.slice(0, 8)}: ${(e as Error).message}`);
          }
        }

        // ── Pattern B: Blocked without upstream ──
        //    HARDENED: skip governance steps
        for (const step of steps) {
          if (step.status !== "blocked") continue;
          // GOVERNANCE EXCLUSION
          if (GOVERNANCE_STEPS.has(step.step_key)) continue;

          const prereqs = getPrereqs(step.step_key);
          const allPrereqsTerminal = prereqs.every((dep) => {
            const s = stepMap.get(dep);
            return s === "done" || s === "skipped";
          });

          if (!allPrereqsTerminal) {
            const hasActiveUpstream = prereqs.some((dep) => {
              const depJobType = STEP_TO_JOB_TYPE[dep as PipelineStepKey];
              return depJobType && activeJobTypes.has(depJobType);
            });
            const hasWorkableUpstream = prereqs.some((dep) => {
              const s = stepMap.get(dep);
              return s === "queued" || s === "running" || s === "failed";
            });
            if (hasActiveUpstream || hasWorkableUpstream) continue;
          }

          try {
            await sb
              .from("package_steps")
              .update({
                status: "skipped",
                updated_at: new Date().toISOString(),
                meta: { skipped_by: "ops-step-orphan-healer", reason: "blocked_no_upstream" },
              })
              .eq("package_id", pkg.id)
              .eq("step_key", step.step_key)
              .eq("status", "blocked");

            actions.push({
              package_id: pkg.id,
              title: pkg.title ?? "",
              pattern: "blocked_no_upstream",
              step_key: step.step_key,
              action: "skip",
            });
          } catch (e) {
            errors.push(`Skip blocked ${step.step_key} for ${pkg.id.slice(0, 8)}: ${(e as Error).message}`);
          }
        }

        // ── Pattern C: Zero active jobs despite queued steps ──
        //    HARDENED: skip governance steps
        if (activeJobs.length === 0) {
          const queuedSteps = steps.filter((s) => s.status === "queued" || s.status === "failed");
          if (queuedSteps.length > 0) {
            for (const node of PIPELINE_GRAPH) {
              // GOVERNANCE EXCLUSION
              if (GOVERNANCE_STEPS.has(node.key)) continue;
              const currentStatus = stepMap.get(node.key);
              if (!currentStatus || currentStatus === "done" || currentStatus === "skipped" || currentStatus === "running") continue;
              if (currentStatus !== "queued" && currentStatus !== "failed") continue;
              if (!prereqsMet(node.key, stepMap)) continue;

              const jobType = STEP_TO_JOB_TYPE[node.key as PipelineStepKey];
              if (!jobType) continue;

              const alreadyHealed = actions.some(
                (a) => a.package_id === pkg.id && a.step_key === node.key,
              );
              if (alreadyHealed) break;

              try {
                await enqueueJob(sb, {
                  job_type: jobType,
                  payload: {
                    package_id: pkg.id,
                    source: "ops-step-orphan-healer",
                    heal_pattern: "zero_jobs_gap",
                  },
                  package_id: pkg.id,
                  priority: 3,
                });

                actions.push({
                  package_id: pkg.id,
                  title: pkg.title ?? "",
                  pattern: "zero_jobs_gap",
                  step_key: node.key,
                  action: "enqueue",
                  job_type: jobType,
                });
              } catch (e) {
                errors.push(`Zero-gap enqueue ${jobType} for ${pkg.id.slice(0, 8)}: ${(e as Error).message}`);
              }
              break;
            }
          }
        }
      } catch (e) {
        errors.push(`Package ${pkg.id.slice(0, 8)}: ${(e as Error).message}`);
      }
    }

    // ── Audit log ──
    if (actions.length > 0) {
      try {
        await sb.from("admin_actions").insert({
          action: "ops_step_orphan_heal",
          scope: "system",
          payload: {
            version: "v2",
            healed_count: actions.length,
            actions: actions.map((a) => ({
              pkg: a.package_id.slice(0, 8),
              title: a.title,
              pattern: a.pattern,
              step: a.step_key,
              action: a.action,
              job_type: a.job_type,
            })),
            errors: errors.length > 0 ? errors : undefined,
          },
          affected_ids: [...new Set(actions.map((a) => a.package_id))],
        });
      } catch (e) {
        console.error("[orphan-healer] Audit log failed:", (e as Error).message);
      }
    }

    console.log(
      `[ops-step-orphan-healer] ✅ Scanned ${(buildingPkgs ?? []).length} building + QG-failed packages, healed ${actions.length} items, ${errors.length} errors`,
    );

    return respond({
      ok: true,
      packages_scanned: (buildingPkgs ?? []).length,
      healed: actions.length,
      actions,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (e) {
    console.error("[ops-step-orphan-healer] Fatal:", (e as Error).message);
    return respond({ ok: false, error: (e as Error).message }, 500);
  }
});

function respond(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
