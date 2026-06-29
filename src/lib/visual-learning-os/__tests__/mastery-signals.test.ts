/**
 * Cut 8 — Pure tests for Visual Mastery Signals.
 */
import { describe, expect, it } from "vitest";
import {
  aggregateVisualMasterySignals,
  buildVisualMasterySignals,
  projectVisualMasteryForAdmin,
  projectVisualMasteryForLearner,
  type VisualMasterySignalInput,
} from "../mastery-signals";
import {
  FROZEN_VLO_MASTERY_SIGNAL_POLICY,
} from "../mastery-signal-policy";
import {
  LEARNER_SAFE_FIXTURE_ARTIFACT_WITH_MAPPED_MISCONCEPTION,
} from "../fixtures";
import type { MiniCheckVisualFeedbackResult } from "../minicheck-visual-feedback";
import type { PublishedVisualArtifact } from "../contracts";

const ART = LEARNER_SAFE_FIXTURE_ARTIFACT_WITH_MAPPED_MISCONCEPTION;

function fb(overrides: Partial<MiniCheckVisualFeedbackResult> = {}): MiniCheckVisualFeedbackResult {
  return {
    context: {
      curriculum_id: "fixture-curr",
      competence_id: "fixture-comp",
      mini_check_id: "mc-x",
    },
    items: [],
    positive_signals: [],
    blockers: [],
    warnings: [],
    learner_visible: true,
    ...overrides,
  };
}

function baseInput(overrides: Partial<VisualMasterySignalInput> = {}): VisualMasterySignalInput {
  return {
    curriculum_id: "fixture-curr",
    competence_id: "fixture-comp",
    learner: { learner_id: "learner-1" },
    artifacts: [ART],
    source_refs: ["ssot://x"],
    ...overrides,
  };
}

