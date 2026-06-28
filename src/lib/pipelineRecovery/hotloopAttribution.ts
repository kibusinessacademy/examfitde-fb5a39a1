/**
 * PIPELINE.RECOVERY.OS.3.1 — Hotloop Attribution (pure)
 *
 * Scope:
 * - Observability only. No worker change. No publish/gate mutation.
 * - Identifies LF jobs that were cancelled by the AUTO_HOTLOOP_QUARANTINE
 *   guard for packages currently under quarantine, and selects which of
 *   them still need an attribution row in `auto_heal_log` so the
 *   quarantine effect becomes visible in `lf_skipped_due_to_quarantine_6h`.
 *
 * Anti double-count contract:
 * - Each cancelled job_id may produce at most ONE attribution row.
 * - A job is skipped if any existing log row with action_type
 *   'skipped_due_to_quarantine' carries metadata.job_id === job.id
 *   (regardless of whether the worker gate or a prior attribution
 *   pass emitted it).
 */

export interface CancelledHotloopJob {
  id: string;
  package_id: string | null;
  cancel_reason: string | null;
}

export interface ExistingSkipLog {
  job_id: string | null;
}

export const HOTLOOP_TOKEN = "AUTO_HOTLOOP_QUARANTINE";
export const ATTRIBUTION_GUARD = "os3_1_attribution";
export const ATTRIBUTION_SOURCE = "hotloop_attribution";

export function isHotloopCancel(reason: string | null | undefined): boolean {
  return typeof reason === "string" && reason.includes(HOTLOOP_TOKEN);
}

export function pickJobsNeedingAttribution(
  candidates: CancelledHotloopJob[],
  existing: ExistingSkipLog[],
  quarantinedPackageIds: ReadonlySet<string>,
): CancelledHotloopJob[] {
  const seen = new Set<string>();
  for (const l of existing) {
    if (l.job_id) seen.add(l.job_id);
  }
  const out: CancelledHotloopJob[] = [];
  const emitted = new Set<string>();
  for (const j of candidates) {
    if (!j.id || emitted.has(j.id) || seen.has(j.id)) continue;
    if (!j.package_id || !quarantinedPackageIds.has(j.package_id)) continue;
    if (!isHotloopCancel(j.cancel_reason)) continue;
    out.push(j);
    emitted.add(j.id);
  }
  return out;
}

export function countHotloopCancelsForQuarantined(
  candidates: CancelledHotloopJob[],
  quarantinedPackageIds: ReadonlySet<string>,
): number {
  const seen = new Set<string>();
  for (const j of candidates) {
    if (!j.id || seen.has(j.id)) continue;
    if (!j.package_id || !quarantinedPackageIds.has(j.package_id)) continue;
    if (!isHotloopCancel(j.cancel_reason)) continue;
    seen.add(j.id);
  }
  return seen.size;
}
