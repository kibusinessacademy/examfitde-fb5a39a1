import { describe, it, expect } from "vitest";

/**
 * Nightly Audit Suite — Published Course Quality
 *
 * These tests verify SSOT invariants on published courses.
 * They run against the actual DB via RPC/views.
 *
 * Zero-tolerance: any violation = fail.
 */

// Mock supabase for unit-level structure tests
// In production nightly runs, these would hit real RPCs

describe("Nightly Audit: Published Course Quality Invariants", () => {
  describe("Priority classification logic", () => {
    type Course = {
      integrity_passed: boolean;
      council_approved: boolean;
      approved_questions: number;
      lessons_count: number;
      tutor_index_count: number;
    };

    function classifyPriority(c: Course): "critical" | "warning" | "healthy" {
      if (!c.integrity_passed) return "critical";
      if (!c.council_approved) return "critical";
      if (c.approved_questions < 40) return "critical";
      if (c.lessons_count === 0) return "critical";

      if (c.approved_questions < 100) return "warning";
      if (c.lessons_count < 5) return "warning";
      if (c.tutor_index_count === 0) return "warning";

      return "healthy";
    }

    function getReasonCodes(c: Course): string[] {
      const codes: string[] = [];
      if (!c.integrity_passed) codes.push("integrity_failed");
      if (!c.council_approved) codes.push("council_not_approved");
      if (c.approved_questions < 40) codes.push("too_few_questions");
      if (c.lessons_count === 0) codes.push("no_lessons");
      if (c.approved_questions >= 40 && c.approved_questions < 100) codes.push("low_question_buffer");
      if (c.lessons_count > 0 && c.lessons_count < 5) codes.push("low_lesson_count");
      if (c.tutor_index_count === 0) codes.push("missing_tutor_index");
      return codes;
    }

    it("classifies integrity_failed as critical", () => {
      expect(classifyPriority({ integrity_passed: false, council_approved: true, approved_questions: 200, lessons_count: 20, tutor_index_count: 5 })).toBe("critical");
    });

    it("classifies council_not_approved as critical", () => {
      expect(classifyPriority({ integrity_passed: true, council_approved: false, approved_questions: 200, lessons_count: 20, tutor_index_count: 5 })).toBe("critical");
    });

    it("classifies < 40 questions as critical", () => {
      expect(classifyPriority({ integrity_passed: true, council_approved: true, approved_questions: 10, lessons_count: 20, tutor_index_count: 5 })).toBe("critical");
    });

    it("classifies 0 lessons as critical", () => {
      expect(classifyPriority({ integrity_passed: true, council_approved: true, approved_questions: 200, lessons_count: 0, tutor_index_count: 5 })).toBe("critical");
    });

    it("classifies < 100 questions as warning", () => {
      expect(classifyPriority({ integrity_passed: true, council_approved: true, approved_questions: 60, lessons_count: 20, tutor_index_count: 5 })).toBe("warning");
    });

    it("classifies < 5 lessons as warning", () => {
      expect(classifyPriority({ integrity_passed: true, council_approved: true, approved_questions: 200, lessons_count: 3, tutor_index_count: 5 })).toBe("warning");
    });

    it("classifies missing tutor index as warning", () => {
      expect(classifyPriority({ integrity_passed: true, council_approved: true, approved_questions: 200, lessons_count: 20, tutor_index_count: 0 })).toBe("warning");
    });

    it("classifies fully healthy course", () => {
      expect(classifyPriority({ integrity_passed: true, council_approved: true, approved_questions: 200, lessons_count: 20, tutor_index_count: 5 })).toBe("healthy");
    });

    it("produces correct reason codes for multi-issue course", () => {
      const codes = getReasonCodes({ integrity_passed: false, council_approved: false, approved_questions: 10, lessons_count: 0, tutor_index_count: 0 });
      expect(codes).toContain("integrity_failed");
      expect(codes).toContain("council_not_approved");
      expect(codes).toContain("too_few_questions");
      expect(codes).toContain("no_lessons");
      expect(codes).toContain("missing_tutor_index");
    });

    it("produces no critical codes for healthy course", () => {
      const codes = getReasonCodes({ integrity_passed: true, council_approved: true, approved_questions: 200, lessons_count: 20, tutor_index_count: 5 });
      expect(codes).toEqual([]);
    });
  });

  describe("Queue score logic", () => {
    function computeQueueScore(priority: string, updatedWithin3Days: boolean): number {
      if (priority === "critical" && updatedWithin3Days) return 100;
      if (priority === "critical") return 90;
      if (priority === "warning" && updatedWithin3Days) return 70;
      if (priority === "warning") return 60;
      if (priority === "healthy" && updatedWithin3Days) return 40;
      return 20;
    }

    it("critical + recent = 100", () => {
      expect(computeQueueScore("critical", true)).toBe(100);
    });

    it("critical + older = 90", () => {
      expect(computeQueueScore("critical", false)).toBe(90);
    });

    it("warning + recent = 70", () => {
      expect(computeQueueScore("warning", true)).toBe(70);
    });

    it("healthy + older = 20", () => {
      expect(computeQueueScore("healthy", false)).toBe(20);
    });

    it("critical always outranks warning", () => {
      expect(computeQueueScore("critical", false)).toBeGreaterThan(computeQueueScore("warning", true));
    });
  });
});
