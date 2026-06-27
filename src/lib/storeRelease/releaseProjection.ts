/**
 * STORE.PUBLISH.ORCHESTRATION.OS.1 — Release projection (pure)
 */
import type {
  ReleaseCandidate,
  ReleaseHashes,
  ReleaseNextAction,
  ReleasePolicyDecision,
  ReleaseProjection,
  ReleaseState,
  ReleaseTimelineEvent,
} from "./contracts";
import { detectHashDrift } from "./releaseCandidate";
import { evaluateReleasePolicy } from "./releasePolicy";

export interface ReleaseProjectionInput {
  state: ReleaseState;
  candidate: ReleaseCandidate | null;
  current_hashes: ReleaseHashes;
  observed_hashes: ReleaseHashes;
  policy_signals: {
    review_ready: boolean;
    build_current: boolean;
    manifest_current: boolean;
    listings_current: boolean;
    smoke_current: boolean;
    tests_current: boolean;
    known_limitations_accepted: boolean;
  };
  invalidated_reason: string | null;
}

export function projectRelease(input: ReleaseProjectionInput): ReleaseProjection {
  const drift = detectHashDrift(input.current_hashes, input.observed_hashes);
  const hashes_current = drift.length === 0;

  const policy: ReleasePolicyDecision = evaluateReleasePolicy({
    ...input.policy_signals,
    hashes_current,
  });

  const next_actions: ReleaseNextAction[] = [];
  if (!input.candidate) {
    if (input.policy_signals.review_ready) next_actions.push("create_candidate");
  } else if (!hashes_current || !input.policy_signals.manifest_current) {
    next_actions.push("invalidate_candidate");
  } else if (policy.approved_for_submission && input.state !== "approved_for_submission") {
    next_actions.push("approve_for_submission");
  } else if (input.state === "approved_for_submission") {
    next_actions.push("export_submission_package");
    next_actions.push("await_human_review");
  } else {
    next_actions.push("await_human_review");
  }

  return {
    state: input.state,
    candidate: input.candidate,
    policy,
    hashes: input.observed_hashes,
    invalidated_reason: input.invalidated_reason,
    next_actions,
  };
}

/** Pure helper — does the timeline already contain the given event for the current candidate? */
export function projectionSummary(
  projection: ReleaseProjection,
  timeline: ReadonlyArray<ReleaseTimelineEvent>,
): { state: ReleaseState; events: number; approved: boolean } {
  return {
    state: projection.state,
    events: timeline.length,
    approved: projection.policy.approved_for_submission,
  };
}
