/**
 * ops-step-orphan-healer
 *
 * Cron-driven (every 5 min) self-healing function that detects and fixes
 * three classes of pipeline stalls:
 *
 * 1. ORPHANED STEPS: step_key queued/failed with all prereqs met,
 *    but no pending/processing job exists → enqueue missing job
 *
 * 2. BLOCKED-WITHOUT-UPSTREAM: step blocked, but no active upstream
 *    job or queued step can unblock it → skip step
 *
 * 3. AUTO_CANCEL GAPS: building package with queued steps but ZERO
 *    pending/processing jobs at all → bulk-enqueue first runnable
 *
 * Safe: all enqueues go through SSOT enqueueJob (dedupe, pool, guards).
 * Idempotent: re-running is harmless due to existing-job checks.
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

interface HealAction {
  package_id: string;
  title: string;
  pattern: "orphaned_step" | "blocked_no_upstream" | "zero_jobs_gap";
  step_key: string;
  action: "enqueue" | "skip";
  job_type?: string;
}

// ── DAG helpers ──

function getPrereqs(stepKey: string): string[] {
  const node = PIPELINE_GRAPH.find((n) => n.key === stepKey);
  return node?.dependsOn ?? [];
}

function prereqsMet(
  stepKey: string,
  stepMap: Map<string, string>,
): boolean {
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
    // ── 1. Load all building packages ──
    const { data: buildingPkgs, error: pkgErr } = await sb
      .from("course_packages")
      .select("id, title, curriculum_id, status")
      .eq("status", "building");

    if (pkgErr) throw pkgErr;
    if (!buildingPkgs?.length) {
      return respond({ ok: true, healed: 0, actions: [], message: "No building packages" });
    }

    // ── 2. For each package: load steps + active jobs ──
    for (const pkg of buildingPkgs) {
      try {
        const [stepsRes, jobsRes] = await Promise.all([
          sb
            .from("package_steps")
            .select("step_key, status")
            .eq("package_id", pkg.id),
          sb
            .from("job_queue")
            .select("job_type, status")
            .eq("package_id", pkg.id)
            .in("status", ["pending", "processing"]),
        ]);

        if (stepsRes.error || !stepsRes.data?.length) continue;
        if (jobsRes.error) continue;

        const steps = stepsRes.data as Array<{ step_key: string; status: string }>;
        const activeJobs = jobsRes.data as Array<{ job_type: string; status: string }>;

        const stepMap = new Map(steps.map((s) => [s.step_key, s.status]));
        const activeJobTypes = new Set(activeJobs.map((j) => j.job_type));

        // ── Pattern A: Orphaned steps (queued/failed + prereqs met + no active job) ──
        for (const step of steps) {
          if (step.status !== "queued" && step.status !== "failed") continue;

          const jobType = STEP_TO_JOB_TYPE[step.step_key as PipelineStepKey];
          if (!jobType) continue;

          // Prereqs must be met
          if (!prereqsMet(step.step_key, stepMap)) continue;

          // No active job for this step?
          if (activeJobTypes.has(jobType)) continue;

          // HEAL: enqueue missing job
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
            // enqueueJob may throw for valid reasons (already_published, etc.)
            errors.push(`Enqueue ${jobType} for ${pkg.id.slice(0, 8)}: ${(e as Error).message}`);
          }
        }

        // ── Pattern B: Blocked steps without any active upstream ──
        for (const step of steps) {
          if (step.status !== "blocked") continue;

          const prereqs = getPrereqs(step.step_key);
          // If all prereqs are terminal → step should not be blocked
          const allPrereqsTerminal = prereqs.every((dep) => {
            const s = stepMap.get(dep);
            return s === "done" || s === "skipped";
          });

          if (!allPrereqsTerminal) {
            // Check if any prereq has active jobs
            const hasActiveUpstream = prereqs.some((dep) => {
              const depJobType = STEP_TO_JOB_TYPE[dep as PipelineStepKey];
              return depJobType && activeJobTypes.has(depJobType);
            });

            // Check if any prereq is in a workable state
            const hasWorkableUpstream = prereqs.some((dep) => {
              const s = stepMap.get(dep);
              return s === "queued" || s === "running" || s === "failed";
            });

            if (hasActiveUpstream || hasWorkableUpstream) continue;
          }

          // All prereqs are terminal OR no upstream can unblock → skip this step
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
        if (activeJobs.length === 0) {
          const queuedSteps = steps.filter((s) => s.status === "queued" || s.status === "failed");
          if (queuedSteps.length > 0) {
            // Find first runnable step via DAG
            for (const node of PIPELINE_GRAPH) {
              const currentStatus = stepMap.get(node.key);
              if (!currentStatus || currentStatus === "done" || currentStatus === "skipped" || currentStatus === "running") continue;
              if (currentStatus !== "queued" && currentStatus !== "failed") continue;
              if (!prereqsMet(node.key, stepMap)) continue;

              const jobType = STEP_TO_JOB_TYPE[node.key as PipelineStepKey];
              if (!jobType) continue;

              // Already handled by Pattern A? Check actions
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

              break; // Only enqueue the first runnable step to avoid flooding
            }
          }
        }
      } catch (e) {
        errors.push(`Package ${pkg.id.slice(0, 8)}: ${(e as Error).message}`);
      }
    }

    // ── 3. Audit log ──
    if (actions.length > 0) {
      try {
        await sb.from("admin_actions").insert({
          action: "ops_step_orphan_heal",
          scope: "system",
          payload: {
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
      `[ops-step-orphan-healer] ✅ Scanned ${buildingPkgs.length} packages, healed ${actions.length} steps, ${errors.length} errors`,
    );

    return respond({
      ok: true,
      packages_scanned: buildingPkgs.length,
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
