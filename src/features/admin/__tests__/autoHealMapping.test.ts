import { describe, it, expect } from "vitest";

function mapReasonCodesToHealAction(codes: string[] | null): string {
  if (!codes || codes.length === 0) return "manual_review";
  if (codes.includes("too_few_questions") || codes.includes("low_question_buffer"))
    return "repair_exam_pool";
  if (codes.includes("no_lessons") || codes.includes("low_lesson_count"))
    return "repair_learning_content";
  if (codes.includes("missing_tutor_index")) return "repair_tutor_index";
  if (codes.includes("integrity_failed")) return "rerun_integrity";
  if (codes.includes("council_not_approved")) return "rerun_quality_council";
  return "manual_review";
}

describe("Reason code → heal action mapping", () => {
  it("too_few_questions → repair_exam_pool", () => {
    expect(mapReasonCodesToHealAction(["too_few_questions"])).toBe("repair_exam_pool");
  });

  it("low_question_buffer → repair_exam_pool", () => {
    expect(mapReasonCodesToHealAction(["low_question_buffer"])).toBe("repair_exam_pool");
  });

  it("no_lessons → repair_learning_content", () => {
    expect(mapReasonCodesToHealAction(["no_lessons"])).toBe("repair_learning_content");
  });

  it("low_lesson_count → repair_learning_content", () => {
    expect(mapReasonCodesToHealAction(["low_lesson_count"])).toBe("repair_learning_content");
  });

  it("missing_tutor_index → repair_tutor_index", () => {
    expect(mapReasonCodesToHealAction(["missing_tutor_index"])).toBe("repair_tutor_index");
  });

  it("integrity_failed → rerun_integrity", () => {
    expect(mapReasonCodesToHealAction(["integrity_failed"])).toBe("rerun_integrity");
  });

  it("council_not_approved → rerun_quality_council", () => {
    expect(mapReasonCodesToHealAction(["council_not_approved"])).toBe("rerun_quality_council");
  });

  it("unknown code → manual_review", () => {
    expect(mapReasonCodesToHealAction(["some_unknown_code"])).toBe("manual_review");
  });

  it("null → manual_review", () => {
    expect(mapReasonCodesToHealAction(null)).toBe("manual_review");
  });

  it("empty array → manual_review", () => {
    expect(mapReasonCodesToHealAction([])).toBe("manual_review");
  });

  it("multiple codes: first match wins (exam pool over content)", () => {
    expect(
      mapReasonCodesToHealAction(["too_few_questions", "no_lessons"])
    ).toBe("repair_exam_pool");
  });

  it("multiple codes: content over tutor", () => {
    expect(
      mapReasonCodesToHealAction(["low_lesson_count", "missing_tutor_index"])
    ).toBe("repair_learning_content");
  });
});
