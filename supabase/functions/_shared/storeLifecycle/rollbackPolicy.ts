/**
 * STORE.LIFECYCLE.OS.1 — Rollback policy (pure)
 *
 * Rollback NEVER calls a Store API. It only proposes a previously-approved
 * candidate as the rollback target. A human still performs the manual rollback.
 */
import type { CandidateSnapshot, LifecycleState } from "./contracts.ts";

export type RollbackBlockerCode =
  | "NO_PRIOR_APPROVED"
  | "PRIOR_RETIRED"
  | "HASH_CHAIN_BROKEN"
  | "MANIFEST_MISMATCH"
  | "PRODUCT_MISMATCH"
  | "CURRICULUM_MISMATCH"
  | "MISSING_BUILD_SNAPSHOT"
  | "MISSING_LISTING_SNAPSHOT"
  | "MISSING_PACKAGE_SNAPSHOT";

export interface RollbackDecision {
  rollback_available: boolean;
  rollback_candidate_id: string | null;
  blockers: RollbackBlockerCode[];
}

export interface RollbackInput {
  current: CandidateSnapshot | null;
  history: ReadonlyArray<CandidateSnapshot>;
  current_state: LifecycleState;
}

/**
 * Pure: pick the most recent prior candidate that was approved or released externally.
 * `history` is expected to be ordered newest-first. We do NOT sort to avoid hidden RNG/clock.
 */
export function evaluateRollback(input: RollbackInput): RollbackDecision {
  const blockers: RollbackBlockerCode[] = [];

  const eligible = input.history.find(
    (c) =>
      c.candidate_id !== input.current?.candidate_id &&
      !c.retired &&
      (c.approved_externally || c.released_externally),
  );

  if (!eligible) {
    blockers.push("NO_PRIOR_APPROVED");
    return { rollback_available: false, rollback_candidate_id: null, blockers };
  }

  if (eligible.retired) blockers.push("PRIOR_RETIRED");

  if (input.current) {
    if (input.current.manifest_id !== eligible.manifest_id) blockers.push("MANIFEST_MISMATCH");
    if ((input.current.product_id ?? null) !== (eligible.product_id ?? null)) {
      blockers.push("PRODUCT_MISMATCH");
    }
    if ((input.current.curriculum_id ?? null) !== (eligible.curriculum_id ?? null)) {
      blockers.push("CURRICULUM_MISMATCH");
    }
  }

  if (!eligible.build_hash) blockers.push("MISSING_BUILD_SNAPSHOT");
  if (!eligible.listing_hash) blockers.push("MISSING_LISTING_SNAPSHOT");
  if (!eligible.package_hash) blockers.push("MISSING_PACKAGE_SNAPSHOT");

  // Hash chain check: each newer candidate must carry a non-null manifest_hash.
  for (const c of input.history) {
    if (!c.manifest_hash) {
      blockers.push("HASH_CHAIN_BROKEN");
      break;
    }
  }

  return {
    rollback_available: blockers.length === 0,
    rollback_candidate_id: blockers.length === 0 ? eligible.candidate_id : null,
    blockers,
  };
}
