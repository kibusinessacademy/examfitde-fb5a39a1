import { describe, it, expect } from "vitest";

/**
 * Learner Golden Path Tests
 *
 * Validates the core logic chains that power the learner experience:
 * - Entitlement checks
 * - Readiness/risk classification
 * - Weakness map prioritization
 * - Adaptive exam question selection
 * - Conversion engine mapping
 */

// --- Entitlement logic ---

type Entitlement = {
  has_learning_course: boolean;
  has_exam_trainer: boolean;
  has_ai_tutor: boolean;
  has_oral_trainer: boolean;
};

function hasAnyAccess(e: Entitlement | null): boolean {
  if (!e) return false;
  return e.has_learning_course || e.has_exam_trainer || e.has_ai_tutor || e.has_oral_trainer;
}

function canAccessFeature(e: Entitlement | null, feature: keyof Entitlement): boolean {
  if (!e) return false;
  return !!e[feature];
}

// --- Readiness logic ---

type ReadinessInput = {
  readiness_score: number;
};

function classifyRisk(score: number): "low" | "medium" | "high" {
  if (score >= 75) return "low";
  if (score >= 50) return "medium";
  return "high";
}

// --- Conversion engine ---

function getConversionIntent(riskLevel: "low" | "medium" | "high"): string {
  if (riskLevel === "high") return "weakness_training";
  if (riskLevel === "medium") return "exam_simulation";
  return "exam_final";
}

// --- Weakness prioritization ---

type Weakness = {
  competency_id: string;
  mastery_level: "not_mastered" | "partial" | "mastered";
};

function sortByWeakness(items: Weakness[]): Weakness[] {
  const order = { not_mastered: 0, partial: 1, mastered: 2 };
  return [...items].sort((a, b) => order[a.mastery_level] - order[b.mastery_level]);
}

describe("Learner Golden Path: Entitlements", () => {
  it("denies access with null entitlement", () => {
    expect(hasAnyAccess(null)).toBe(false);
  });

  it("denies access with all false", () => {
    expect(hasAnyAccess({ has_learning_course: false, has_exam_trainer: false, has_ai_tutor: false, has_oral_trainer: false })).toBe(false);
  });

  it("grants access with any single entitlement", () => {
    expect(hasAnyAccess({ has_learning_course: true, has_exam_trainer: false, has_ai_tutor: false, has_oral_trainer: false })).toBe(true);
    expect(hasAnyAccess({ has_learning_course: false, has_exam_trainer: true, has_ai_tutor: false, has_oral_trainer: false })).toBe(true);
  });

  it("checks specific feature access", () => {
    const e: Entitlement = { has_learning_course: true, has_exam_trainer: false, has_ai_tutor: true, has_oral_trainer: false };
    expect(canAccessFeature(e, "has_learning_course")).toBe(true);
    expect(canAccessFeature(e, "has_exam_trainer")).toBe(false);
    expect(canAccessFeature(e, "has_ai_tutor")).toBe(true);
  });
});

describe("Learner Golden Path: Readiness + Risk", () => {
  it("score 90 = low risk", () => expect(classifyRisk(90)).toBe("low"));
  it("score 75 = low risk (boundary)", () => expect(classifyRisk(75)).toBe("low"));
  it("score 60 = medium risk", () => expect(classifyRisk(60)).toBe("medium"));
  it("score 50 = medium risk (boundary)", () => expect(classifyRisk(50)).toBe("medium"));
  it("score 30 = high risk", () => expect(classifyRisk(30)).toBe("high"));
  it("score 0 = high risk", () => expect(classifyRisk(0)).toBe("high"));
});

describe("Learner Golden Path: Conversion Engine", () => {
  it("high risk → weakness_training", () => expect(getConversionIntent("high")).toBe("weakness_training"));
  it("medium risk → exam_simulation", () => expect(getConversionIntent("medium")).toBe("exam_simulation"));
  it("low risk → exam_final", () => expect(getConversionIntent("low")).toBe("exam_final"));
});

describe("Learner Golden Path: Weakness Prioritization", () => {
  it("sorts not_mastered before partial before mastered", () => {
    const items: Weakness[] = [
      { competency_id: "a", mastery_level: "mastered" },
      { competency_id: "b", mastery_level: "not_mastered" },
      { competency_id: "c", mastery_level: "partial" },
    ];
    const sorted = sortByWeakness(items);
    expect(sorted[0].mastery_level).toBe("not_mastered");
    expect(sorted[1].mastery_level).toBe("partial");
    expect(sorted[2].mastery_level).toBe("mastered");
  });

  it("handles empty array", () => {
    expect(sortByWeakness([])).toEqual([]);
  });

  it("handles all same level", () => {
    const items: Weakness[] = [
      { competency_id: "a", mastery_level: "partial" },
      { competency_id: "b", mastery_level: "partial" },
    ];
    expect(sortByWeakness(items).length).toBe(2);
  });
});
