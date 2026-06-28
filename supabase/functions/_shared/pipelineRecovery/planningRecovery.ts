import type { PackageSnapshot, JobSnapshot, WorkerSnapshot, RecoveryAction, RecoveryPlan, RecoveryCause } from "./contracts.ts";
import { RECOVERY_POLICY } from "./recoveryPolicy.ts";
import { riskFor } from "./recoveryRisk.ts";

const minutesSince = (now: string, t: string) =>
  (Date.parse(now) - Date.parse(t)) / 60000;

export function planPlanningRecovery(
  now: string,
  pkgs: PackageSnapshot[],
  jobs: JobSnapshot[],
  workers: WorkerSnapshot[],
): RecoveryPlan[] {
  const plans: RecoveryPlan[] = [];
  const minAge = RECOVERY_POLICY.planning_stuck_minutes;
  const heartbeatMax = RECOVERY_POLICY.worker_heartbeat_stale_minutes;

  for (const p of pkgs) {
    if (p.status !== "planning") continue;
    if (Number(p.build_progress) > 0) continue;
    if (minutesSince(now, p.updated_at) < minAge) continue;

    const pkgJobs = jobs.filter((j) => j.package_id === p.package_id);
    const hasActiveProcessing = pkgJobs.some((j) => j.status === "processing");
    const hasLock = pkgJobs.some((j) => j.locked_by && j.status === "processing");
    if (hasActiveProcessing || hasLock) {
      plans.push({
        package_id: p.package_id,
        status_snapshot: p.status,
        causes: [],
        actions: [],
      });
      continue;
    }

    // Detect cause: any planning-capable worker alive?
    const freshWorkers = workers.filter(
      (w) => minutesSince(now, w.last_heartbeat_at) <= heartbeatMax,
    );
    const cause: RecoveryCause =
      freshWorkers.length === 0
        ? "PLANNING_DISPATCHER_OFF"
        : pkgJobs.length === 0
          ? "PLANNING_CLAIM_LOST"
          : "PLANNING_WORKER_LOST";

    const actions: RecoveryAction[] = [
      {
        action_id: `restart_planning:${p.package_id}`,
        package_id: p.package_id,
        action_type: "restart_planning",
        cause,
        reason: `planning idle ${Math.floor(minutesSince(now, p.updated_at))}min; fresh_workers=${freshWorkers.length}; pkg_jobs=${pkgJobs.length}`,
        steps_to_enqueue: ["scaffold_learning_course"],
        metadata: { track: p.track, fresh_workers: freshWorkers.length },
        risk: riskFor(cause),
        auto_executable: false,
      },
    ];

    plans.push({
      package_id: p.package_id,
      status_snapshot: p.status,
      causes: [cause],
      actions,
    });
  }
  return plans;
}
