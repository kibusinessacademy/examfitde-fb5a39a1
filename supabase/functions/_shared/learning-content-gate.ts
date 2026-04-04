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

const DEFAULT_THRESHOLD_HEALTHY = 0.80;
const DEFAULT_THRESHOLD_SOFT_PASS = 0.70;
const DEFAULT_THRESHOLD_REPAIRABLE = 0.55;

// ── Classification ──

export interface GateThresholdOverrides {
  thresholdHealthy?: number;
  thresholdSoftPass?: number;
  thresholdRepairable?: number;
}

export function classifyLearningContent(
  snapshot: ValidationSnapshot,
  overrides?: GateThresholdOverrides,
): GateClassification {
  const THRESHOLD_HEALTHY = overrides?.thresholdHealthy ?? DEFAULT_THRESHOLD_HEALTHY;
  const THRESHOLD_SOFT_PASS = overrides?.thresholdSoftPass ?? DEFAULT_THRESHOLD_SOFT_PASS;
  const THRESHOLD_REPAIRABLE = overrides?.thresholdRepairable ?? DEFAULT_THRESHOLD_REPAIRABLE;
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

// ── Retry Guard (v2 — hardened) ──

export interface RetryGuardParams {
  previousFingerprint: string | null;
  currentFingerprint: string;
  previousGateClass: string | null;
  repairCompletedSinceLastValidation: boolean;
  /** Whether a repair job was enqueued since last validation */
  repairEnqueuedSinceLastValidation: boolean;
  /** Whether a repair job is currently active (pending/queued/processing) */
  repairInFlight: boolean;
}

/**
 * Determines if re-running the validator is worthwhile.
 * Prevents identical retries that burn attempts without progress.
 *
 * v2 hardening: refuses to silently skip when no repair mechanism
 * is active — forces the caller to enqueue repair instead of
 * letting the package hang in a "clean but stuck" state.
 */
export function shouldRetryValidation(params: RetryGuardParams): {
  retry: boolean;
  reason: "first_run" | "fingerprint_changed" | "repair_completed" | "repair_in_flight" | "repair_enqueued" | "no_repair_mechanism" | "same_fingerprint_blocking";
} {
  // First run or fingerprint changed → always retry
  if (!params.previousFingerprint) {
    return { retry: true, reason: "first_run" };
  }
  if (params.previousFingerprint !== params.currentFingerprint) {
    return { retry: true, reason: "fingerprint_changed" };
  }

  // Repair completed since last validation → retry to check repair effect
  if (params.repairCompletedSinceLastValidation) {
    return { retry: true, reason: "repair_completed" };
  }

  // Same fingerprint + non-passing gate class: check repair state
  const isBlockingGateClass =
    params.previousGateClass &&
    ["repair_required", "major_regeneration_required", "hard_fail"].includes(params.previousGateClass);

  if (!isBlockingGateClass) {
    // healthy or soft_pass — shouldn't normally retry, but allow it
    return { retry: true, reason: "first_run" };
  }

  // Blocking gate class with same fingerprint:
  // Only skip if repair is already in-flight or enqueued
  if (params.repairInFlight) {
    return { retry: false, reason: "repair_in_flight" };
  }
  if (params.repairEnqueuedSinceLastValidation) {
    return { retry: false, reason: "repair_enqueued" };
  }

  // CRITICAL: No repair mechanism active and content unchanged.
  // Return a special reason so the caller knows to force-enqueue repair.
  return { retry: false, reason: "no_repair_mechanism" };
}

// ── Fingerprint (v2 — strengthened) ──

/**
 * Creates a content fingerprint for change detection.
 * v2: includes materialized count, failed count, and placeholder count
 * for higher sensitivity to content state changes.
 */
export function buildContentFingerprint(params: {
  packageId: string;
  lessonCount: number;
  maxUpdatedAt: string | null;
  materializedCount: number;
  placeholderCount: number;
}): string {
  return [
    params.packageId,
    params.lessonCount,
    params.materializedCount,
    params.placeholderCount,
    params.maxUpdatedAt ?? "none",
  ].join(":");
}

// ── Downstream allowance (mirrors DB function fn_learning_content_allows_downstream) ──

export function learningContentAllowsDownstream(gateClass: LearningContentGateClass): boolean {
  return gateClass === "healthy" || gateClass === "soft_pass_with_debt";
}
