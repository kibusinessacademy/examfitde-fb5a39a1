/**
 * STORE.OPS.AUTOPILOT.OS.1 — Audit payload builders (pure).
 */
import type { AutopilotPlan, AutopilotProjection } from "./contracts.ts";

export type AutopilotAuditEventName =
  | "autopilot_planned"
  | "autopilot_started"
  | "autopilot_action_completed"
  | "autopilot_action_blocked"
  | "autopilot_finished";

export interface AutopilotAuditPayload {
  event: AutopilotAuditEventName;
  run_id: string;
  mode: string;
  risk_score: number;
  risk_level: string;
  safe_count?: number;
  manual_count?: number;
  blocked_count?: number;
  succeeded?: number;
  failed?: number;
  generated_at_reference: string;
}

export function buildPlanAudit(plan: AutopilotPlan): AutopilotAuditPayload {
  return {
    event: "autopilot_planned",
    run_id: plan.run_id,
    mode: plan.mode,
    risk_score: plan.risk_score,
    risk_level: plan.risk_level,
    safe_count: plan.safe_actions.length,
    manual_count: plan.manual_actions.length,
    blocked_count: plan.blocked_actions.length,
    generated_at_reference: plan.evaluated_at_reference,
  };
}

export function buildProjectionAudit(
  event: AutopilotAuditEventName,
  projection: AutopilotProjection,
): AutopilotAuditPayload {
  return {
    event,
    run_id: projection.run_id,
    mode: projection.mode,
    risk_score: projection.risk_score,
    risk_level: projection.risk_level,
    succeeded: projection.succeeded,
    failed: projection.failed,
    blocked_count: projection.blocked,
    generated_at_reference: projection.generated_at_reference,
  };
}
