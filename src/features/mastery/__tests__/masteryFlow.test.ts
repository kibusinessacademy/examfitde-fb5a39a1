import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock supabase
const mockRpc = vi.fn();
const mockFrom = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...args: any[]) => mockRpc(...args),
    from: (...args: any[]) => mockFrom(...args),
  },
}));

import {
  updateMasteryFromMiniCheck,
  computeReadiness,
  fetchWeaknessMap,
  getAdaptiveExamQuestions,
} from "@/features/mastery/api/masteryApi";

describe("Mastery API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("updateMasteryFromMiniCheck", () => {
    it("calls RPC with correct params and returns result", async () => {
      const mockResult = {
        competency_id: "comp-1",
        old_level: "not_mastered",
        new_level: "partial",
        score: 0.65,
        level_changed: true,
      };
      mockRpc.mockResolvedValue({ data: mockResult, error: null });

      const result = await updateMasteryFromMiniCheck({
        userId: "user-1",
        competencyId: "comp-1",
        curriculumId: "curr-1",
        score: 0.65,
      });

      expect(mockRpc).toHaveBeenCalledWith("update_mastery_from_minicheck", {
        p_user_id: "user-1",
        p_competency_id: "comp-1",
        p_curriculum_id: "curr-1",
        p_score: 0.65,
      });
      expect(result.new_level).toBe("partial");
      expect(result.level_changed).toBe(true);
    });

    it("throws on RPC error", async () => {
      mockRpc.mockResolvedValue({ data: null, error: { message: "DB error" } });

      await expect(
        updateMasteryFromMiniCheck({
          userId: "u",
          competencyId: "c",
          curriculumId: "cu",
          score: 0.5,
        })
      ).rejects.toThrow("DB error");
    });
  });

  describe("computeReadiness", () => {
    it("returns readiness result from RPC", async () => {
      const mockReadiness = {
        readiness_score: 62.5,
        risk_level: "medium",
        mastery_pct: 70,
        last_sim_score: 45,
        mastered: 5,
        partial: 3,
        weak: 2,
        total: 10,
        persisted: true,
      };
      mockRpc.mockResolvedValue({ data: mockReadiness, error: null });

      const result = await computeReadiness({
        userId: "user-1",
        curriculumId: "curr-1",
      });

      expect(result.readiness_score).toBe(62.5);
      expect(result.risk_level).toBe("medium");
      expect(result.mastered).toBe(5);
    });
  });

  describe("fetchWeaknessMap", () => {
    it("queries view with correct filters", async () => {
      const mockData = [
        {
          competency_id: "c1",
          competency_title: "Buchführung",
          learning_field_title: "LF3",
          mastery_level: "not_mastered",
          score: 0.3,
          attempts: 2,
        },
      ];

      const chainMock = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({ data: mockData, error: null }),
      };
      mockFrom.mockReturnValue(chainMock);

      const result = await fetchWeaknessMap("user-1", "curr-1");

      expect(mockFrom).toHaveBeenCalledWith("v_user_weakness_map");
      expect(result).toHaveLength(1);
      expect(result[0].competency_title).toBe("Buchführung");
    });
  });

  describe("getAdaptiveExamQuestions", () => {
    it("calls RPC and returns weighted questions", async () => {
      const mockQuestions = [
        { question_id: "q1", competency_id: "c1", difficulty: "medium", mastery_level: "not_mastered", selection_weight: 1 },
        { question_id: "q2", competency_id: "c2", difficulty: "easy", mastery_level: "mastered", selection_weight: 3 },
      ];
      mockRpc.mockResolvedValue({ data: mockQuestions, error: null });

      const result = await getAdaptiveExamQuestions({
        userId: "user-1",
        curriculumId: "curr-1",
        limit: 10,
      });

      expect(mockRpc).toHaveBeenCalledWith("get_adaptive_exam_questions", {
        p_user_id: "user-1",
        p_curriculum_id: "curr-1",
        p_limit: 10,
      });
      expect(result).toHaveLength(2);
      // Weak questions should have lower weight (higher priority)
      expect(result[0].selection_weight).toBe(1);
    });
  });
});

describe("Mastery Golden Path: MiniCheck → Mastery → Readiness → Weakness → Adaptive", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("full flow: update mastery, compute readiness, fetch weakness, get adaptive questions", async () => {
    // Step 1: MiniCheck completion → mastery update
    mockRpc.mockResolvedValueOnce({
      data: {
        competency_id: "comp-lf3",
        old_level: "not_mastered",
        new_level: "partial",
        score: 0.6,
        level_changed: true,
      },
      error: null,
    });

    const mastery = await updateMasteryFromMiniCheck({
      userId: "user-1",
      competencyId: "comp-lf3",
      curriculumId: "curr-1",
      score: 0.6,
    });
    expect(mastery.level_changed).toBe(true);
    expect(mastery.new_level).toBe("partial");

    // Step 2: Readiness recomputation
    mockRpc.mockResolvedValueOnce({
      data: {
        readiness_score: 48.5,
        risk_level: "medium",
        mastery_pct: 55,
        last_sim_score: 35,
        mastered: 3,
        partial: 4,
        weak: 3,
        total: 10,
        persisted: true,
      },
      error: null,
    });

    const readiness = await computeReadiness({
      userId: "user-1",
      curriculumId: "curr-1",
    });
    expect(readiness.risk_level).toBe("medium");
    expect(readiness.persisted).toBe(true);

    // Step 3: Weakness map shows the weak competencies
    const weaknessMock = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({
        data: [
          { competency_id: "comp-lf3", competency_title: "Buchführung", learning_field_title: "LF3", mastery_level: "partial", score: 0.6, attempts: 1 },
          { competency_id: "comp-lf5", competency_title: "Steuerlehre", learning_field_title: "LF5", mastery_level: "not_mastered", score: 0.2, attempts: 3 },
        ],
        error: null,
      }),
    };
    mockFrom.mockReturnValue(weaknessMock);

    const weaknesses = await fetchWeaknessMap("user-1", "curr-1");
    expect(weaknesses).toHaveLength(2);
    expect(weaknesses[0].mastery_level).not.toBe("mastered");

    // Step 4: Adaptive exam pulls weakness-weighted questions
    mockRpc.mockResolvedValueOnce({
      data: [
        { question_id: "q1", competency_id: "comp-lf5", difficulty: "hard", mastery_level: "not_mastered", selection_weight: 1 },
        { question_id: "q2", competency_id: "comp-lf3", difficulty: "medium", mastery_level: "partial", selection_weight: 2 },
        { question_id: "q3", competency_id: "comp-lf1", difficulty: "easy", mastery_level: "mastered", selection_weight: 3 },
      ],
      error: null,
    });

    const questions = await getAdaptiveExamQuestions({
      userId: "user-1",
      curriculumId: "curr-1",
      limit: 40,
    });

    // Weakest competencies should be prioritized (lower weight = higher priority)
    expect(questions[0].mastery_level).toBe("not_mastered");
    expect(questions[0].selection_weight).toBe(1);
    expect(questions[2].selection_weight).toBe(3);
    expect(questions.length).toBe(3);
  });
});
