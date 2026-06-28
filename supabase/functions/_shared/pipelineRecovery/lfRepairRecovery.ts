import type { JobSnapshot, RecoveryAction, RecoveryPlan } from "./contracts.ts";
import { RECOVERY_POLICY } from "./recoveryPolicy.ts";
import { riskFor } from "./recoveryRisk.ts";

const LF_JOB = "package_repair_exam_pool_lf_coverage";

export function planLfRepairRecovery(
  _now: string,
  jobs: JobSnapshot[],
): RecoveryPlan[] {
  const byPkg = new Map<string, JobSnapshot[]>();
  for (const j of jobs) {
    if (j.job_type !== LF_JOB) continue;
    if (!j.package_id) continue;
    const arr = byPkg.get(j.package_id) ?? [];
    arr.push(j);
    byPkg.set(j.package_id, arr);
  }

  const plans: RecoveryPlan[] = [];
  for (const [pkgId, list] of byPkg) {
    const cycles = list.filter((j) =>
      ["failed", "killed", "exhausted"].includes(j.status) ||
      (j.last_error ?? "").includes("REQUEUE_LOOP_KILLED"),
    ).length;
    if (cycles < RECOVERY_POLICY.lf_max_repair_cycles) continue;

    const actions: RecoveryAction[] = [
      {
        action_id: `lf_manual_review:${pkgId}`,
        package_id: pkgId,
        action_type: "mark_manual_review_required",
        cause: "LF_REPAIR_LOOP",
        reason: `LF repair loop detected (${cycles} cycles ≥ ${RECOVERY_POLICY.lf_max_repair_cycles})`,
        steps_to_enqueue: [],
        metadata: { cycles, job_type: LF_JOB },
        risk: riskFor("LF_REPAIR_LOOP"),
        auto_executable: false,
      },
    ];

    plans.push({
      package_id: pkgId,
      status_snapshot: "building",
      causes: ["LF_REPAIR_LOOP"],
      actions,
    });
  }
  return plans;
}
