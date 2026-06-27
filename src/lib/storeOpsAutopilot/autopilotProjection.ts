/**
 * STORE.OPS.AUTOPILOT.OS.1 — Projection (pure).
 */
import type {
  AutopilotExecutionResult,
  AutopilotPlan,
  AutopilotProjection,
} from "./contracts.ts";

export function projectAutopilot(
  plan: AutopilotPlan,
  results: AutopilotExecutionResult[],
  generated_at_reference: string,
): AutopilotProjection {
  const total = plan.safe_actions.length;
  const succeeded = results.filter((r) => r.status === "succeeded").length;
  const failed = results.filter((r) => r.status === "failed").length;
  const blocked = results.filter((r) => r.status === "blocked").length + plan.blocked_actions.length;
  const skipped = results.filter((r) => r.status === "skipped").length;
  const terminal = succeeded + failed + skipped;

  let state: AutopilotProjection["state"] = "planned";
  if (total === 0) state = "blocked";
  else if (terminal === 0) state = "planned";
  else if (terminal < total) state = "partially_completed";
  else if (failed === 0) state = "completed";
  else state = "partially_completed";

  return {
    run_id: plan.run_id,
    mode: plan.mode,
    state,
    total,
    succeeded,
    failed,
    blocked,
    skipped,
    risk_score: plan.risk_score,
    risk_level: plan.risk_level,
    generated_at_reference,
  };
}
