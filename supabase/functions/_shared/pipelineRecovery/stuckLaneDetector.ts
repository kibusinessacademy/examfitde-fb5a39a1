import type { PackageSnapshot, WorkerSnapshot, RecoveryAction, RecoveryPlan, RecoveryCause } from "./contracts.ts";
import { RECOVERY_POLICY } from "./recoveryPolicy.ts";
import { riskFor } from "./recoveryRisk.ts";

const minutesSince = (now: string, t: string) =>
  (Date.parse(now) - Date.parse(t)) / 60000;

/**
 * STUDIUM lane: diagnose only. NEVER restarts blindly.
 */
export function diagnoseStudiumLane(
  now: string,
  pkgs: PackageSnapshot[],
  workers: WorkerSnapshot[],
): RecoveryPlan[] {
  const studiumPkgs = pkgs.filter((p) => p.track === "STUDIUM" && p.status !== "published" && !p.is_published);
  if (studiumPkgs.length === 0) return [];

  const studiumWorkers = workers.filter(
    (w) =>
      w.job_types.some((t) => t.includes("studium") || t.includes("learning")) &&
      minutesSince(now, w.last_heartbeat_at) <= RECOVERY_POLICY.worker_heartbeat_stale_minutes,
  );

  const cause: RecoveryCause = studiumWorkers.length === 0 ? "STUDIUM_NO_WORKER" : "STUDIUM_ROUTING_OFF";
  const stalled = studiumPkgs.filter((p) => minutesSince(now, p.updated_at) > 60);
  if (stalled.length === 0) return [];

  const action: RecoveryAction = {
    action_id: `studium_diagnose:${cause}`,
    package_id: null,
    action_type: "diagnose_only",
    cause,
    reason: `${stalled.length} STUDIUM packages stalled; fresh studium workers=${studiumWorkers.length}`,
    steps_to_enqueue: [],
    metadata: {
      stalled_count: stalled.length,
      stalled_ids: stalled.slice(0, 25).map((p) => p.package_id),
      fresh_workers: studiumWorkers.length,
    },
    risk: riskFor(cause),
    auto_executable: false,
  };

  return [
    {
      package_id: null,
      status_snapshot: "STUDIUM_LANE",
      causes: [cause],
      actions: [action],
    },
  ];
}
