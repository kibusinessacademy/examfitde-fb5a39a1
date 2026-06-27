/**
 * STORE.PUBLISH.ORCHESTRATION.OS.1 — Contract tests for the pure SSOT.
 *
 * Tests cover:
 *   - Candidate construction & hash drift detection
 *   - Release policy blockers (per signal + composite)
 *   - State machine transitions (allowed + denied)
 *   - Append-only timeline invariants
 *   - Release projection next-actions
 *   - Audit payload determinism
 *   - No reliance on clock / RNG (determinism on identical input)
 */
import { describe, it, expect } from "vitest";
import {
  buildReleaseCandidate,
  detectHashDrift,
  evaluateReleasePolicy,
  nextReleaseState,
  canTransition,
  appendEvent,
  timelineContains,
  lastEvent,
  isAppendOnly,
  projectRelease,
  projectionSummary,
  buildReleaseAuditPayload,
} from "@/lib/storeRelease";
import type {
  ReleaseHashes,
  ReleasePolicyInput,
  ReleaseTimelineEvent,
  ReleaseState,
  ReleaseTimelineEventType,
} from "@/lib/storeRelease";

const HASHES_A: ReleaseHashes = {
  manifest_hash: "m1", listing_hash: "l1", package_hash: "p1",
  build_hash: "b1", review_hash: "r1", smoke_hash: "s1",
};
const HASHES_B: ReleaseHashes = { ...HASHES_A, listing_hash: "l2" };

const FULL_POLICY: ReleasePolicyInput = {
  review_ready: true, build_current: true, hashes_current: true,
  manifest_current: true, listings_current: true, smoke_current: true,
  tests_current: true, known_limitations_accepted: true,
};

describe("storeRelease — candidate factory", () => {
  it("constructs a candidate from input", () => {
    const c = buildReleaseCandidate({
      manifest_id: "m", product_id: null, curriculum_id: null, course_id: null,
      version: "1.0.0", build_number: "42",
      android_build_reference: "aab://x", ios_build_reference: "ipa://x",
      smoke_version: "smk-1", review_gate_version: "rgv-1",
      hashes: HASHES_A, created_at_reference: "2026-06-27T00:00:00Z",
    });
    expect(c.version).toBe("1.0.0");
    expect(c.package_hash).toBe("p1");
    expect(c.listing_hash).toBe("l1");
    expect(c.android_build_reference).toBe("aab://x");
  });

  it("is deterministic for identical inputs", () => {
    const args = {
      manifest_id: "m", product_id: null, curriculum_id: null, course_id: null,
      version: "1.0.0", build_number: "1",
      android_build_reference: null, ios_build_reference: null,
      smoke_version: null, review_gate_version: null,
      hashes: HASHES_A, created_at_reference: "X",
    };
    expect(buildReleaseCandidate(args)).toEqual(buildReleaseCandidate(args));
  });
});

describe("storeRelease — hash drift", () => {
  it("detects no drift when hashes match", () => {
    expect(detectHashDrift(HASHES_A, { ...HASHES_A })).toEqual([]);
  });
  it("detects listing drift", () => {
    expect(detectHashDrift(HASHES_A, HASHES_B)).toEqual(["listing_hash"]);
  });
  it("detects multiple drifts", () => {
    const drift = detectHashDrift(HASHES_A, {
      ...HASHES_A, listing_hash: "x", package_hash: "y", build_hash: "z",
    });
    expect(drift.sort()).toEqual(["build_hash", "listing_hash", "package_hash"].sort());
  });
  it("treats null and undefined symmetrically", () => {
    expect(detectHashDrift(
      { ...HASHES_A, review_hash: null },
      { ...HASHES_A, review_hash: null },
    )).toEqual([]);
  });
});

describe("storeRelease — release policy", () => {
  it("approves when all signals current", () => {
    expect(evaluateReleasePolicy(FULL_POLICY)).toEqual({
      approved_for_submission: true, blockers: [],
    });
  });

  const signals: Array<[keyof ReleasePolicyInput, string]> = [
    ["review_ready", "REVIEW_NOT_READY"],
    ["build_current", "BUILD_STALE"],
    ["hashes_current", "HASH_DRIFT"],
    ["manifest_current", "MANIFEST_STALE"],
    ["listings_current", "LISTINGS_STALE"],
    ["smoke_current", "SMOKE_STALE"],
    ["tests_current", "TESTS_STALE"],
    ["known_limitations_accepted", "KNOWN_LIMITATIONS_OPEN"],
  ];
  it.each(signals)("blocks when %s=false", (key, code) => {
    const decision = evaluateReleasePolicy({ ...FULL_POLICY, [key]: false });
    expect(decision.approved_for_submission).toBe(false);
    expect(decision.blockers).toContain(code);
  });

  it("returns all blockers when all signals fail", () => {
    const decision = evaluateReleasePolicy({
      review_ready: false, build_current: false, hashes_current: false,
      manifest_current: false, listings_current: false, smoke_current: false,
      tests_current: false, known_limitations_accepted: false,
    });
    expect(decision.blockers.length).toBe(8);
  });
});

