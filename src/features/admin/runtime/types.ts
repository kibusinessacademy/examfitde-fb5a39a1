/**
 * Phase 8 — Future Hooks (typed contracts only, not implemented).
 * Extension points for: rollback runner, auto-approval policies, simulations,
 * dry-runs, action replay, AI incident summaries, multi-operator approvals.
 */
export interface RuntimeActionHistoryRow {
  runtime_action_id: string;
  created_at: string;
  completed_at: string | null;
  operator: string | null;
  action_type: string;
  target_type: string | null;
  target_id: string | null;
  status: "pending" | "running" | "completed" | "failed" | "rolled_back" | "cancelled";
  risk_level: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  requires_second_confirm: boolean;
  rollback_supported: boolean;
  dangerous_action: boolean;
  idempotency_key: string | null;
  duration_ms: number | null;
  validation_status: "passed" | "failed" | "unknown";
  execution_status: "success" | "failed" | "cancelled" | "in_progress" | "unknown";
  rollback_available: boolean;
  rollback_ref: string | null;
  evidence_chain_id: string;
  snapshot_size_before: number;
  snapshot_size_after: number;
  mutation_count: number;
  warning_count: number;
  error_count: number;
  guard_fail_reason: string | null;
  result_summary: string | null;
  reason: string | null;
  severity: string | null;
  payload: Record<string, unknown> | null;
}

// Phase 8 stubs — contracts only
export interface RuntimeRollbackPlan { actionId: string; steps: string[]; dryRun: boolean }
export interface RuntimeAutoApprovalPolicy { actionKey: string; maxRisk: "LOW" | "MEDIUM"; window: string }
export interface RuntimeSimulationRequest { actionKey: string; payload: Record<string, unknown> }
export interface RuntimeIncidentSummary { actionId: string; summary: string; generatedAt: string }
export interface RuntimeMultiApproval { actionId: string; approvers: string[]; threshold: number }
