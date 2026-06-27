import { describe, it, expect } from "vitest";
import {
  classifyFeedback,
  nextLifecycleState,
  evaluateRollback,
  decideVersionAction,
  projectLifecycle,
  type CandidateSnapshot,
  type StoreFeedbackInput,
} from "@/lib/storeLifecycle";

const fb = (over: Partial<StoreFeedbackInput> = {}): StoreFeedbackInput => ({
  candidate_id: "00000000-0000-0000-0000-000000000001",
  manifest_id: "00000000-0000-0000-0000-0000000000aa",
  platform: "apple",
  store_feedback_type: "apple_in_review",
  store_feedback_status: "informational",
  external_reference: null, reason_code: null,
  human_summary: "test", required_action: null,
  received_at_reference: "2026-06-27T00:00:00.000Z",
  evidence_url: null, reviewer: null, payload_hash: null,
  ...over,
});

const cand = (over: Partial<CandidateSnapshot> = {}): CandidateSnapshot => ({
  candidate_id: "00000000-0000-0000-0000-000000000001",
  manifest_id: "00000000-0000-0000-0000-0000000000aa",
  product_id: "p1", curriculum_id: "c1", course_id: "co1",
  version: "1.0.0", build_number: "1",
  manifest_hash: "m1", listing_hash: "l1", package_hash: "p1h", build_hash: "b1",
  approved_externally: false, released_externally: false, retired: false,
  created_at_reference: "2026-06-27T00:00:00.000Z",
  ...over,
});