describe("storeRelease — state machine", () => {
  const allowed: Array<[ReleaseState, ReleaseTimelineEventType, ReleaseState]> = [
    ["draft", "created", "draft"],
    ["draft", "review_completed", "review_ready"],
    ["draft", "candidate_created", "candidate"],
    ["candidate", "approved", "approved_for_submission"],
    ["candidate", "candidate_invalidated", "draft"],
    ["approved_for_submission", "submission_started", "submitted_external"],
    ["approved_for_submission", "submission_cancelled", "cancelled"],
    ["submitted_external", "store_feedback_received", "waiting_review"],
    ["waiting_review", "rejected", "rejected"],
    ["waiting_review", "archived", "retired"],
    ["rejected", "candidate_invalidated", "draft"],
    ["cancelled", "archived", "retired"],
  ];
  it.each(allowed)("allows %s -[%s]-> %s", (from, ev, to) => {
    expect(nextReleaseState(from, ev)).toBe(to);
    expect(canTransition(from, ev)).toBe(true);
  });

  it("denies invalid transitions", () => {
    expect(nextReleaseState("retired", "approved")).toBeNull();
    expect(nextReleaseState("released", "submission_started")).toBeNull();
    expect(canTransition("draft", "approved")).toBe(false);
  });
});

describe("storeRelease — append-only timeline", () => {
  const ev = (e: ReleaseTimelineEventType, at: string): ReleaseTimelineEvent => ({
    event: e, occurred_at: at, actor_id: null, note: null, payload: {},
  });

  it("appends without mutating prior", () => {
    const t0: ReleaseTimelineEvent[] = [ev("created", "t1")];
    const t1 = appendEvent(t0, ev("candidate_created", "t2"));
    expect(t1).toHaveLength(2);
    expect(t0).toHaveLength(1);
  });

  it("isAppendOnly accepts adding exactly one entry", () => {
    const t0: ReleaseTimelineEvent[] = [ev("created", "t1")];
    const t1 = appendEvent(t0, ev("approved", "t2"));
    expect(isAppendOnly(t0, t1)).toBe(true);
  });
  it("isAppendOnly rejects mutation of prior entry", () => {
    const t0: ReleaseTimelineEvent[] = [ev("created", "t1")];
    const tampered: ReleaseTimelineEvent[] = [ev("approved", "t1"), ev("approved", "t2")];
    expect(isAppendOnly(t0, tampered)).toBe(false);
  });
  it("isAppendOnly rejects skipping entries", () => {
    const t0: ReleaseTimelineEvent[] = [ev("created", "t1"), ev("approved", "t2")];
    const t2 = [ev("created", "t1")];
    expect(isAppendOnly(t0, t2)).toBe(false);
  });

  it("timelineContains detects events", () => {
    const t: ReleaseTimelineEvent[] = [ev("created", "t1"), ev("approved", "t2")];
    expect(timelineContains(t, "approved")).toBe(true);
    expect(timelineContains(t, "rejected")).toBe(false);
  });
  it("lastEvent returns trailing entry", () => {
    expect(lastEvent([])).toBeNull();
    const t: ReleaseTimelineEvent[] = [ev("created", "t1"), ev("approved", "t2")];
    expect(lastEvent(t)?.event).toBe("approved");
  });
});

