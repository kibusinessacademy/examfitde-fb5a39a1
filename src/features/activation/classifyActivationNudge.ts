/**
 * Activation Nudge Classifier (Cut 1d) — TS mirror of fn_classify_activation_nudge.
 * Pure, used for client-side preview/validation. SSOT remains the SQL function.
 */
export type NudgeStage =
  | "grant_created"
  | "welcome_seen"
  | "first_minicheck_started"
  | "first_minicheck_completed"
  | "aha_completed"
  | "lernplan_started";

export type NudgeType =
  | "welcome_not_started"
  | "first_task_missing"
  | "aha_missing"
  | "plan_missing"
  | "inactive_24h"
  | "none";

export function classifyActivationNudge(
  stage: NudgeStage,
  blockedReason: string | null,
): NudgeType {
  if (blockedReason === "no_first_value_after_24h") return "inactive_24h";
  if (stage === "grant_created") return "welcome_not_started";
  if (stage === "welcome_seen" || stage === "first_minicheck_started") return "first_task_missing";
  if (stage === "first_minicheck_completed") return "aha_missing";
  if (stage === "aha_completed") return "plan_missing";
  return "none";
}