describe("STORE.LIFECYCLE.OS.1 — pure SSOT", () => {
  describe("classifyFeedback", () => {
    it("classifies apple_approved as approval", () => {
      expect(classifyFeedback(fb({ store_feedback_type: "apple_approved" })).is_approval).toBe(true);
    });
    it("flags binary rejection as requires_new_binary", () => {
      const e = classifyFeedback(fb({ store_feedback_type: "apple_binary_rejected" }));
      expect(e.requires_new_binary).toBe(true);
      expect(e.is_rejection).toBe(true);
    });
    it("flags metadata rejection as fixable", () => {
      const e = classifyFeedback(fb({ store_feedback_type: "google_metadata_rejected" }));
      expect(e.requires_metadata_fix).toBe(true);
      expect(e.requires_new_binary).toBe(false);
    });
    it("policy rejection requires metadata fix only", () => {
      const e = classifyFeedback(fb({ store_feedback_type: "google_policy_rejected" }));
      expect(e.is_rejection).toBe(true);
      expect(e.requires_metadata_fix).toBe(true);
    });
    it("manual_note is neutral", () => {
      const e = classifyFeedback(fb({ store_feedback_type: "manual_note" }));
      expect(e.is_approval).toBe(false);
      expect(e.is_rejection).toBe(false);
    });
  });

  describe("lifecycleState machine", () => {
    it("allows not_submitted -> submitted_manual", () => {
      expect(nextLifecycleState("not_submitted", "candidate_marked_submitted")).toBe("submitted_manual");
    });
    it("rejects illegal transitions", () => {
      expect(nextLifecycleState("retired", "approved")).toBeNull();
    });
    it("approved -> ready_for_release -> released_external", () => {
      expect(nextLifecycleState("approved", "marked_ready_for_release")).toBe("ready_for_release");
      expect(nextLifecycleState("ready_for_release", "marked_released_external")).toBe("released_external");
    });
    it("released_external can be marked rollback_candidate", () => {
      expect(nextLifecycleState("released_external", "rollback_candidate_marked")).toBe("rollback_candidate");
    });
  });

  describe("rollbackPolicy", () => {
    it("blocks when no prior approved", () => {
      const d = evaluateRollback({ current: cand(), history: [], current_state: "rejected" });
      expect(d.rollback_available).toBe(false);
      expect(d.blockers).toContain("NO_PRIOR_APPROVED");
    });
    it("proposes prior released candidate", () => {
      const prev = cand({ candidate_id: "prev", released_externally: true });
      const d = evaluateRollback({ current: cand({ candidate_id: "cur" }), history: [prev], current_state: "released_external" });
      expect(d.rollback_available).toBe(true);
      expect(d.rollback_candidate_id).toBe("prev");
    });
    it("blocks on manifest mismatch", () => {
      const prev = cand({ candidate_id: "prev", manifest_id: "00000000-0000-0000-0000-0000000000bb", released_externally: true });
      const d = evaluateRollback({ current: cand({ candidate_id: "cur" }), history: [prev], current_state: "released_external" });
      expect(d.rollback_available).toBe(false);
      expect(d.blockers).toContain("MANIFEST_MISMATCH");
    });
  });

  describe("versionPolicy", () => {
    it("requires new build on binary rejection", () => {
      const d = decideVersionAction({
        current: cand(),
        observed_manifest_hash: "m1", observed_listing_hash: "l1",
        observed_build_hash: "b1", observed_package_hash: "p1h",
        curriculum_frozen: true,
        feedback: fb({ store_feedback_type: "apple_binary_rejected" }),
      });
      expect(d.actions).toContain("new_build_required");
    });
    it("metadata-only fix keeps same version", () => {
      const d = decideVersionAction({
        current: cand(),
        observed_manifest_hash: "m1", observed_listing_hash: "l1",
        observed_build_hash: "b1", observed_package_hash: "p1h",
        curriculum_frozen: true,
        feedback: fb({ store_feedback_type: "apple_metadata_rejected" }),
      });
      expect(d.actions).toContain("same_version_metadata_fix");
    });
    it("detects hash drift", () => {
      const d = decideVersionAction({
        current: cand(),
        observed_manifest_hash: "m2", observed_listing_hash: "l1",
        observed_build_hash: "b1", observed_package_hash: "p1h",
        curriculum_frozen: true, feedback: null,
      });
      expect(d.actions).toContain("new_candidate_required_for_hash_change");
    });
  });

  describe("projectLifecycle", () => {
    it("returns NO_CANDIDATE when nothing submitted", () => {
      const p = projectLifecycle({
        current_candidate: null, history: [], current_state: "not_submitted",
        events: [], feedback: [], explicitly_blocked: false,
      });
      expect(p.blocking_reasons).toContain("NO_CANDIDATE");
      expect(p.recommended_next_actions).toContain("mark_submitted_manual");
    });
    it("surfaces BINARY_REJECTED blocker and recommends new build", () => {
      const p = projectLifecycle({
        current_candidate: cand(), history: [], current_state: "rejected",
        events: [], explicitly_blocked: false,
        feedback: [fb({ store_feedback_type: "apple_binary_rejected" })],
      });
      expect(p.blocking_reasons).toContain("BINARY_REJECTED");
      expect(p.recommended_next_actions).toContain("build_new_binary_and_resubmit");
      expect(p.risk_level).toBe("high");
    });
    it("offers rollback when prior released exists", () => {
      const prev = cand({ candidate_id: "prev", released_externally: true });
      const cur = cand({ candidate_id: "cur", released_externally: true });
      const p = projectLifecycle({
        current_candidate: cur, history: [prev], current_state: "released_external",
        events: [], feedback: [], explicitly_blocked: false,
      });
      expect(p.rollback_available).toBe(true);
      expect(p.recommended_next_actions).toContain("open_rollback_candidate");
    });
  });

  describe("no-publish guard (contracts)", () => {
    it("contracts never export Store API symbols", async () => {
      const mod = await import("@/lib/storeLifecycle");
      const forbidden = ["submitForReview", "appStoreVersionReleaseRequest", "publishApp", "uploadAab", "uploadIpa"];
      for (const f of forbidden) expect((mod as any)[f]).toBeUndefined();
    });
  });
});
