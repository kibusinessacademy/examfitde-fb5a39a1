/**
 * SSOT: Learning Content Gate Classification
 *
 * Transforms validate_learning_content from a binary pass/fail gate
 * into a multi-class routing & repair gate.
 *
 * Gate classes:
 *   healthy                    → pass, continue DAG
 *   soft_pass_with_debt        → pass with quality debt flag, continue DAG
 *   repair_required            → enqueue targeted repair, don't retry validator
 *   major_regeneration_required → enqueue major regen, don't retry validator
 *   hard_fail                  → block pipeline (structural/SSOT failure)
 */

// ── Types ──

export type LearningContentGateClass =
  | "healthy"
  | "soft_pass_with_debt"
  | "repair_required"
  | "major_regeneration_required"
  | "hard_fail";

export type LearningContentRepairAction =
  | "none"
  | "enqueue_targeted_repair"
  | "enqueue_major_regeneration"
  | "block_pipeline";

export type LearningContentReasonCode =
  | "PASS"
  | "SOFT_PASS_QUALITY_DEBT"
  | "LOW_TIER1_RATE_REPAIRABLE"
  | "LOW_TIER1_RATE_MAJOR_REGEN"
  | "CATASTROPHIC_LESSON_GAPS"
  | "MISSING_REQUIRED_LESSON_CONTENT"
  | "INVALID_CONTENT_STRUCTURE"
  | "SSOT_REFERENCE_BROKEN"
  | "NO_MATERIALIZED_CONTENT"
  | "REPAIR_ALREADY_ENQUEUED";

export interface ValidationSnapshot {
  tier1PassRate: number;
  catastrophicFailures: number;
  materializedLessons: number;
  totalLessons: number;
  ssotBroken: boolean;
  invalidStructure: boolean;
}

export interface GateClassification {
  gateClass: LearningContentGateClass;
  repairAction: LearningContentRepairAction;
  reasonCode: LearningContentReasonCode;
  qualityDebt: boolean;
  /** Whether the DAG should continue (downstream steps allowed) */
  allowsDownstream: boolean;
}

// ── Thresholds (SSOT) ──

const THRESHOLD_HEALTHY = 0.80;
const THRESHOLD_SOFT_PASS = 0.70;
const THRESHOLD_REPAIRABLE = 0.55;

// ── Classification ──

export function classifyLearningContent(snapshot: ValidationSnapshot): GateClassification {
  const coverage =
    snapshot.totalLessons > 0
      ? snapshot.materializedLessons / snapshot.totalLessons
      : 0;

  // Hard fails: structural/SSOT issues that no amount of retry can fix
  if (snapshot.ssotBroken) {
    return {
      gateClass: "hard_fail",
      repairAction: "block_pipeline",
      reasonCode: "SSOT_REFERENCE_BROKEN",
      qualityDebt: false,
      allowsDownstream: false,
    };
  }

  if (snapshot.invalidStructure) {
    return {
      gateClass: "hard_fail",
      repairAction: "block_pipeline",
      reasonCode: "INVALID_CONTENT_STRUCTURE",
      qualityDebt: false,
      allowsDownstream: false,
    };
  }

  if (coverage < 0.8 && snapshot.materializedLessons === 0) {
    return {
      gateClass: "hard_fail",
      repairAction: "block_pipeline",
      reasonCode: "NO_MATERIALIZED_CONTENT",
      qualityDebt: false,
      allowsDownstream: false,
    };
  }

  if (snapshot.catastrophicFailures > 0) {
    return {
      gateClass: "hard_fail",
      repairAction: "block_pipeline",
      reasonCode: "CATASTROPHIC_LESSON_GAPS",
      qualityDebt: false,
      allowsDownstream: false,
    };
  }

  // Score-based routing
  if (snapshot.tier1PassRate >= THRESHOLD_HEALTHY) {
    return {
      gateClass: "healthy",
      repairAction: "none",
      reasonCode: "PASS",
      qualityDebt: false,
      allowsDownstream: true,
    };
  }

  if (snapshot.tier1PassRate >= THRESHOLD_SOFT_PASS) {
    return {
      gateClass: "soft_pass_with_debt",
      repairAction: "none",
      reasonCode: "SOFT_PASS_QUALITY_DEBT",
      qualityDebt: true,
      allowsDownstream: true,
    };
  }

  if (snapshot.tier1PassRate >= THRESHOLD_REPAIRABLE) {
    return {
      gateClass: "repair_required",
      repairAction: "enqueue_targeted_repair",
      reasonCode: "LOW_TIER1_RATE_REPAIRABLE",
      qualityDebt: true,
      allowsDownstream: false,
    };
  }

  return {
    gateClass: "major_regeneration_required",
    repairAction: "enqueue_major_regeneration",
    reasonCode: "LOW_TIER1_RATE_MAJOR_REGEN",
    qualityDebt: true,
    allowsDownstream: false,
  };
}

// ── Retry Guard ──

export interface RetryGuardParams {
  previousFingerprint: string | null;
  currentFingerprint: string;
  previousGateClass: string | null;
  repairCompletedSinceLastValidation: boolean;
}

/**
 * Determines if re-running the validator is worthwhile.
 * Prevents identical retries that burn attempts without progress.
 */
export function shouldRetryValidation(params: RetryGuardParams): boolean {
  // First run or fingerprint changed → always retry
  if (!params.previousFingerprint) return true;
  if (params.previousFingerprint !== params.currentFingerprint) return true;

  // Repair completed since last validation → retry to check repair effect
  if (params.repairCompletedSinceLastValidation) return true;

  // Same fingerprint + non-passing gate class → skip (no progress possible)
  if (
    params.previousGateClass &&
    ["repair_required", "major_regeneration_required", "hard_fail"].includes(params.previousGateClass)
  ) {
    return false;
  }

  return true;
}

// ── Fingerprint ──

/**
 * Creates a content fingerprint for change detection.
 * Uses lesson count + max updated_at as a lightweight proxy.
 */
export function buildContentFingerprint(params: {
  packageId: string;
  lessonCount: number;
  maxUpdatedAt: string | null;
}): string {
  return `${params.packageId}:${params.lessonCount}:${params.maxUpdatedAt ?? "none"}`;
}

// ── Downstream allowance (mirrors DB function fn_learning_content_allows_downstream) ──

export function learningContentAllowsDownstream(gateClass: LearningContentGateClass): boolean {
  return gateClass === "healthy" || gateClass === "soft_pass_with_debt";
}
