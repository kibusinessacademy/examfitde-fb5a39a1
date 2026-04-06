/**
 * SSOT: QC Status eligibility constants (client-side mirror).
 *
 * Mirrors supabase/functions/_shared/qc-status.ts for use in
 * frontend validators, UI components, and client-side checks.
 *
 * See: docs/SSOT_VALIDATE_EXAM_POOL_GUARD.md
 */

/** QC statuses that count toward structural coverage metrics. */
export const QC_COVERAGE_ELIGIBLE: readonly string[] = ["approved", "tier1_passed"] as const;

/** QC statuses that represent terminal rejection. */
export const QC_TERMINAL_REJECTED: readonly string[] = ["rejected", "pruned_quality"] as const;

/** QC statuses that indicate unresolved quality issues. */
export const QC_UNRESOLVED: readonly string[] = ["tier1_failed", "needs_revision"] as const;

/** Check if a qc_status is coverage-eligible. */
export function isCoverageEligible(qcStatus: string | null | undefined, status?: string | null): boolean {
  if (qcStatus && (QC_COVERAGE_ELIGIBLE as readonly string[]).includes(qcStatus)) return true;
  if (!qcStatus && status === "approved") return true;
  return false;
}
