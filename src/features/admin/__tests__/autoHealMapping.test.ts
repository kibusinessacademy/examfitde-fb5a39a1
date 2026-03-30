import { describe, it, expect } from "vitest";

function mapReasonCodesToHealAction(codes: string[] | null): string {
  if (!codes || codes.length === 0) return "manual_review";

  // Exam pool quantity
  if (codes.includes("too_few_questions") || codes.includes("low_question_buffer"))
    return "repair_exam_pool";

  // Exam pool quality
  if (codes.includes("exam_qc_flags_unresolved") || codes.includes("exam_pool_quality_low") || codes.includes("exam_coverage_gap"))
    return "repair_exam_pool_quality";

  // Learning content missing
  if (codes.includes("no_lessons") || codes.includes("low_lesson_count"))
    return "repair_learning_content";

  // Lessons QC failures
  if (codes.includes("lessons_qc_failed") || codes.includes("lessons_tier1_failed") || codes.includes("lessons_needs_revision"))
    return "repair_lessons";

  // Handbook
  if (codes.includes("handbook_incomplete") || codes.includes("handbook_shallow") || codes.includes("handbook_missing"))
    return "repair_handbook";

  // Minichecks
  if (codes.includes("minichecks_missing") || codes.includes("minichecks_failed"))
    return "repair_minichecks";

  // Oral exam
  if (codes.includes("oral_exam_missing") || codes.includes("oral_exam_incomplete"))
    return "repair_oral_exam";

  // Tutor index
  if (codes.includes("missing_tutor_index")) return "repair_tutor_index";

  // Integrity
  if (codes.includes("integrity_failed")) return "rerun_integrity";

  // Quality council
  if (codes.includes("council_not_approved")) return "rerun_quality_council";

  // Pipeline flow
  if (codes.includes("finalization_stall")) return "heal_finalization_stall";
  if (codes.includes("non_building_stuck") || codes.includes("stuck_not_building")) return "heal_non_building";
  if (codes.includes("step_stalled") || codes.includes("step_stuck")) return "retry_stalled_step";

  return "manual_review";
}

