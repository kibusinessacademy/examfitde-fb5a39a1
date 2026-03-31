/**
 * SSOT Heal+Dispatch Helper
 *
 * Atomically heals a package (status → building) AND dispatches
 * the first runnable step as a job, AND creates a lease to prevent
 * the watchdog/acquire_v2 from reverting the package.
 *
 * Used by:
 *  - heal_non_building  (admin-ops-actions)
 *  - heal_finalization_stall (admin-ops-actions)
 */

import {
  PIPELINE_GRAPH,
  STEP_TO_JOB_TYPE,
  type PipelineStepKey,
} from "./job-map.ts";
import { enqueueJob } from "./enqueue.ts";
import { isRepairActionEligible } from "./repair-eligibility.ts";

// deno-lint-ignore no-explicit-any
type SB = any;

/** Lease duration for healed packages (10 minutes — enough for runner pickup) */
const HEAL_LEASE_SECONDS = 600;

export interface HealDispatchResult {
  package_id: string;
  status_healed: boolean;
  dispatched_step: string | null;
  dispatched_job_type: string | null;
  skip_reason?: string;
}

/**
 * For a given package, find the first step that is queued/failed
 * and whose DAG prerequisites are all done.
 */
function findFirstRunnableStep(
  steps: Array<{ step_key: string; status: string }>,
): PipelineStepKey | null {
  const stepStatusMap = new Map(steps.map(s => [s.step_key, s.status]));

  for (const node of PIPELINE_GRAPH) {
    const currentStatus = stepStatusMap.get(node.key);
    // Only target steps that need work
    if (!currentStatus || currentStatus === "done" || currentStatus === "skipped" || currentStatus === "running") {
      continue;
    }
    // Must be queued or failed (retriable)
    if (currentStatus !== "queued" && currentStatus !== "failed") continue;

    // Check all DAG prerequisites are done
    const prereqsMet = (node.dependsOn ?? []).every(dep => {
      const depStatus = stepStatusMap.get(dep);
      return depStatus === "done" || depStatus === "skipped";
    });

    if (prereqsMet) return node.key as PipelineStepKey;
  }
  return null;
}

/**
 * Get available WIP slots (respects ops_pipeline_config.wip_limit).
 */
async function getAvailableWipSlots(sb: SB): Promise<number> {
  let wipLimit = 25; // default
  try {
    const { data: cfg } = await sb
      .from("ops_pipeline_config")
      .select("value")
      .eq("key", "wip_limit")
      .maybeSingle();
    if (cfg?.value) wipLimit = parseInt(String(cfg.value), 10) || 25;
  } catch { /* use default */ }

  const { count: buildingCount } = await sb
    .from("course_packages")
    .select("id", { count: "exact", head: true })
    .eq("status", "building");

  return Math.max(0, wipLimit - (buildingCount ?? 0));
}

/**
 * Create a lease for a healed package so acquire_v2 doesn't reclaim it.
 */
async function createHealLease(sb: SB, packageId: string): Promise<void> {
  const leaseUntil = new Date(Date.now() + HEAL_LEASE_SECONDS * 1000).toISOString();
  await sb.from("package_leases").upsert({
    package_id: packageId,
    runner_id: "heal-dispatch",
    lease_until: leaseUntil,
    acquired_at: new Date().toISOString(),
  }, { onConflict: "package_id" });
}

/**
 * Heal a single package: set status to building + dispatch first runnable step + create lease.
 */
