/**
 * STORE.PUBLISH.ORCHESTRATION.OS.1 — Release Policy (pure)
 */
import type { ReleasePolicyDecision, ReleasePolicyInput, ReleasePolicyBlockerCode } from "./contracts";

export function evaluateReleasePolicy(input: ReleasePolicyInput): ReleasePolicyDecision {
  const blockers: ReleasePolicyBlockerCode[] = [];
  if (!input.review_ready) blockers.push("REVIEW_NOT_READY");
  if (!input.build_current) blockers.push("BUILD_STALE");
  if (!input.hashes_current) blockers.push("HASH_DRIFT");
  if (!input.manifest_current) blockers.push("MANIFEST_STALE");
  if (!input.listings_current) blockers.push("LISTINGS_STALE");
  if (!input.smoke_current) blockers.push("SMOKE_STALE");
  if (!input.tests_current) blockers.push("TESTS_STALE");
  if (!input.known_limitations_accepted) blockers.push("KNOWN_LIMITATIONS_OPEN");
  return { approved_for_submission: blockers.length === 0, blockers };
}
