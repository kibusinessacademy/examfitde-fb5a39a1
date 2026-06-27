/**
 * VISUAL.LEARNING.OS — Cut 7 Persistence Pure Tests.
 *
 * All assertions are deterministic; no DB, no HTTP, no IO.
 */
import { describe, expect, it } from "vitest";

import {
  FROZEN_VLO_PERSISTENCE_POLICY,
  isAllowedVloTransition,
} from "../persistence-policy";
import {
  evaluateVisualArtifactTransition,
  mapContractToPersistedStatus,
  preparePublishedVisualProjection,
  prepareVisualArtifactForPersistence,
  validateVisualArtifactPersistenceCandidate,
} from "../persistence";
import { LEARNER_SAFE_FIXTURE_ARTIFACT } from "../fixtures";
import type { VisualArtifactReviewResult } from "../visual-artifact-review";
import type { VisualLearningArtifact } from "../contracts";

const GREEN_REVIEW: VisualArtifactReviewResult = {
  status: "approved",
  blockers: [],
  warnings: [],
  publishable: true,
};

function draftArtifact(overrides: Partial<VisualLearningArtifact> = {}): VisualLearningArtifact {
  return {
    ...LEARNER_SAFE_FIXTURE_ARTIFACT,
    id: "test-1",
    status: "draft",
    version: 1,
    ...overrides,
  } as VisualLearningArtifact;
}

describe("VLO Cut 7 — FSM transitions", () => {
  it("allows draft → needs_review", () => {
    expect(isAllowedVloTransition("draft", "needs_review")).toBe(true);
  });
  it("allows needs_review → approved (with green review)", () => {
    const r = evaluateVisualArtifactTransition("needs_review", "approved", {
      reviewResult: GREEN_REVIEW,
    });
    expect(r.ok).toBe(true);
  });
  it("allows approved → published", () => {
    const r = evaluateVisualArtifactTransition("approved", "published");
    expect(r.ok).toBe(true);
  });
  it("blocks draft → published", () => {
    const r = evaluateVisualArtifactTransition("draft", "published");
    expect(r.ok).toBe(false);
    expect(r.blockers.some((b) => b.code === "VLO_PERSIST_DIRECT_PUBLISH_FORBIDDEN")).toBe(true);
  });
  it("blocks needs_review → published", () => {
    const r = evaluateVisualArtifactTransition("needs_review", "published");
    expect(r.ok).toBe(false);
  });
  it("blocks AI draft → published", () => {
    const r = evaluateVisualArtifactTransition("needs_review", "approved", {
      reviewResult: GREEN_REVIEW,
      is_ai_draft: true,
    });
    expect(r.ok).toBe(false);
    expect(
      r.blockers.some((b) => b.code === "VLO_PERSIST_UNREVIEWED_AI_DRAFT_FORBIDDEN"),
    ).toBe(true);
  });
  it("blocks approve when review missing", () => {
    const r = evaluateVisualArtifactTransition("needs_review", "approved");
    expect(r.ok).toBe(false);
    expect(r.blockers.some((b) => b.code === "VLO_PERSIST_REVIEW_REQUIRED")).toBe(true);
  });
  it("blocks approve when review not green", () => {
    const r = evaluateVisualArtifactTransition("needs_review", "approved", {
      reviewResult: { ...GREEN_REVIEW, status: "blocked", blockers: [{ code: "missing_curriculum_id" as any, detail: "x" }] },
    });
    expect(r.ok).toBe(false);
    expect(r.blockers.some((b) => b.code === "VLO_PERSIST_APPROVAL_REQUIRED")).toBe(true);
  });
});

