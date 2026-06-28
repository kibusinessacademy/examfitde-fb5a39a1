import type { RecoveryCause, RecoveryRisk } from "./contracts.ts";

const TABLE: Record<RecoveryCause, RecoveryRisk> = {
  QUALITY_NOT_FINISHED:           { risk: 0.15, confidence: 0.95, impact: "medium", expected_recovery: "high", false_positive_risk: 0.05, operator_effort: "low" },
  COUNCIL_PENDING:                { risk: 0.10, confidence: 0.95, impact: "medium", expected_recovery: "high", false_positive_risk: 0.05, operator_effort: "low" },
  AUDIT_PENDING:                  { risk: 0.10, confidence: 0.90, impact: "low",    expected_recovery: "high", false_positive_risk: 0.05, operator_effort: "low" },
  PROJECTION_PENDING:             { risk: 0.20, confidence: 0.80, impact: "medium", expected_recovery: "medium", false_positive_risk: 0.10, operator_effort: "low" },
  PLANNING_WORKER_LOST:           { risk: 0.30, confidence: 0.85, impact: "high",   expected_recovery: "high", false_positive_risk: 0.10, operator_effort: "medium" },
  PLANNING_DISPATCHER_OFF:        { risk: 0.50, confidence: 0.70, impact: "high",   expected_recovery: "medium", false_positive_risk: 0.20, operator_effort: "high" },
  PLANNING_CLAIM_LOST:            { risk: 0.25, confidence: 0.80, impact: "medium", expected_recovery: "high", false_positive_risk: 0.10, operator_effort: "low" },
  LF_REPAIR_LOOP:                 { risk: 0.15, confidence: 0.95, impact: "high",   expected_recovery: "low",  false_positive_risk: 0.05, operator_effort: "high" },
  PROVIDER_LOOP_GUARD:            { risk: 0.20, confidence: 0.90, impact: "medium", expected_recovery: "medium", false_positive_risk: 0.10, operator_effort: "medium" },
  PROVIDER_MAX_ATTEMPTS_EXHAUSTED:{ risk: 0.25, confidence: 0.90, impact: "medium", expected_recovery: "medium", false_positive_risk: 0.10, operator_effort: "medium" },
  STUDIUM_NO_WORKER:              { risk: 0.60, confidence: 0.75, impact: "high",   expected_recovery: "low",  false_positive_risk: 0.20, operator_effort: "high" },
  STUDIUM_ROUTING_OFF:            { risk: 0.65, confidence: 0.70, impact: "high",   expected_recovery: "low",  false_positive_risk: 0.20, operator_effort: "high" },
  PLANNING_HEARTBEAT_STALE:       { risk: 0.45, confidence: 0.80, impact: "high",   expected_recovery: "medium", false_positive_risk: 0.15, operator_effort: "high" },
  PLANNING_JOB_TYPE_QUARANTINED:  { risk: 0.55, confidence: 0.90, impact: "high",   expected_recovery: "low",  false_positive_risk: 0.05, operator_effort: "high" },
  PLANNING_POOL_MISMATCH:         { risk: 0.40, confidence: 0.85, impact: "high",   expected_recovery: "medium", false_positive_risk: 0.10, operator_effort: "medium" },
  PLANNING_HEALTHY_BUT_PENDING:   { risk: 0.20, confidence: 0.60, impact: "medium", expected_recovery: "medium", false_positive_risk: 0.30, operator_effort: "low" },
  QUALITY_NO_PROGRESS:            { risk: 0.10, confidence: 0.90, impact: "low",    expected_recovery: "low",  false_positive_risk: 0.10, operator_effort: "medium" },
  QUALITY_LOCKED_PENDING_FIX:     { risk: 0.05, confidence: 0.95, impact: "low",    expected_recovery: "low",  false_positive_risk: 0.05, operator_effort: "medium" },
  UNKNOWN:                        { risk: 0.50, confidence: 0.30, impact: "medium", expected_recovery: "low",  false_positive_risk: 0.50, operator_effort: "high" },
};


export function riskFor(cause: RecoveryCause): RecoveryRisk {
  return TABLE[cause];
}
