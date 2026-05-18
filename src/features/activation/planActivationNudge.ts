/**
 * Activation Nudge Planner (Cut 1c)
 *
 * Pure helper. Decides which nudge a stale grant should receive.
 * Does NOT send notifications, does NOT mutate. Cut 1d will wire delivery.
 */

export type ActivationStage =
  | "grant_created"
  | "welcome_seen"
  | "first_minicheck_started"
  | "first_minicheck_completed"
  | "aha_completed"
  | "lernplan_started";

export type ActivationNudgeType =
  | "return_to_welcome"
  | "complete_aha"
  | "start_learning_plan"
  | "start_minicheck"
  | "none";

export interface ActivationGrantStatus {
  current_stage: ActivationStage;
  missing_next_step: string;
  is_stale_activation: boolean;
  blocked_reason?: string | null;
  minutes_since_grant?: number | null;
}

export interface ActivationNudgePlan {
  nudge_type: ActivationNudgeType;
  reason: string;
  /** Audit payload — safe to forward to fn_emit_audit('activation_nudge_planned', ...). */
  audit: {
    nudge_type: ActivationNudgeType;
    current_stage: ActivationStage;
    blocked_reason: string | null;
  };
}

export function planActivationNudge(status: ActivationGrantStatus): ActivationNudgePlan {
  const audit = (nudge_type: ActivationNudgeType): ActivationNudgePlan["audit"] => ({
    nudge_type,
    current_stage: status.current_stage,
    blocked_reason: status.blocked_reason ?? null,
  });

  if (!status.is_stale_activation) {
    return { nudge_type: "none", reason: "grant is on track", audit: audit("none") };
  }

  switch (status.current_stage) {
    case "grant_created":
      return { nudge_type: "return_to_welcome", reason: "Welcome page not opened", audit: audit("return_to_welcome") };
    case "welcome_seen":
    case "first_minicheck_started":
      return { nudge_type: "start_minicheck", reason: "MiniCheck not started/completed", audit: audit("start_minicheck") };
    case "first_minicheck_completed":
      return { nudge_type: "complete_aha", reason: "Aha feedback not viewed", audit: audit("complete_aha") };
    case "aha_completed":
      return { nudge_type: "start_learning_plan", reason: "Lernplan not started", audit: audit("start_learning_plan") };
    case "lernplan_started":
      return { nudge_type: "none", reason: "already activated", audit: audit("none") };
    default:
      return { nudge_type: "none", reason: "unknown stage", audit: audit("none") };
  }
}
