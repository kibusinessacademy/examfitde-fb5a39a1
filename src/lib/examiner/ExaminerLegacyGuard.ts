/**
 * Phase 8.4 — Runtime Examiner Legacy / Drift Guard.
 */
import type { ExaminerConsciousness } from "./ExaminerConsciousness";

export type ExaminerDriftAuditType =
  | "examiner_surface_drift"
  | "examiner_legacy_logic_detected"
  | "examiner_snapshot_mismatch";

export interface DriftAuditEvent {
  type: ExaminerDriftAuditType;
  surface: string;
  details: Record<string, unknown>;
  at: string;
}

const _audit: DriftAuditEvent[] = [];
const MAX_AUDIT = 200;

export function recordDrift(event: Omit<DriftAuditEvent, "at">): void {
  _audit.push({ ...event, at: new Date().toISOString() });
  if (_audit.length > MAX_AUDIT) _audit.shift();
  if (typeof process !== "undefined" && process.env?.NODE_ENV !== "production") {
    // eslint-disable-next-line no-console
    console.warn(`[examiner-drift:${event.type}]`, event.surface, event.details);
  }
}

export function readDriftAudit(): readonly DriftAuditEvent[] {
  return _audit.slice();
}

export function assertSingleExaminerSource(surface: string, sources: number): void {
  if (sources !== 1) {
    recordDrift({ type: "examiner_legacy_logic_detected", surface, details: { reason: "multiple_examiner_sources", count: sources } });
  }
}

export function assertNoLocalVerdict(surface: string, hasLocalVerdict: boolean): void {
  if (hasLocalVerdict) {
    recordDrift({ type: "examiner_legacy_logic_detected", surface, details: { reason: "local_verdict_present" } });
  }
}

export function assertNoSurfaceRiskDrift(
  surfaceA: string,
  surfaceB: string,
  a: ExaminerConsciousness,
  b: ExaminerConsciousness,
): boolean {
  const drifts: string[] = [];
  if (a.authority.state !== b.authority.state) drifts.push("authority.state");
  if (a.deliberation.readiness_state !== b.deliberation.readiness_state) drifts.push("deliberation.readiness_state");
  if (Math.round(a.readiness) !== Math.round(b.readiness)) drifts.push("readiness");
  if (a.topRisks.length !== b.topRisks.length) drifts.push("topRisks.length");
  if (a.trend.direction !== b.trend.direction) drifts.push("trend.direction");
  if (drifts.length > 0) {
    recordDrift({ type: "examiner_surface_drift", surface: `${surfaceA}<>${surfaceB}`, details: { drifts } });
    return false;
  }
  return true;
}