describe("Reason code → heal action mapping", () => {
  // ── Exam Pool ──
  it("too_few_questions → repair_exam_pool", () => {
    expect(mapReasonCodesToHealAction(["too_few_questions"])).toBe("repair_exam_pool");
  });
  it("low_question_buffer → repair_exam_pool", () => {
    expect(mapReasonCodesToHealAction(["low_question_buffer"])).toBe("repair_exam_pool");
  });

  // ── Exam Pool Quality ──
  it("exam_qc_flags_unresolved → repair_exam_pool_quality", () => {
    expect(mapReasonCodesToHealAction(["exam_qc_flags_unresolved"])).toBe("repair_exam_pool_quality");
  });
  it("exam_pool_quality_low → repair_exam_pool_quality", () => {
    expect(mapReasonCodesToHealAction(["exam_pool_quality_low"])).toBe("repair_exam_pool_quality");
  });
  it("exam_coverage_gap → repair_exam_pool_quality", () => {
    expect(mapReasonCodesToHealAction(["exam_coverage_gap"])).toBe("repair_exam_pool_quality");
  });

  // ── Learning Content ──
  it("no_lessons → repair_learning_content", () => {
    expect(mapReasonCodesToHealAction(["no_lessons"])).toBe("repair_learning_content");
  });
  it("low_lesson_count → repair_learning_content", () => {
    expect(mapReasonCodesToHealAction(["low_lesson_count"])).toBe("repair_learning_content");
  });

  // ── Lessons QC ──
  it("lessons_qc_failed → repair_lessons", () => {
    expect(mapReasonCodesToHealAction(["lessons_qc_failed"])).toBe("repair_lessons");
  });
  it("lessons_tier1_failed → repair_lessons", () => {
    expect(mapReasonCodesToHealAction(["lessons_tier1_failed"])).toBe("repair_lessons");
  });
  it("lessons_needs_revision → repair_lessons", () => {
    expect(mapReasonCodesToHealAction(["lessons_needs_revision"])).toBe("repair_lessons");
  });

  // ── Handbook ──
  it("handbook_incomplete → repair_handbook", () => {
    expect(mapReasonCodesToHealAction(["handbook_incomplete"])).toBe("repair_handbook");
  });
  it("handbook_shallow → repair_handbook", () => {
    expect(mapReasonCodesToHealAction(["handbook_shallow"])).toBe("repair_handbook");
  });
  it("handbook_missing → repair_handbook", () => {
    expect(mapReasonCodesToHealAction(["handbook_missing"])).toBe("repair_handbook");
  });

  // ── Minichecks ──
  it("minichecks_missing → repair_minichecks", () => {
    expect(mapReasonCodesToHealAction(["minichecks_missing"])).toBe("repair_minichecks");
  });
  it("minichecks_failed → repair_minichecks", () => {
    expect(mapReasonCodesToHealAction(["minichecks_failed"])).toBe("repair_minichecks");
  });

  // ── Oral Exam ──
  it("oral_exam_missing → repair_oral_exam", () => {
    expect(mapReasonCodesToHealAction(["oral_exam_missing"])).toBe("repair_oral_exam");
  });
  it("oral_exam_incomplete → repair_oral_exam", () => {
    expect(mapReasonCodesToHealAction(["oral_exam_incomplete"])).toBe("repair_oral_exam");
  });

  // ── Tutor Index ──
  it("missing_tutor_index → repair_tutor_index", () => {
    expect(mapReasonCodesToHealAction(["missing_tutor_index"])).toBe("repair_tutor_index");
  });

  // ── Integrity ──
  it("integrity_failed → rerun_integrity", () => {
    expect(mapReasonCodesToHealAction(["integrity_failed"])).toBe("rerun_integrity");
  });

  // ── Quality Council ──
  it("council_not_approved → rerun_quality_council", () => {
    expect(mapReasonCodesToHealAction(["council_not_approved"])).toBe("rerun_quality_council");
  });

  // ── Pipeline Flow ──
  it("finalization_stall → heal_finalization_stall", () => {
    expect(mapReasonCodesToHealAction(["finalization_stall"])).toBe("heal_finalization_stall");
  });
  it("non_building_stuck → heal_non_building", () => {
    expect(mapReasonCodesToHealAction(["non_building_stuck"])).toBe("heal_non_building");
  });
  it("stuck_not_building → heal_non_building", () => {
    expect(mapReasonCodesToHealAction(["stuck_not_building"])).toBe("heal_non_building");
  });
  it("step_stalled → retry_stalled_step", () => {
    expect(mapReasonCodesToHealAction(["step_stalled"])).toBe("retry_stalled_step");
  });
  it("step_stuck → retry_stalled_step", () => {
    expect(mapReasonCodesToHealAction(["step_stuck"])).toBe("retry_stalled_step");
  });

  // ── Fallbacks ──
  it("unknown code → manual_review", () => {
    expect(mapReasonCodesToHealAction(["some_unknown_code"])).toBe("manual_review");
  });
  it("null → manual_review", () => {
    expect(mapReasonCodesToHealAction(null)).toBe("manual_review");
  });
  it("empty array → manual_review", () => {
    expect(mapReasonCodesToHealAction([])).toBe("manual_review");
  });

  // ── Priority ordering ──
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
  it("multiple codes: lessons QC over handbook", () => {
    expect(
      mapReasonCodesToHealAction(["lessons_qc_failed", "handbook_incomplete"])
    ).toBe("repair_lessons");
  });
  it("multiple codes: exam quality over lessons QC", () => {
    expect(
      mapReasonCodesToHealAction(["exam_pool_quality_low", "lessons_tier1_failed"])
    ).toBe("repair_exam_pool_quality");
  });
});
