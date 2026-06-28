import type { RecoveryInput, RecoverySummary, RecoveryPlan } from "./contracts";
import { planPublishGateRecovery } from "./publishGateRecovery";
import { planPlanningRecovery } from "./planningRecovery";
import { planLfRepairRecovery } from "./lfRepairRecovery";
import { planProviderFallback } from "./providerFallback";
import { diagnoseStudiumLane } from "./stuckLaneDetector";

export function buildRecoverySummary(input: RecoveryInput): RecoverySummary {
  const { now, packages, jobs, workers } = input;

  const publishPlans = planPublishGateRecovery(now, packages, jobs);
  const planningPlans = planPlanningRecovery(now, packages, jobs, workers);
  const lfPlans = planLfRepairRecovery(now, jobs);
  const providerPlans = planProviderFallback(now, jobs);
  const studiumPlans = diagnoseStudiumLane(now, packages, workers);

  const plans: RecoveryPlan[] = [
    ...publishPlans,
    ...planningPlans,
    ...lfPlans,
    ...providerPlans,
    ...studiumPlans,
  ];

  const stuck_planning_count = planningPlans.filter((p) => p.actions.length > 0).length;
  const done_pending_count = publishPlans.filter((p) => p.actions.length > 0).length;
  const lf_loop_count = lfPlans.length;
  const provider_loop_count = providerPlans.length;
  const studium_routing_issues = studiumPlans.length;
  const manual_review_count = lfPlans.length;
  const recoverable_count =
    done_pending_count + stuck_planning_count + provider_loop_count;

  const critical = lf_loop_count > 5 || studium_routing_issues > 0;
  const degraded = recoverable_count > 0 || lf_loop_count > 0;
  const pipeline_health = critical ? "critical" : degraded ? "degraded" : "ok";

  return {
    generated_at: now,
    pipeline_health,
    stuck_planning_count,
    done_pending_count,
    lf_loop_count,
    provider_loop_count,
    studium_routing_issues,
    recoverable_count,
    manual_review_count,
    plans,
  };
}
