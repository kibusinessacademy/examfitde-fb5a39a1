/**
 * PIPELINE.RECOVERY.OS.1 — Pure SSOT contracts
 * Side-effect free. No DB access. Deterministic.
 */
import { z } from "https://esm.sh/zod@3.23.8";

export const RecoveryCauseSchema = z.enum([
  "QUALITY_NOT_FINISHED",
  "COUNCIL_PENDING",
  "AUDIT_PENDING",
  "PROJECTION_PENDING",
  "PLANNING_WORKER_LOST",
  "PLANNING_DISPATCHER_OFF",
  "PLANNING_CLAIM_LOST",
  "PLANNING_HEARTBEAT_STALE",
  "PLANNING_JOB_TYPE_QUARANTINED",
  "PLANNING_POOL_MISMATCH",
  "PLANNING_HEALTHY_BUT_PENDING",
  "LF_REPAIR_LOOP",
  "PROVIDER_LOOP_GUARD",
  "PROVIDER_MAX_ATTEMPTS_EXHAUSTED",
  "STUDIUM_NO_WORKER",
  "STUDIUM_ROUTING_OFF",
  "QUALITY_NO_PROGRESS",
  "QUALITY_LOCKED_PENDING_FIX",
  "UNKNOWN",
]);
export type RecoveryCause = z.infer<typeof RecoveryCauseSchema>;

export const RecoveryActionTypeSchema = z.enum([
  "enqueue_done_reaudit",
  "restart_planning",
  "mark_manual_review_required",
  "propose_provider_fallback",
  "lock_bronze_review",
  "diagnose_only",
]);
export type RecoveryActionType = z.infer<typeof RecoveryActionTypeSchema>;


export const RecoveryRiskSchema = z.object({
  risk: z.number().min(0).max(1),
  confidence: z.number().min(0).max(1),
  impact: z.enum(["low", "medium", "high"]),
  expected_recovery: z.enum(["low", "medium", "high"]),
  false_positive_risk: z.number().min(0).max(1),
  operator_effort: z.enum(["low", "medium", "high"]),
});
export type RecoveryRisk = z.infer<typeof RecoveryRiskSchema>;

export const RecoveryActionSchema = z.object({
  action_id: z.string(),
  package_id: z.string().uuid().nullable(),
  action_type: RecoveryActionTypeSchema,
  cause: RecoveryCauseSchema,
  reason: z.string(),
  steps_to_enqueue: z.array(z.string()).default([]),
  metadata: z.record(z.unknown()).default({}),
  risk: RecoveryRiskSchema,
  auto_executable: z.literal(false), // SSOT: NEVER auto-execute
});
export type RecoveryAction = z.infer<typeof RecoveryActionSchema>;

export const RecoveryPlanSchema = z.object({
  package_id: z.string().uuid().nullable(),
  status_snapshot: z.string(),
  causes: z.array(RecoveryCauseSchema),
  actions: z.array(RecoveryActionSchema),
});
export type RecoveryPlan = z.infer<typeof RecoveryPlanSchema>;

export const RecoverySummarySchema = z.object({
  generated_at: z.string(),
  pipeline_health: z.enum(["ok", "degraded", "critical"]),
  stuck_planning_count: z.number().int().min(0),
  done_pending_count: z.number().int().min(0),
  lf_loop_count: z.number().int().min(0),
  provider_loop_count: z.number().int().min(0),
  studium_routing_issues: z.number().int().min(0),
  recoverable_count: z.number().int().min(0),
  manual_review_count: z.number().int().min(0),
  plans: z.array(RecoveryPlanSchema),
});
export type RecoverySummary = z.infer<typeof RecoverySummarySchema>;

/** Input snapshot shape (deterministic). All times ISO strings for purity. */
export interface PackageSnapshot {
  package_id: string;
  status: string;
  track: string | null;
  build_progress: number;
  integrity_passed: boolean | null;
  council_approved: boolean | null;
  council_approved_at: string | null;
  published_at: string | null;
  is_published: boolean | null;
  updated_at: string;
}
export interface JobSnapshot {
  job_type: string;
  status: string;
  package_id: string | null;
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  locked_by: string | null;
  updated_at: string;
}
export interface WorkerSnapshot {
  worker_id: string;
  job_types: string[];
  last_heartbeat_at: string;
}
export interface RecoveryInput {
  now: string;
  packages: PackageSnapshot[];
  jobs: JobSnapshot[];
  workers: WorkerSnapshot[];
}
