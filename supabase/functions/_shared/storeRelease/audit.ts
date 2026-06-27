/**
 * STORE.PUBLISH.ORCHESTRATION.OS.1 — Audit event builders (pure)
 */
import type { ReleaseCandidate } from "./contracts";

export type ReleaseAuditEvent =
  | "candidate_created"
  | "candidate_invalidated"
  | "candidate_approved"
  | "submission_exported"
  | "submission_cancelled";

export interface ReleaseAuditPayload {
  event: ReleaseAuditEvent;
  candidate_id: string | null;
  manifest_id: string | null;
  version: string | null;
  reason: string | null;
  hashes: Record<string, string | null>;
  generated_at: string;
}

export function buildReleaseAuditPayload(
  event: ReleaseAuditEvent,
  candidate_id: string | null,
  candidate: ReleaseCandidate | null,
  generated_at: string,
  reason: string | null = null,
): ReleaseAuditPayload {
  return {
    event,
    candidate_id,
    manifest_id: candidate?.manifest_id ?? null,
    version: candidate?.version ?? null,
    reason,
    hashes: {
      package_hash: candidate?.package_hash ?? null,
      listing_hash: candidate?.listing_hash ?? null,
    },
    generated_at,
  };
}
