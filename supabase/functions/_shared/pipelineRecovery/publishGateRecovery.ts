import type { PackageSnapshot, JobSnapshot, RecoveryAction, RecoveryPlan, RecoveryCause } from "./contracts.ts";
import { RECOVERY_POLICY } from "./recoveryPolicy.ts";
import { riskFor } from "./recoveryRisk.ts";

const minutesSince = (now: string, t: string) =>
  (Date.parse(now) - Date.parse(t)) / 60000;

/**
 * Analyzes status='done' packages.
 * NEVER mutates integrity/council/publish — only enqueues re-audit steps.
 */
export function planPublishGateRecovery(
  now: string,
  pkgs: PackageSnapshot[],
  jobs: JobSnapshot[],
): RecoveryPlan[] {
  const plans: RecoveryPlan[] = [];
  const doneAge = RECOVERY_POLICY.done_pending_minutes;

  for (const p of pkgs) {
    if (p.status !== "done") continue;
    if (p.is_published) continue;
    if (minutesSince(now, p.updated_at) < doneAge) continue;

    const causes: RecoveryCause[] = [];
    const stepsToEnqueue: string[] = [];

    if (p.integrity_passed !== true) {
      causes.push("QUALITY_NOT_FINISHED");
      stepsToEnqueue.push("run_integrity_check");
    }
    if (p.council_approved !== true) {
      causes.push("COUNCIL_PENDING");
      stepsToEnqueue.push("quality_council");
    }
    if (causes.length === 0) {
      // integrity+council true but not published → projection lag
      causes.push("PROJECTION_PENDING");
    }

    // Skip if a re-audit job is already pending/processing for this package
    const hasOpenReaudit = jobs.some(
      (j) =>
        j.package_id === p.package_id &&
        ["package_run_integrity_check", "package_quality_council"].includes(j.job_type) &&
        ["pending", "processing"].includes(j.status),
    );

    const primaryCause = causes[0];
    const actions: RecoveryAction[] = hasOpenReaudit
      ? []
      : [
          {
            action_id: `done_reaudit:${p.package_id}`,
            package_id: p.package_id,
            action_type: stepsToEnqueue.length > 0 ? "enqueue_done_reaudit" : "diagnose_only",
            cause: primaryCause,
            reason: `Package status=done since ${Math.floor(minutesSince(now, p.updated_at))}min; causes=${causes.join(",")}`,
            steps_to_enqueue: stepsToEnqueue,
            metadata: { integrity_passed: p.integrity_passed, council_approved: p.council_approved },
            risk: riskFor(primaryCause),
            auto_executable: false,
          },
        ];

    plans.push({
      package_id: p.package_id,
      status_snapshot: p.status,
      causes,
      actions,
    });
  }
  return plans;
}