describe("VLO Cut 8 — mastery-signals (pure)", () => {
  it("1. deterministic output for same input", () => {
    const a = buildVisualMasterySignals(baseInput({ feedback: fb({
      items: [{
        question_id: "q1", question_order: 1, severity: "correction",
        misconception_id: "mc-1", visual_artifact_id: ART.id,
        relevant_nodes: [], relevant_edges: [],
        repetition_hint: "Wiederhole.", source_refs: ["ssot://x"],
      }],
    })}));
    const b = buildVisualMasterySignals(baseInput({ feedback: fb({
      items: [{
        question_id: "q1", question_order: 1, severity: "correction",
        misconception_id: "mc-1", visual_artifact_id: ART.id,
        relevant_nodes: [], relevant_edges: [],
        repetition_hint: "Wiederhole.", source_refs: ["ssot://x"],
      }],
    })}));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("2. missing curriculum_id blocks", () => {
    const r = buildVisualMasterySignals(baseInput({ curriculum_id: "" }));
    expect(r.blockers.find(b => b.code === "VLO_MASTERY_MISSING_CURRICULUM_ID")).toBeTruthy();
    expect(r.learner_visible).toBe(false);
  });

  it("3. missing competence_id blocks", () => {
    const r = buildVisualMasterySignals(baseInput({ competence_id: "" }));
    expect(r.blockers.find(b => b.code === "VLO_MASTERY_MISSING_COMPETENCE_ID")).toBeTruthy();
  });

  it("4. missing learner context blocks", () => {
    const r = buildVisualMasterySignals(baseInput({ learner: {} }));
    expect(r.blockers.find(b => b.code === "VLO_MASTERY_MISSING_LEARNER_CONTEXT")).toBeTruthy();
  });

  it("5. unpublished artifact blocks", () => {
    const draft = { ...ART, status: "draft" } as unknown as PublishedVisualArtifact;
    const r = buildVisualMasterySignals(baseInput({ artifacts: [draft] }));
    expect(r.blockers.find(b => b.code === "VLO_MASTERY_UNPUBLISHED_ARTIFACT")).toBeTruthy();
  });

  it("6. curriculum mismatch excludes artifact (no signal from it)", () => {
    const r = buildVisualMasterySignals(baseInput({
      artifacts: [{ ...ART, curriculum_id: "other" }],
      feedback: fb({ items: [{
        question_id: "q1", question_order: 1, severity: "correction",
        visual_artifact_id: ART.id, misconception_id: "mc-1",
        relevant_nodes: [], relevant_edges: [],
        repetition_hint: "x", source_refs: [],
      }]}),
    }));
    // signal still produced (item-driven), but artifact text-only fallback warning.
    expect(r.warnings.find(w => w.code === "VLO_MASTERY_TEXT_ONLY_FALLBACK")).toBeTruthy();
  });

  it("7. competence mismatch excludes artifact", () => {
    const r = buildVisualMasterySignals(baseInput({
      artifacts: [{ ...ART, competence_id: "other" }],
    }));
    expect(r.warnings.find(w => w.code === "VLO_MASTERY_SPARSE_VISUAL_EVIDENCE")).toBeTruthy();
  });

  it("8. missing source_refs warns", () => {
    const r = buildVisualMasterySignals(baseInput({ source_refs: [] }));
    expect(r.warnings.find(w => w.code === "VLO_MASTERY_SPARSE_VISUAL_EVIDENCE")).toBeTruthy();
  });

  it("9. incorrect answer with misconception → misconception_detected", () => {
    const r = buildVisualMasterySignals(baseInput({ feedback: fb({ items: [{
      question_id: "q1", question_order: 1, severity: "correction",
      misconception_id: "mc-1", visual_artifact_id: ART.id,
      relevant_nodes: [], relevant_edges: [],
      repetition_hint: "x", source_refs: ["ssot://x"],
    }]})}));
    expect(r.signals.find(s => s.signal_kind === "misconception_detected")).toBeTruthy();
  });

  it("10. unsure answer with misconception → weakens_mastery", () => {
    const r = buildVisualMasterySignals(baseInput({ feedback: fb({ items: [{
      question_id: "q3", question_order: 3, severity: "hint",
      misconception_id: "mc-1", visual_artifact_id: ART.id,
      relevant_nodes: [], relevant_edges: [],
      repetition_hint: "x", source_refs: ["ssot://x"],
    }]})}));
    expect(r.signals.find(s => s.signal_kind === "weakens_mastery")).toBeTruthy();
  });

  it("11. repeated misconception → needs_repetition", () => {
    const r = buildVisualMasterySignals(baseInput({
      feedback: fb({ items: [{
        question_id: "q1", question_order: 1, severity: "correction",
        misconception_id: "mc-1", visual_artifact_id: ART.id,
        relevant_nodes: [], relevant_edges: [], repetition_hint: "x", source_refs: ["ssot://x"],
      }]}),
      prior_signals: [{
        competence_id: "fixture-comp",
        signal_kind: "misconception_detected",
        misconception_id: "mc-1",
      }],
    }));
    expect(r.signals.find(s => s.signal_kind === "needs_repetition")).toBeTruthy();
    expect(r.warnings.find(w => w.code === "VLO_MASTERY_REPEATED_MISCONCEPTION")).toBeTruthy();
  });

  it("12. positive signals → strengthens_mastery", () => {
    const r = buildVisualMasterySignals(baseInput({ feedback: fb({
      positive_signals: [{ question_id: "q2", question_order: 2 }],
    })}));
    expect(r.signals.find(s => s.signal_kind === "strengthens_mastery")).toBeTruthy();
  });

  it("13. resolved misconception → misconception_resolved", () => {
    const r = buildVisualMasterySignals(baseInput({
      resolved_misconception_ids: ["mc-1"],
    }));
    expect(r.signals.find(s => s.signal_kind === "misconception_resolved")).toBeTruthy();
  });

  it("14. no signals → valid-empty result", () => {
    const r = buildVisualMasterySignals(baseInput());
    expect(r.signals).toEqual([]);
    expect(r.learner_visible).toBe(true);
  });

  it("15. aggregation is deterministically sorted", () => {
    const r = buildVisualMasterySignals(baseInput({
      feedback: fb({
        items: [{
          question_id: "q1", question_order: 1, severity: "correction",
          misconception_id: "mc-1", visual_artifact_id: ART.id,
          relevant_nodes: [], relevant_edges: [], repetition_hint: "x", source_refs: ["ssot://x"],
        }],
        positive_signals: [{ question_id: "q2", question_order: 2 }],
      }),
    }));
    const agg = aggregateVisualMasterySignals(r);
    const kinds = agg.signals.map(s => s.signal_kind);
    // misconception_detected (rank 0) before strengthens_mastery (rank 3)
    expect(kinds.indexOf("misconception_detected")).toBeLessThan(
      kinds.indexOf("strengthens_mastery"),
    );
  });

  it("16+17+18. learner projection has no scores / no exam-readiness / no pass-fail", () => {
    const r = buildVisualMasterySignals(baseInput({ feedback: fb({
      positive_signals: [{ question_id: "q2", question_order: 2 }],
    })}));
    const proj = projectVisualMasteryForLearner(aggregateVisualMasterySignals(r));
    const text = JSON.stringify(proj).toLowerCase();
    expect(text).not.toMatch(/severity/);
    expect(text).not.toMatch(/confidence/);
    expect(text).not.toMatch(/prüfungsreif/);
    expect(text).not.toMatch(/bestanden/);
    expect(text).not.toMatch(/nicht bestanden/);
  });

  it("19. admin projection includes evidence and warnings", () => {
    const r = buildVisualMasterySignals(baseInput({
      source_refs: [],
      feedback: fb({ items: [{
        question_id: "q1", question_order: 1, severity: "correction",
        misconception_id: "mc-1", visual_artifact_id: ART.id,
        relevant_nodes: [], relevant_edges: [], repetition_hint: "x", source_refs: [],
      }]}),
    }));
    const admin = projectVisualMasteryForAdmin(aggregateVisualMasterySignals(r));
    expect(admin.warnings.length).toBeGreaterThan(0);
    expect(admin.signals[0].evidence.length).toBeGreaterThan(0);
    expect(admin.is_supplemental_only).toBe(true);
  });

  it("20. visual learning cannot solely set final mastery", () => {
    expect(FROZEN_VLO_MASTERY_SIGNAL_POLICY.is_supplemental_only).toBe(true);
    const r = buildVisualMasterySignals(baseInput());
    expect(aggregateVisualMasterySignals(r).is_supplemental_only).toBe(true);
  });

  it("21. learner projection caps hints at max per competence", () => {
    const r = buildVisualMasterySignals(baseInput({
      feedback: fb({
        items: [
          { question_id: "q1", question_order: 1, severity: "correction",
            misconception_id: "mc-1", visual_artifact_id: ART.id,
            relevant_nodes: [], relevant_edges: [], repetition_hint: "x", source_refs: ["ssot://x"] },
          { question_id: "q2", question_order: 2, severity: "hint",
            misconception_id: "mc-2", visual_artifact_id: ART.id,
            relevant_nodes: [], relevant_edges: [], repetition_hint: "x", source_refs: ["ssot://x"] },
        ],
        positive_signals: [{ question_id: "q3", question_order: 3 }],
      }),
      resolved_misconception_ids: ["mc-3"],
      prior_signals: [
        { competence_id: "fixture-comp", signal_kind: "misconception_detected", misconception_id: "mc-1" },
      ],
    }));
    const proj = projectVisualMasteryForLearner(aggregateVisualMasterySignals(r));
    expect(proj.hints.length).toBeLessThanOrEqual(
      FROZEN_VLO_MASTERY_SIGNAL_POLICY.max_learner_hints_per_competence,
    );
  });

  it("22. admin projection shows full signal breakdown", () => {
    const r = buildVisualMasterySignals(baseInput({ feedback: fb({
      items: [{
        question_id: "q1", question_order: 1, severity: "correction",
        misconception_id: "mc-1", visual_artifact_id: ART.id,
        relevant_nodes: [], relevant_edges: [], repetition_hint: "x", source_refs: ["ssot://x"],
      }],
    })}));
    const admin = projectVisualMasteryForAdmin(aggregateVisualMasterySignals(r));
    expect(admin.signals.every(s => s.reason && s.signal_kind && s.confidence)).toBe(true);
    expect(admin.note).toMatch(/ergänzend/i);
  });
});