describe("VLO Cut 7 — Persistence Candidate validation", () => {
  it("blocks missing curriculum_id", () => {
    const v = validateVisualArtifactPersistenceCandidate({
      artifact: draftArtifact({ curriculum_id: "" }),
      source_refs: ["s1"],
    });
    expect(v.ok).toBe(false);
    expect(v.blockers.some((b) => b.code === "VLO_PERSIST_MISSING_CURRICULUM_ID")).toBe(true);
  });
  it("blocks missing competence_id", () => {
    const v = validateVisualArtifactPersistenceCandidate({
      artifact: draftArtifact({ competence_id: "" }),
      source_refs: ["s1"],
    });
    expect(v.blockers.some((b) => b.code === "VLO_PERSIST_MISSING_COMPETENCE_ID")).toBe(true);
  });
  it("blocks missing source_refs", () => {
    const v = validateVisualArtifactPersistenceCandidate({
      artifact: draftArtifact(),
      source_refs: [],
    });
    expect(v.blockers.some((b) => b.code === "VLO_PERSIST_SOURCE_REFS_MISSING")).toBe(true);
  });
  it("blocks AI draft with status approved", () => {
    const v = validateVisualArtifactPersistenceCandidate({
      artifact: draftArtifact({ status: "approved" }),
      source_refs: ["s1"],
      is_ai_draft: true,
    });
    expect(
      v.blockers.some((b) => b.code === "VLO_PERSIST_UNREVIEWED_AI_DRAFT_FORBIDDEN"),
    ).toBe(true);
  });
  it("passes with all required fields", () => {
    const v = validateVisualArtifactPersistenceCandidate({
      artifact: draftArtifact(),
      source_refs: ["ssot://x"],
    });
    expect(v.ok).toBe(true);
  });
});

describe("VLO Cut 7 — Published Projection", () => {
  it("returns ok only for published", () => {
    const r = preparePublishedVisualProjection({
      ...LEARNER_SAFE_FIXTURE_ARTIFACT,
      status: "published",
    } as VisualLearningArtifact);
    expect(r.ok).toBe(true);
  });
  it("blocks approved (not yet learner-visible)", () => {
    const r = preparePublishedVisualProjection(
      LEARNER_SAFE_FIXTURE_ARTIFACT as VisualLearningArtifact,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("not_published");
  });
  it("blocks draft", () => {
    const r = preparePublishedVisualProjection(draftArtifact());
    expect(r.ok).toBe(false);
  });
  it("blocks needs_review (mapped from contract 'review')", () => {
    const r = preparePublishedVisualProjection(draftArtifact({ status: "review" }));
    expect(r.ok).toBe(false);
  });
  it("strips internal fields (no assessment_rubric / blueprint_id leak)", () => {
    const r = preparePublishedVisualProjection({
      ...LEARNER_SAFE_FIXTURE_ARTIFACT,
      status: "published",
      assessment_rubric: { checks: [{ kind: "node_position_correct", weight: 100 }], passing_score: 70 },
      blueprint_id: "bp-secret",
    } as VisualLearningArtifact);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect((r.artifact as any).assessment_rubric).toBeUndefined();
      expect((r.artifact as any).blueprint_id).toBeUndefined();
    }
  });
});

describe("VLO Cut 7 — Deterministic prepare", () => {
  it("prepareVisualArtifactForPersistence is deterministic", () => {
    const a = draftArtifact();
    const r1 = prepareVisualArtifactForPersistence(a, null, ["s1"]);
    const r2 = prepareVisualArtifactForPersistence(a, null, ["s1"]);
    expect(r1).toEqual(r2);
    expect(r1.status).toBe("draft");
  });
  it("maps contract status 'review' → persisted 'needs_review'", () => {
    expect(mapContractToPersistedStatus("review")).toBe("needs_review");
    expect(mapContractToPersistedStatus("draft")).toBe("draft");
    expect(mapContractToPersistedStatus("approved")).toBe("approved");
    expect(mapContractToPersistedStatus("published")).toBe("published");
  });
});

describe("VLO Cut 7 — Frozen Policy", () => {
  it("freezes allowed transitions and status set", () => {
    expect(Object.isFrozen(FROZEN_VLO_PERSISTENCE_POLICY)).toBe(true);
    expect(FROZEN_VLO_PERSISTENCE_POLICY.status).toContain("archived");
    expect(FROZEN_VLO_PERSISTENCE_POLICY.transitions.draft).toContain("needs_review");
    expect(FROZEN_VLO_PERSISTENCE_POLICY.transitions.draft).not.toContain("published");
  });
});
