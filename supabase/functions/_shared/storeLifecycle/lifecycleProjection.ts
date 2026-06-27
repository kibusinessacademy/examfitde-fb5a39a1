/**
 * STORE.LIFECYCLE.OS.1 — Lifecycle projection (pure)
 */
import type {
  CandidateSnapshot,
  LifecycleBlockingReason,
  LifecycleEvent,
  LifecycleNextAction,
  LifecycleProjection,
  LifecycleRiskLevel,
  LifecycleState,
  LifecycleWarning,
  PlatformProjection,
  StoreFeedbackInput,
  StorePlatform,
} from "./contracts.ts";
import { classifyFeedback } from "./storeFeedback.ts";
import { evaluateRollback } from "./rollbackPolicy.ts";

export interface ProjectionInput {
  current_candidate: CandidateSnapshot | null;
  history: ReadonlyArray<CandidateSnapshot>; // newest-first, excluding current
  current_state: LifecycleState;
  events: ReadonlyArray<LifecycleEvent>; // chronological, append-only
  feedback: ReadonlyArray<StoreFeedbackInput>; // chronological per platform
  explicitly_blocked: boolean;
}

function projectPlatform(
  platform: StorePlatform,
  feedback: ReadonlyArray<StoreFeedbackInput>,
): PlatformProjection | null {
  const items = feedback.filter((f) => f.platform === platform);
  if (items.length === 0) return null;
  const last = items[items.length - 1];
  const eff = classifyFeedback(last);
  let state: LifecycleState = "submitted_manual";
  if (eff.is_approval) state = "approved";
  else if (eff.is_rejection) state = "rejected";
  else if (eff.next_state) state = eff.next_state;
  return {
    platform,
    state,
    last_feedback_type: last.store_feedback_type,
    last_feedback_status: last.store_feedback_status,
    last_received_at_reference: last.received_at_reference,
  };
}

function computeRisk(
  blockers: LifecycleBlockingReason[],
  warnings: LifecycleWarning[],
): LifecycleRiskLevel {
  if (blockers.some((b) => b === "BINARY_REJECTED" || b === "EXPLICITLY_BLOCKED")) return "high";
  if (blockers.length > 0) return "elevated";
  if (warnings.length > 1) return "moderate";
  return "low";
}

export function projectLifecycle(input: ProjectionInput): LifecycleProjection {
  const blockers: LifecycleBlockingReason[] = [];
  const warnings: LifecycleWarning[] = [];
  const actions: LifecycleNextAction[] = [];

  const apple = projectPlatform("apple", input.feedback);
  const google = projectPlatform("google", input.feedback);

  if (!input.current_candidate) {
    blockers.push("NO_CANDIDATE");
    actions.push("mark_submitted_manual");
  }

  // Blocker derivation from latest feedback
  const lastBinaryReject = input.feedback.slice().reverse().find(
    (f) => f.store_feedback_type === "apple_binary_rejected",
  );
  if (lastBinaryReject) blockers.push("BINARY_REJECTED");

  const lastMetaReject = input.feedback.slice().reverse().find(
    (f) =>
      f.store_feedback_type === "apple_metadata_rejected" ||
      f.store_feedback_type === "google_metadata_rejected",
  );
  if (lastMetaReject) blockers.push("METADATA_REJECTED");

  const lastPolicyReject = input.feedback.slice().reverse().find(
    (f) => f.store_feedback_type === "google_policy_rejected",
  );
  if (lastPolicyReject) blockers.push("POLICY_REJECTED");

  const actionRequired = input.feedback.some(
    (f) => f.store_feedback_type === "google_action_required",
  );
  if (actionRequired) blockers.push("ACTION_REQUIRED_BY_STORE");

  if (input.current_candidate?.retired) blockers.push("RETIRED");
  if (input.explicitly_blocked) blockers.push("EXPLICITLY_BLOCKED");

  // Warnings
  const inReview = input.feedback.some(
    (f) => f.store_feedback_type === "apple_in_review" || f.store_feedback_type === "google_in_review",
  );
  const waiting = input.feedback.some((f) => f.store_feedback_type === "apple_waiting_for_review");
  if (inReview) warnings.push("IN_REVIEW");
  if (waiting) warnings.push("WAITING_FOR_REVIEW");
  if (
    input.feedback.filter((f) => /rejected$/.test(f.store_feedback_type)).length > 1
  ) {
    warnings.push("MULTIPLE_OPEN_REJECTIONS");
  }
  if (input.feedback.some((f) => f.store_feedback_type === "manual_note")) {
    warnings.push("MANUAL_NOTE_ATTACHED");
  }

  // Rollback evaluation
  const rb = evaluateRollback({
    current: input.current_candidate,
    history: input.history,
    current_state: input.current_state,
  });
  if (!rb.rollback_available) warnings.push("NO_ROLLBACK_AVAILABLE");

  // Recommended next actions
  if (blockers.includes("BINARY_REJECTED")) actions.push("build_new_binary_and_resubmit");
  if (blockers.includes("METADATA_REJECTED") || blockers.includes("POLICY_REJECTED") ||
      blockers.includes("ACTION_REQUIRED_BY_STORE")) {
    actions.push("fix_metadata_and_resubmit");
  }
  if (input.current_state === "approved") actions.push("mark_ready_for_release");
  if (input.current_state === "ready_for_release") actions.push("mark_released_external");
  if (input.current_state === "released_external" && rb.rollback_available) {
    actions.push("open_rollback_candidate");
  }
  if (input.current_state === "blocked") actions.push("unblock_candidate");
  if (actions.length === 0) actions.push("await_external_review");

  // Latest approved/rejected candidate ids from history + current
  const all = input.current_candidate ? [input.current_candidate, ...input.history] : [...input.history];
  const latestApproved = all.find((c) => c.approved_externally || c.released_externally);
  const latestRejected = all.find((c) => !c.approved_externally && !c.released_externally && !c.retired);

  const lastEvent = input.events.length === 0 ? null : input.events[input.events.length - 1];

  return {
    lifecycle_state: input.current_state,
    platform_state: { apple, google },
    overall_state: input.current_state,
    blocking_reasons: blockers,
    warnings,
    recommended_next_actions: actions,
    rollback_available: rb.rollback_available,
    rollback_candidate_id: rb.rollback_candidate_id,
    current_candidate_id: input.current_candidate?.candidate_id ?? null,
    latest_approved_candidate_id: latestApproved?.candidate_id ?? null,
    latest_rejected_candidate_id: latestRejected?.candidate_id ?? null,
    version_line: all.map((c) => c.version),
    timeline_summary: {
      events: input.events.length,
      last_event_type: lastEvent?.event_type ?? null,
      last_event_at_reference: lastEvent?.occurred_at_reference ?? null,
    },
    risk_level: computeRisk(blockers, warnings),
  };
}
