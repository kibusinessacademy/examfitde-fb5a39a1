/**
 * PIPELINE.RECOVERY.OS.3 — Quarantine Guard (Pure SSOT)
 * Side-effect free. Determines whether a package should be skipped by a worker
 * due to an active quarantine ledger entry.
 */

export interface QuarantineLedgerRow {
  package_id: string;
  reason_code: string;
  status: string; // 'under_review' | 'cleared' | other
}

export const QUARANTINE_BLOCK_REASONS = [
  "LF_REPAIR_LOOP",
  "MAX_ATTEMPTS_EXHAUSTED",
  "PROVIDER_LOOP_GUARD",
  "QUALITY_NO_PROGRESS",
] as const;

export type QuarantineBlockReason = (typeof QUARANTINE_BLOCK_REASONS)[number];

export function isQuarantineBlocking(row: Pick<QuarantineLedgerRow, "reason_code" | "status">): boolean {
  if (row.status !== "under_review") return false;
  return (QUARANTINE_BLOCK_REASONS as readonly string[]).includes(row.reason_code);
}

export interface QuarantineDecision {
  blocked: boolean;
  matched: QuarantineLedgerRow[];
}

export function evaluateQuarantine(
  packageId: string,
  ledger: QuarantineLedgerRow[],
  scope: readonly string[] = QUARANTINE_BLOCK_REASONS,
): QuarantineDecision {
  const matched = ledger.filter(
    (r) =>
      r.package_id === packageId &&
      r.status === "under_review" &&
      scope.includes(r.reason_code),
  );
  return { blocked: matched.length > 0, matched };
}
