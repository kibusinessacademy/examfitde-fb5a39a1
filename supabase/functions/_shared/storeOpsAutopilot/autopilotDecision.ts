/**
 * STORE.OPS.AUTOPILOT.OS.1 — Decision helper (pure).
 *
 * Given a plan, decides what the executor is allowed to run. The executor must
 * call this; it MUST NOT decide on its own.
 */
import type {
  AutopilotAction,
  AutopilotMode,
  AutopilotPlan,
} from "./contracts.ts";

export interface AutopilotDecision {
  should_execute: boolean;
  executable_actions: AutopilotAction[];
  reason: string;
}

export function decideExecution(plan: AutopilotPlan, mode: AutopilotMode): AutopilotDecision {
  if (mode === "disabled") {
    return { should_execute: false, executable_actions: [], reason: "mode_disabled" };
  }
  if (mode === "recommend_only") {
    return { should_execute: false, executable_actions: [], reason: "recommend_only_mode" };
  }
  if (plan.safe_actions.length === 0) {
    return { should_execute: false, executable_actions: [], reason: "no_safe_actions" };
  }
  return {
    should_execute: true,
    executable_actions: plan.safe_actions,
    reason: mode === "maintenance" ? "maintenance_mode" : "safe_execute_mode",
  };
}
