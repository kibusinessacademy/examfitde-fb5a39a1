/**
 * STORE.OPS.PREDICTION.OS.1 — Policy guard.
 *
 * Prediction never proposes actions or executes anything. This module guards
 * the planned operation inputs against forbidden action types and validates
 * structural invariants used by the predictor.
 */
import { FORBIDDEN_PREDICTION_ACTIONS, type PlannedOperation } from "./contracts.ts";

export interface PolicyResult {
  ok: boolean;
  violations: string[];
}

export function assertPlannedOperation(op: PlannedOperation): PolicyResult {
  const violations: string[] = [];
  if (!op.operation_key || op.operation_key.length === 0) {
    violations.push("operation_key_missing");
  }
  if (!Array.isArray(op.planned_action_types)) {
    violations.push("planned_action_types_invalid");
  } else {
    for (const a of op.planned_action_types) {
      const lower = String(a).toLowerCase();
      for (const f of FORBIDDEN_PREDICTION_ACTIONS) {
        if (lower === f || lower.includes(f)) {
          violations.push(`forbidden_action:${a}`);
          break;
        }
      }
    }
  }
  if (!Number.isFinite(op.expected_manifest_count) || op.expected_manifest_count < 0) {
    violations.push("expected_manifest_count_invalid");
  }
  return { ok: violations.length === 0, violations };
}

export function isForbiddenAction(action: string): boolean {
  const lower = String(action).toLowerCase();
  return FORBIDDEN_PREDICTION_ACTIONS.some((f) => lower === f || lower.includes(f));
}
