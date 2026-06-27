/**
 * STORE.LIFECYCLE.OS.1 — Version policy (pure)
 */
import type { CandidateSnapshot } from "./contracts.ts";
import { classifyFeedback } from "./storeFeedback.ts";
import type { StoreFeedbackInput } from "./contracts.ts";

export type VersionAction =
  | "same_version_metadata_fix"
  | "new_build_required"
  | "new_candidate_required_for_hash_change"
  | "new_listing_version"
  | "new_build_reference"
  | "no_change";

export interface VersionDecisionInput {
  current: CandidateSnapshot;
  observed_manifest_hash: string | null;
  observed_listing_hash: string | null;
  observed_build_hash: string | null;
  observed_package_hash: string | null;
  curriculum_frozen: boolean;
  feedback: StoreFeedbackInput | null;
}

export interface VersionDecision {
  actions: VersionAction[];
  curriculum_change_blocked: boolean;
  reasons: string[];
}

export function decideVersionAction(input: VersionDecisionInput): VersionDecision {
  const actions: VersionAction[] = [];
  const reasons: string[] = [];

  const hashChanged =
    (input.observed_manifest_hash ?? null) !== (input.current.manifest_hash ?? null) ||
    (input.observed_package_hash ?? null) !== (input.current.package_hash ?? null);

  if (input.observed_listing_hash && input.observed_listing_hash !== input.current.listing_hash) {
    actions.push("new_listing_version");
    reasons.push("listing_hash drift");
  }
  if (input.observed_build_hash && input.observed_build_hash !== input.current.build_hash) {
    actions.push("new_build_reference");
    reasons.push("build_hash drift");
  }
  if (hashChanged) {
    actions.push("new_candidate_required_for_hash_change");
    reasons.push("manifest/package hash drift");
  }

  if (input.feedback) {
    const eff = classifyFeedback(input.feedback);
    if (eff.requires_new_binary) {
      actions.push("new_build_required");
      reasons.push("binary rejected by store");
    } else if (eff.requires_metadata_fix && !hashChanged) {
      actions.push("same_version_metadata_fix");
      reasons.push("metadata-only rejection");
    }
  }

  if (actions.length === 0) {
    actions.push("no_change");
  }

  return {
    actions,
    curriculum_change_blocked: input.curriculum_frozen,
    reasons,
  };
}
