import type { JobSnapshot, RecoveryAction, RecoveryPlan, RecoveryCause } from "./contracts.ts";
import { RECOVERY_POLICY } from "./recoveryPolicy.ts";
import { riskFor } from "./recoveryRisk.ts";

export function planProviderFallback(
  _now: string,
  jobs: JobSnapshot[],
): RecoveryPlan[] {
  const allow = new Set<string>(RECOVERY_POLICY.provider_fallback_allowlist);
  const plans: RecoveryPlan[] = [];

  for (const j of jobs) {
    if (!allow.has(j.job_type)) continue;
    if (!j.package_id) continue;
    const err = j.last_error ?? "";
    const isLoop = err.includes("PROVIDER_LOOP_GUARD");
    const isExhausted = err.includes("MAX_ATTEMPTS_EXHAUSTED") || j.attempts >= j.max_attempts;
    if (!isLoop && !isExhausted) continue;

    const cause: RecoveryCause = isLoop ? "PROVIDER_LOOP_GUARD" : "PROVIDER_MAX_ATTEMPTS_EXHAUSTED";
    const actions: RecoveryAction[] = [
      {
        action_id: `provider_fallback:${j.package_id}:${j.job_type}`,
        package_id: j.package_id,
        action_type: "propose_provider_fallback",
        cause,
        reason: `Provider loop/exhaustion on ${j.job_type}; propose ${RECOVERY_POLICY.provider_fallback_model}`,
        steps_to_enqueue: [],
        metadata: {
          job_type: j.job_type,
          fallback_model: RECOVERY_POLICY.provider_fallback_model,
          attempts: j.attempts,
          max_attempts: j.max_attempts,
        },
        risk: riskFor(cause),
        auto_executable: false,
      },
    ];

    plans.push({
      package_id: j.package_id,
      status_snapshot: "building",
      causes: [cause],
      actions,
    });
  }
  return plans;
}
