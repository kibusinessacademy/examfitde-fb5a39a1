import { describe, it, expect } from "vitest";
import {
  buildAdaptiveExamPlan,
  computeAdaptiveExamOutcome,
} from "@/lib/exam/adaptiveEngine";
import type { AdaptiveExamPlanInput, BlueprintWeight } from "@/lib/exam/types";

const BP: BlueprintWeight[] = [
  { competency_id: "k1", competency_key: "lf1.struct", weight: 0.4 },
  { competency_id: "k2", competency_key: "lf2.transfer", weight: 0.3 },
  { competency_id: "k3", competency_key: "lf3.valuation", weight: 0.3 },
];

function input(over: Partial<AdaptiveExamPlanInput> = {}): AdaptiveExamPlanInput {
  return {
    blueprint: {
      total_questions: 10,
      difficulty_distribution: { easy: 3, medium: 5, hard: 2 },
      weights: BP,
    },
    mastery: [
      { competency_id: "k1", mastery: 0.8 },
      { competency_id: "k2", mastery: 0.4 },
      { competency_id: "k3", mastery: 0.6 },
    ],
    weakKompetenzIds: [],
    ...over,
  };
}

describe("adaptive exam engine — plan", () => {
  it("returns blueprint-unchanged plan when no weakness exists", () => {
    const p = buildAdaptiveExamPlan(input());
    expect(p.slots.length).toBe(10);
    expect(p.retest_block_size).toBe(0);
    expect(p.blueprint_conformity).toBe(1);
    expect(p.competency_distribution.every((d) => Math.abs(d.delta) < 1e-6)).toBe(true);
    // Difficulty pool exact
    expect(p.difficulty_distribution).toEqual({ easy: 3, medium: 5, hard: 2 });
  });

  it("shifts weight onto weak competencies but caps drift", () => {
    const p = buildAdaptiveExamPlan(input({ weakKompetenzIds: ["k2"] }));
    const k2 = p.competency_distribution.find((d) => d.competency_id === "k2")!;
    expect(k2.delta).toBeGreaterThan(0);
    expect(Math.abs(k2.delta)).toBeLessThanOrEqual(0.15 + 1e-6);
    expect(p.slots.length).toBe(10);
    expect(p.slots.some((s) => s.kind === "weakness_focus" && s.competency_id === "k2")).toBe(true);
  });

  it("produces deterministic signatures for identical inputs", () => {
    const a = buildAdaptiveExamPlan(input({ weakKompetenzIds: ["k2", "k3"] }));
    const b = buildAdaptiveExamPlan(input({ weakKompetenzIds: ["k2", "k3"] }));
    expect(a.signature).toBe(b.signature);
    expect(a.slots.map((s) => `${s.competency_id}:${s.difficulty}:${s.kind}`)).toEqual(
      b.slots.map((s) => `${s.competency_id}:${s.difficulty}:${s.kind}`),
    );
  });

  it("inserts re-test block at the end mapped to recovery competencies", () => {
    const p = buildAdaptiveExamPlan(
      input({ weakKompetenzIds: ["k2"], recoveryCompetencyIds: ["k3"] }),
    );
    expect(p.retest_block_size).toBeGreaterThan(0);
    const last = p.slots[p.slots.length - 1];
    expect(last.kind).toBe("retest");
    expect(last.competency_id).toBe("k3");
    expect(last.difficulty).not.toBe("hard"); // retest never hard
  });

  it("inserts stability anchor when structureStability is low", () => {
    const p = buildAdaptiveExamPlan(
      input({ weakKompetenzIds: ["k2"], signals: { structureStability: 0.3 } }),
    );
    expect(p.slots[0].kind).toBe("stability_anchor");
    expect(p.slots[0].difficulty).toBe("easy");
  });

  it("keeps difficulty totals matching blueprint exactly", () => {
    const p = buildAdaptiveExamPlan(input({ weakKompetenzIds: ["k2", "k3"] }));
    const counts = p.slots.reduce(
      (acc, s) => ((acc[s.difficulty] = (acc[s.difficulty] ?? 0) + 1), acc),
      {} as Record<string, number>,
    );
    expect(counts.easy ?? 0).toBe(p.difficulty_distribution.easy);
    expect(counts.medium ?? 0).toBe(p.difficulty_distribution.medium);
    expect(counts.hard ?? 0).toBe(p.difficulty_distribution.hard);
  });

  it("returns empty plan for empty blueprint", () => {
    const p = buildAdaptiveExamPlan(input({ blueprint: { total_questions: 10, difficulty_distribution: { easy: 3, medium: 5, hard: 2 }, weights: [] } }));
    expect(p.slots).toEqual([]);
    expect(p.competency_distribution).toEqual([]);
  });
});

describe("adaptive exam engine — outcome", () => {
  it("computes score, mastery deltas and follow-ups deterministically", () => {
    const plan = buildAdaptiveExamPlan(input({ weakKompetenzIds: ["k2"] }));
    const results = plan.slots.map((s, i) => ({
      position: s.position,
      is_correct: s.competency_id === "k2" ? false : i % 2 === 0,
    }));
    const out = computeAdaptiveExamOutcome(plan, results);
    expect(out.total).toBe(plan.slots.length);
    expect(out.score_percentage).toBeGreaterThanOrEqual(0);
    expect(out.score_percentage).toBeLessThanOrEqual(100);
    const k2 = out.per_competency.find((c) => c.competency_id === "k2")!;
    expect(k2.correct).toBe(0);
    expect(k2.mastery_delta).toBeLessThan(0);
    expect(out.tutor_followups[0]?.competency_id).toBe("k2");
    expect(out.tutor_followups[0]?.path_type).toBe("explain_again");
    expect(out.plan_signature).toBe(plan.signature);
  });

  it("returns no follow-ups when all correct", () => {
    const plan = buildAdaptiveExamPlan(input());
    const out = computeAdaptiveExamOutcome(
      plan,
      plan.slots.map((s) => ({ position: s.position, is_correct: true })),
    );
    expect(out.score_percentage).toBe(100);
    expect(out.tutor_followups).toEqual([]);
    expect(out.readiness_delta).toBeGreaterThan(0);
  });
});
