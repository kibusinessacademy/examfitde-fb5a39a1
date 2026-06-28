/**
 * PIPELINE.RECOVERY.OS.2 — Outcome verification (pure SSOT, edge mirror).
 * Mirror of src/lib/pipelineRecovery/runOutcome.ts (deterministic, no I/O).
 */
import type { RecoveryActionType } from "./contracts.ts";

export type VerificationStatus =
  | "pending_verification"
  | "verified_success"
  | "verified_no_change"
  | "verified_regressed"
  | "verification_timeout"
  | "skipped";

export interface PackageStateProbe {
  package_id: string;
  status: string;
  build_progress: number;
  integrity_passed: boolean | null;
  council_approved: boolean | null;
  is_published: boolean | null;
  updated_at: string;
}

export interface JobStateProbe {
  job_type: string;
  status: string;
  attempts: number;
  updated_at: string;
}

export interface OutcomeProbe {
  pkg_before: PackageStateProbe | null;
  pkg_after: PackageStateProbe | null;
  jobs_before: JobStateProbe[];
  jobs_after: JobStateProbe[];
  quarantined_after?: boolean;
}

export interface OutcomeVerdict {
  status: VerificationStatus;
  reason: string;
  signals: Record<string, unknown>;
}

const VERIFICATION_GRACE_MS = 60_000;

export function classifyOutcome(
  actionType: RecoveryActionType,
  probe: OutcomeProbe,
  actionExecutedAt: string,
  observedAt: string,
): OutcomeVerdict {
  const ageMs = new Date(observedAt).getTime() - new Date(actionExecutedAt).getTime();
  if (Number.isFinite(ageMs) && ageMs < VERIFICATION_GRACE_MS) {
    return { status: "pending_verification", reason: "grace_window", signals: { age_ms: ageMs } };
  }
  switch (actionType) {
    case "enqueue_done_reaudit": return classifyReaudit(probe);
    case "restart_planning": return classifyRestart(probe);
    case "mark_manual_review_required": return classifyManualReview(probe);
    case "propose_provider_fallback": return { status: "verified_success", reason: "proposal_recorded", signals: {} };
    case "diagnose_only": return { status: "skipped", reason: "diagnose_only", signals: {} };
    default: return { status: "pending_verification", reason: "unknown_action", signals: {} };
  }
}

function classifyReaudit(p: OutcomeProbe): OutcomeVerdict {
  const before = p.jobs_before.filter((j) => j.job_type.startsWith("package_run_integrity") || j.job_type.startsWith("package_quality_council"));
  const after = p.jobs_after.filter((j) => j.job_type.startsWith("package_run_integrity") || j.job_type.startsWith("package_quality_council"));
  const newCompleted = after.filter((j) => j.status === "completed" || j.status === "succeeded").length;
  const newPending = after.filter((j) => j.status === "pending" || j.status === "processing").length;
  if (newCompleted > before.filter((j) => j.status === "completed" || j.status === "succeeded").length) {
    return { status: "verified_success", reason: "audit_jobs_completed", signals: { newCompleted } };
  }
  if (newPending > 0) return { status: "pending_verification", reason: "audit_jobs_running", signals: { newPending } };
  return { status: "verified_no_change", reason: "no_audit_progress", signals: {} };
}

function classifyRestart(p: OutcomeProbe): OutcomeVerdict {
  const beforeProgress = p.pkg_before?.build_progress ?? 0;
  const afterProgress = p.pkg_after?.build_progress ?? 0;
  if (p.pkg_after?.status === "building") {
    return { status: "verified_success", reason: "promoted_to_building", signals: { beforeProgress, afterProgress } };
  }
  if (afterProgress > beforeProgress) {
    return { status: "verified_success", reason: "progress_advanced", signals: { beforeProgress, afterProgress } };
  }
  const running = p.jobs_after.some((j) => j.job_type === "package_scaffold_learning_course" && (j.status === "pending" || j.status === "processing"));
  if (running) return { status: "pending_verification", reason: "scaffold_running", signals: {} };
  if (afterProgress < beforeProgress) {
    return { status: "verified_regressed", reason: "progress_dropped", signals: { beforeProgress, afterProgress } };
  }
  return { status: "verified_no_change", reason: "no_planning_progress", signals: { beforeProgress, afterProgress } };
}

function classifyManualReview(p: OutcomeProbe): OutcomeVerdict {
  if (p.quarantined_after) return { status: "verified_success", reason: "quarantine_recorded", signals: {} };
  return { status: "verified_no_change", reason: "no_quarantine_entry", signals: {} };
}

export interface RunOutcomeSummary {
  total: number; success: number; no_change: number; regressed: number;
  pending: number; skipped: number; success_rate: number;
  health: "verified" | "verified_partial" | "verified_regressed" | "verifying";
}

export function aggregateRunOutcome(verdicts: OutcomeVerdict[]): RunOutcomeSummary {
  const total = verdicts.length;
  const success = verdicts.filter((v) => v.status === "verified_success").length;
  const no_change = verdicts.filter((v) => v.status === "verified_no_change").length;
  const regressed = verdicts.filter((v) => v.status === "verified_regressed").length;
  const pending = verdicts.filter((v) => v.status === "pending_verification").length;
  const skipped = verdicts.filter((v) => v.status === "skipped" || v.status === "verification_timeout").length;
  const decided = success + no_change + regressed;
  const success_rate = decided === 0 ? 0 : success / decided;
  let health: RunOutcomeSummary["health"];
  if (pending > 0) health = "verifying";
  else if (regressed > 0) health = "verified_regressed";
  else if (success > 0 && no_change === 0) health = "verified";
  else health = "verified_partial";
  return { total, success, no_change, regressed, pending, skipped, success_rate, health };
}

export const RECOVERY_RUN_POLICY = {
  VERIFICATION_GRACE_MS,
  VERIFICATION_TIMEOUT_MS: 30 * 60 * 1000,
  MAX_ACTIONS_PER_RUN: 25,
} as const;
