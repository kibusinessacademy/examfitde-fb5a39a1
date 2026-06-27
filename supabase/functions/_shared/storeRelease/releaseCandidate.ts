/**
 * STORE.PUBLISH.ORCHESTRATION.OS.1 — Release Candidate factory (pure)
 */
import type { ReleaseCandidate, ReleaseHashes } from "./contracts";

export interface ReleaseCandidateInput {
  manifest_id: string;
  product_id: string | null;
  curriculum_id: string | null;
  course_id: string | null;
  version: string;
  build_number: string | null;
  android_build_reference: string | null;
  ios_build_reference: string | null;
  smoke_version: string | null;
  review_gate_version: string | null;
  hashes: ReleaseHashes;
  created_at_reference: string;
}

export function buildReleaseCandidate(input: ReleaseCandidateInput): ReleaseCandidate {
  return {
    manifest_id: input.manifest_id,
    product_id: input.product_id,
    curriculum_id: input.curriculum_id,
    course_id: input.course_id,
    version: input.version,
    build_number: input.build_number,
    package_hash: input.hashes.package_hash,
    listing_hash: input.hashes.listing_hash,
    review_gate_version: input.review_gate_version,
    android_build_reference: input.android_build_reference,
    ios_build_reference: input.ios_build_reference,
    smoke_version: input.smoke_version,
    created_at_reference: input.created_at_reference,
  };
}

/** Compare hashes between current candidate and freshly-observed hashes. */
export function detectHashDrift(prev: ReleaseHashes, next: ReleaseHashes): Array<keyof ReleaseHashes> {
  const keys: Array<keyof ReleaseHashes> = [
    "manifest_hash",
    "listing_hash",
    "package_hash",
    "build_hash",
    "review_hash",
    "smoke_hash",
  ];
  return keys.filter((k) => (prev[k] ?? null) !== (next[k] ?? null));
}
