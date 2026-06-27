/**
 * REVIEW.READY.GATE.OS.1 — Audit event builders (pure)
 */
import type { ReviewProjection } from "./contracts";

export type ReviewAuditEvent =
  | "review_started"
  | "review_finished"
  | "review_failed"
  | "review_ready"
  | "review_blocked";

export interface ReviewAuditPayload {
  event: ReviewAuditEvent;
  manifest_id: string | null;
  review_state: string | null;
  review_score: number | null;
  blocker_codes: string[];
  generated_at: string;
}

export function buildAuditPayload(
  event: ReviewAuditEvent,
  manifest_id: string | null,
  projection: ReviewProjection | null,
  evaluated_at: string,
): ReviewAuditPayload {
  return {
    event,
    manifest_id,
    review_state: projection?.review_state ?? null,
    review_score: projection?.review_score ?? null,
    blocker_codes: projection?.blockers.map((b) => b.code) ?? [],
    generated_at: projection?.generated_at ?? evaluated_at,
  };
}

export function eventForProjection(p: ReviewProjection): ReviewAuditEvent {
  if (p.review_state === "review_ready") return "review_ready";
  if (p.review_state === "blocked") return "review_blocked";
  return "review_finished";
}
