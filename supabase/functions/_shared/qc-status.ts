/**
 * SSOT: QC Status eligibility constants.
 *
 * Central definition of which `qc_status` values count as
 * "coverage-eligible" (approved-equivalent) for structural metrics
 * like LF coverage, competency coverage, and pool sizing.
 *
 * ALL validators, RPCs, integrity checks, and repair heuristics
 * MUST use these constants instead of inline string arrays.
 *
 * See: docs/SSOT_VALIDATE_EXAM_POOL_GUARD.md
 * See: memory/architektur/qualitaets-management/exam-relevant-ssot-standard
 */

/** QC statuses that count toward structural coverage metrics (LF, competency, pool size). */
export const QC_COVERAGE_ELIGIBLE: readonly string[] = ["approved", "tier1_passed"] as const;

/** QC statuses that represent terminal rejection (excluded from unresolved counts). */
export const QC_TERMINAL_REJECTED: readonly string[] = ["rejected", "pruned_quality"] as const;

/** QC statuses that indicate unresolved quality issues needing repair. */
export const QC_UNRESOLVED: readonly string[] = ["tier1_failed", "needs_revision"] as const;

/**
 * Build a Supabase PostgREST `.or()` filter string for coverage-eligible questions.
 * Includes fallback for rows where qc_status is NULL but status is 'approved'.
 *
 * Usage: query.or(qcCoverageOrFilter())
 */
export function qcCoverageOrFilter(): string {
  return "qc_status.in.(approved,tier1_passed),and(qc_status.is.null,status.eq.approved)";
}

/**
 * Check if a given qc_status (with optional status fallback) is coverage-eligible.
 */
export function isCoverageEligible(qcStatus: string | null | undefined, status?: string | null): boolean {
  if (qcStatus && (QC_COVERAGE_ELIGIBLE as readonly string[]).includes(qcStatus)) return true;
  if (!qcStatus && status === "approved") return true;
  return false;
}