describe("storeRelease — projection", () => {
  const baseCandidate = buildReleaseCandidate({
    manifest_id: "m", product_id: null, curriculum_id: null, course_id: null,
    version: "1.0.0", build_number: "1",
    android_build_reference: "aab://1", ios_build_reference: "ipa://1",
    smoke_version: "smk", review_gate_version: "rgv",
    hashes: HASHES_A, created_at_reference: "X",
  });

  it("suggests create_candidate when no candidate yet and review ready", () => {
    const p = projectRelease({
      state: "review_ready", candidate: null,
      current_hashes: HASHES_A, observed_hashes: HASHES_A,
      policy_signals: {
        review_ready: true, build_current: true, manifest_current: true,
        listings_current: true, smoke_current: true, tests_current: true,
        known_limitations_accepted: true,
      },
      invalidated_reason: null,
    });
    expect(p.next_actions).toContain("create_candidate");
  });

  it("suggests invalidate when hashes drift", () => {
    const p = projectRelease({
      state: "candidate", candidate: baseCandidate,
      current_hashes: HASHES_A, observed_hashes: HASHES_B,
      policy_signals: {
        review_ready: true, build_current: true, manifest_current: true,
        listings_current: true, smoke_current: true, tests_current: true,
        known_limitations_accepted: true,
      },
      invalidated_reason: null,
    });
    expect(p.next_actions).toContain("invalidate_candidate");
    expect(p.policy.approved_for_submission).toBe(false);
    expect(p.policy.blockers).toContain("HASH_DRIFT");
  });

  it("suggests approve_for_submission when candidate ready", () => {
    const p = projectRelease({
      state: "candidate", candidate: baseCandidate,
      current_hashes: HASHES_A, observed_hashes: HASHES_A,
      policy_signals: {
        review_ready: true, build_current: true, manifest_current: true,
        listings_current: true, smoke_current: true, tests_current: true,
        known_limitations_accepted: true,
      },
      invalidated_reason: null,
    });
    expect(p.next_actions).toContain("approve_for_submission");
    expect(p.policy.approved_for_submission).toBe(true);
  });

  it("suggests export_submission_package when approved", () => {
    const p = projectRelease({
      state: "approved_for_submission", candidate: baseCandidate,
      current_hashes: HASHES_A, observed_hashes: HASHES_A,
      policy_signals: {
        review_ready: true, build_current: true, manifest_current: true,
        listings_current: true, smoke_current: true, tests_current: true,
        known_limitations_accepted: true,
      },
      invalidated_reason: null,
    });
    expect(p.next_actions).toContain("export_submission_package");
    expect(p.next_actions).toContain("await_human_review");
  });

  it("projectionSummary surfaces stable state/events/approved", () => {
    const p = projectRelease({
      state: "approved_for_submission", candidate: baseCandidate,
      current_hashes: HASHES_A, observed_hashes: HASHES_A,
      policy_signals: {
        review_ready: true, build_current: true, manifest_current: true,
        listings_current: true, smoke_current: true, tests_current: true,
        known_limitations_accepted: true,
      },
      invalidated_reason: null,
    });
    const t: ReleaseTimelineEvent[] = [
      { event: "candidate_created", occurred_at: "t1", actor_id: null, note: null, payload: {} },
      { event: "approved", occurred_at: "t2", actor_id: null, note: null, payload: {} },
    ];
    expect(projectionSummary(p, t)).toEqual({
      state: "approved_for_submission", events: 2, approved: true,
    });
  });
});

describe("storeRelease — audit", () => {
  it("builds deterministic payloads", () => {
    const c = buildReleaseCandidate({
      manifest_id: "m", product_id: null, curriculum_id: null, course_id: null,
      version: "1.0.0", build_number: "1",
      android_build_reference: null, ios_build_reference: null,
      smoke_version: null, review_gate_version: null,
      hashes: HASHES_A, created_at_reference: "X",
    });
    const a = buildReleaseAuditPayload("candidate_created", "cand-1", c, "2026-06-27T00:00:00Z");
    expect(a.event).toBe("candidate_created");
    expect(a.candidate_id).toBe("cand-1");
    expect(a.manifest_id).toBe("m");
    expect(a.version).toBe("1.0.0");
    expect(a.hashes.package_hash).toBe("p1");
    expect(a.generated_at).toBe("2026-06-27T00:00:00Z");
  });

  it("handles null candidate gracefully", () => {
    const a = buildReleaseAuditPayload("submission_cancelled", null, null, "t");
    expect(a.candidate_id).toBeNull();
    expect(a.manifest_id).toBeNull();
    expect(a.version).toBeNull();
  });
});

describe("storeRelease — determinism (no clock, no RNG)", () => {
  it("identical inputs produce identical projection JSON", () => {
    const args = {
      state: "candidate" as ReleaseState,
      candidate: buildReleaseCandidate({
        manifest_id: "m", product_id: null, curriculum_id: null, course_id: null,
        version: "1.0.0", build_number: "1",
        android_build_reference: null, ios_build_reference: null,
        smoke_version: null, review_gate_version: null,
        hashes: HASHES_A, created_at_reference: "X",
      }),
      current_hashes: HASHES_A, observed_hashes: HASHES_A,
      policy_signals: {
        review_ready: true, build_current: true, manifest_current: true,
        listings_current: true, smoke_current: true, tests_current: true,
        known_limitations_accepted: true,
      },
      invalidated_reason: null,
    };
    expect(JSON.stringify(projectRelease(args))).toBe(JSON.stringify(projectRelease(args)));
  });
});