export async function healAndDispatchPackage(
  sb: SB,
  packageId: string,
  healReason: string,
): Promise<HealDispatchResult> {
  // 1. Fetch package metadata for enriched payload
  const { data: pkg, error: pkgErr } = await sb
    .from("course_packages")
    .select("id, status, curriculum_id")
    .eq("id", packageId)
    .maybeSingle();

  if (pkgErr || !pkg) {
    return { package_id: packageId, status_healed: false, dispatched_step: null, dispatched_job_type: null, skip_reason: "package_not_found" };
  }

  // 2. Fetch all steps for this package
  const { data: steps, error: stepsErr } = await sb
    .from("package_steps")
    .select("step_key, status")
    .eq("package_id", packageId);

  if (stepsErr || !steps?.length) {
    return { package_id: packageId, status_healed: false, dispatched_step: null, dispatched_job_type: null, skip_reason: "no_steps" };
  }

  // 3. Find the first runnable step
  const runnableStep = findFirstRunnableStep(steps);
  if (!runnableStep) {
    return { package_id: packageId, status_healed: false, dispatched_step: null, dispatched_job_type: null, skip_reason: "no_runnable_step" };
  }

  // 4. Resolve job type from SSOT
  const jobType = STEP_TO_JOB_TYPE[runnableStep];
  if (!jobType) {
    return { package_id: packageId, status_healed: false, dispatched_step: runnableStep, dispatched_job_type: null, skip_reason: "no_job_type_mapping" };
  }

  // 5. Check no active job already exists for this step+package
  const { data: existingJob } = await sb
    .from("job_queue")
    .select("id")
    .eq("package_id", packageId)
    .eq("job_type", jobType)
    .in("status", ["pending", "queued", "processing"])
    .limit(1)
    .maybeSingle();

  if (existingJob) {
    // Job already exists — ensure building status + lease
    await sb.from("course_packages").update({
      status: "building",
      blocked_reason: null,
      stuck_reason: null,
      updated_at: new Date().toISOString(),
    }).eq("id", packageId);
    await createHealLease(sb, packageId);

    return { package_id: packageId, status_healed: true, dispatched_step: runnableStep, dispatched_job_type: jobType, skip_reason: "job_already_active" };
  }

  // 6. Set package to building FIRST (so enqueue immutability guard passes) + create lease
  const now = new Date().toISOString();
  await sb.from("course_packages").update({
    status: "building",
    blocked_reason: null,
    stuck_reason: null,
    updated_at: now,
  }).eq("id", packageId);
  await createHealLease(sb, packageId);

  // 7. Reset the step to queued if it was failed
  const stepStatus = steps.find((s: { step_key: string }) => s.step_key === runnableStep)?.status;
  if (stepStatus === "failed") {
    await sb.from("package_steps").update({
      status: "queued",
      last_error: null,
      started_at: null,
      finished_at: null,
      updated_at: now,
    }).eq("package_id", packageId).eq("step_key", runnableStep);
  }

  // 8. Enqueue the job with enriched payload
  const jobPayload: Record<string, unknown> = { package_id: packageId };
  if (pkg.curriculum_id) jobPayload.curriculum_id = pkg.curriculum_id;

  try {
    await enqueueJob(sb, {
      job_type: jobType,
      payload: jobPayload,
      package_id: packageId,
      priority: 25, // elevated priority for healed packages
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : (typeof e === "object" && e !== null ? JSON.stringify(e) : String(e));
    console.warn(`[heal-dispatch] enqueue failed for ${packageId.slice(0, 8)} / ${jobType}: ${msg}`);
    return { package_id: packageId, status_healed: true, dispatched_step: runnableStep, dispatched_job_type: jobType, skip_reason: `enqueue_failed: ${msg}` };
  }

  return { package_id: packageId, status_healed: true, dispatched_step: runnableStep, dispatched_job_type: jobType };
}

/**
 * Batch heal+dispatch for multiple packages.
 * Respects WIP limit: only dispatches up to available slots.
 */
export async function batchHealAndDispatch(
  sb: SB,
  packageIds: string[],
  healReason: string,
  skipWipLimit = false,
): Promise<{ healed: HealDispatchResult[]; total: number; dispatched: number; skipped: number; wip_available: number }> {
  const results: HealDispatchResult[] = [];

  // Check available WIP slots (admin-triggered heals can bypass)
  const wipAvailable = await getAvailableWipSlots(sb);
  const maxDispatch = skipWipLimit ? packageIds.length : Math.min(packageIds.length, wipAvailable);

  if (maxDispatch <= 0) {
    return {
      healed: packageIds.map(pid => ({
        package_id: pid,
        status_healed: false,
        dispatched_step: null,
        dispatched_job_type: null,
        skip_reason: "wip_limit_reached",
      })),
      total: packageIds.length,
      dispatched: 0,
      skipped: packageIds.length,
      wip_available: 0,
    };
  }

  const toDispatch = packageIds.slice(0, maxDispatch);
  const skippedByWip = packageIds.slice(maxDispatch);

  for (const pid of toDispatch) {
    try {
      const r = await healAndDispatchPackage(sb, pid, healReason);
      results.push(r);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      results.push({ package_id: pid, status_healed: false, dispatched_step: null, dispatched_job_type: null, skip_reason: `error: ${msg}` });
    }
  }

  // Record skipped packages
  for (const pid of skippedByWip) {
    results.push({ package_id: pid, status_healed: false, dispatched_step: null, dispatched_job_type: null, skip_reason: "wip_limit_reached" });
  }

  return {
    healed: results,
    total: results.length,
    dispatched: results.filter(r => r.dispatched_job_type && !r.skip_reason).length,
    skipped: results.filter(r => !!r.skip_reason).length,
    wip_available: wipAvailable,
  };
}
