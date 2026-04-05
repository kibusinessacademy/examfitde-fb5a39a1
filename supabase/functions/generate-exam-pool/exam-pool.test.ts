import { assertEquals, assertNotEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildExamQuestionRow, type BlueprintQuestionSource } from "../_shared/certifications/exam-pool-from-blueprint.ts";

function makeBp(overrides: Partial<BlueprintQuestionSource> = {}): BlueprintQuestionSource {
  return {
    id: "bp-001",
    curriculum_id: "cur-001",
    competency_id: "comp-001",
    learning_field_id: "lf-001",
    name: "Testname für einen Blueprint mit ausreichender Länge",
    canonical_statement: "Kanonische Aussage mit genug Länge für den Test mindestens sechzig Zeichen lang",
    knowledge_type: "concept",
    cognitive_level: "apply",
    didactic_intent: "verify",
    exam_context_type: "isolated_knowledge",
    decision_structure: null,
    expected_trap_type: "typical_error",
    allowed_question_types: ["concept"],
    exam_relevance_score: 0.8,
    ...overrides,
  };
}

// ── deriveExamPart mapping tests ──

Deno.test("deriveExamPart: isolated_knowledge → teil_1", () => {
  const row = buildExamQuestionRow({ certificationId: "cert-1", blueprint: makeBp({ exam_context_type: "isolated_knowledge" }) });
  assertEquals(row.exam_part, "teil_1");
});

Deno.test("deriveExamPart: calculation_analysis → teil_1", () => {
  const row = buildExamQuestionRow({ certificationId: "cert-1", blueprint: makeBp({ exam_context_type: "calculation_analysis" }) });
  assertEquals(row.exam_part, "teil_1");
});

Deno.test("deriveExamPart: error_detection → teil_1", () => {
  const row = buildExamQuestionRow({ certificationId: "cert-1", blueprint: makeBp({ exam_context_type: "error_detection" }) });
  assertEquals(row.exam_part, "teil_1");
});

Deno.test("deriveExamPart: legal_evaluation → teil_1", () => {
  const row = buildExamQuestionRow({ certificationId: "cert-1", blueprint: makeBp({ exam_context_type: "legal_evaluation" }) });
  assertEquals(row.exam_part, "teil_1");
});

Deno.test("deriveExamPart: applied_case → teil_1", () => {
  const row = buildExamQuestionRow({ certificationId: "cert-1", blueprint: makeBp({ exam_context_type: "applied_case" }) });
  assertEquals(row.exam_part, "teil_1");
});

Deno.test("deriveExamPart: prioritization → teil_1", () => {
  const row = buildExamQuestionRow({ certificationId: "cert-1", blueprint: makeBp({ exam_context_type: "prioritization" }) });
  assertEquals(row.exam_part, "teil_1");
});

Deno.test("deriveExamPart: model_comparison → teil_1", () => {
  const row = buildExamQuestionRow({ certificationId: "cert-1", blueprint: makeBp({ exam_context_type: "model_comparison" }) });
  assertEquals(row.exam_part, "teil_1");
});

Deno.test("deriveExamPart: case_study → teil_2", () => {
  const row = buildExamQuestionRow({ certificationId: "cert-1", blueprint: makeBp({ exam_context_type: "case_study" }) });
  assertEquals(row.exam_part, "teil_2");
});

Deno.test("deriveExamPart: strategic_decision → teil_2", () => {
  const row = buildExamQuestionRow({ certificationId: "cert-1", blueprint: makeBp({ exam_context_type: "strategic_decision" }) });
  assertEquals(row.exam_part, "teil_2");
});

Deno.test("deriveExamPart: multi_step_case → teil_2", () => {
  const row = buildExamQuestionRow({ certificationId: "cert-1", blueprint: makeBp({ exam_context_type: "multi_step_case" }) });
  assertEquals(row.exam_part, "teil_2");
});

Deno.test("deriveExamPart: unknown type → empty string (no silent default)", () => {
  const row = buildExamQuestionRow({ certificationId: "cert-1", blueprint: makeBp({ exam_context_type: "unknown_future_type" }) });
  assertEquals(row.exam_part, "");
});

Deno.test("deriveExamPart: legacy teil_1 pattern → teil_1", () => {
  const row = buildExamQuestionRow({ certificationId: "cert-1", blueprint: makeBp({ exam_context_type: "teil_1_schriftlich" }) });
  assertEquals(row.exam_part, "teil_1");
});

Deno.test("deriveExamPart: legacy mündlich pattern → teil_2", () => {
  const row = buildExamQuestionRow({ certificationId: "cert-1", blueprint: makeBp({ exam_context_type: "mündlich_prüfung" }) });
  assertEquals(row.exam_part, "teil_2");
});

// ── tier1 eligibility tests ──

Deno.test("tier1: fully valid blueprint → tier1_passed", () => {
  const row = buildExamQuestionRow({ certificationId: "cert-1", blueprint: makeBp() });
  assertEquals(row.qc_status, "tier1_passed");
  assertEquals((row.meta as any).promotion_block_reasons, undefined);
});

Deno.test("tier1: missing competency_id → needs_review", () => {
  const row = buildExamQuestionRow({ certificationId: "cert-1", blueprint: makeBp({ competency_id: null }) });
  assertEquals(row.qc_status, "needs_review");
  const reasons = (row.meta as any).promotion_block_reasons as string[];
  assertEquals(reasons.includes("missing_competency_id"), true);
});

Deno.test("tier1: missing learning_field_id → needs_review", () => {
  const row = buildExamQuestionRow({ certificationId: "cert-1", blueprint: makeBp({ learning_field_id: null }) });
  assertEquals(row.qc_status, "needs_review");
  const reasons = (row.meta as any).promotion_block_reasons as string[];
  assertEquals(reasons.includes("missing_learning_field_id"), true);
});

Deno.test("tier1: unknown exam_context_type → needs_review with missing_exam_part", () => {
  const row = buildExamQuestionRow({ certificationId: "cert-1", blueprint: makeBp({ exam_context_type: "totally_unknown" }) });
  assertEquals(row.qc_status, "needs_review");
  const reasons = (row.meta as any).promotion_block_reasons as string[];
  assertEquals(reasons.includes("missing_exam_part"), true);
});

Deno.test("tier1: missing cognitive_level → needs_review", () => {
  const row = buildExamQuestionRow({ certificationId: "cert-1", blueprint: makeBp({ cognitive_level: "" }) });
  assertEquals(row.qc_status, "needs_review");
  const reasons = (row.meta as any).promotion_block_reasons as string[];
  assertEquals(reasons.includes("missing_cognitive_level"), true);
});

// ── difficulty mapping tests ──

Deno.test("difficulty: remember → easy", () => {
  const row = buildExamQuestionRow({ certificationId: "cert-1", blueprint: makeBp({ cognitive_level: "remember" }) });
  assertEquals(row.difficulty, "easy");
});

Deno.test("difficulty: apply → medium", () => {
  const row = buildExamQuestionRow({ certificationId: "cert-1", blueprint: makeBp({ cognitive_level: "apply" }) });
  assertEquals(row.difficulty, "medium");
});

Deno.test("difficulty: evaluate → hard", () => {
  const row = buildExamQuestionRow({ certificationId: "cert-1", blueprint: makeBp({ cognitive_level: "evaluate" }) });
  assertEquals(row.difficulty, "hard");
});

// ── reason code canonicalization ──

Deno.test("reason codes: multiple deficiencies produce multiple codes", () => {
  const row = buildExamQuestionRow({
    certificationId: "cert-1",
    blueprint: makeBp({
      competency_id: null,
      learning_field_id: null,
      cognitive_level: "",
      exam_context_type: "unknown",
    }),
  });
  assertEquals(row.qc_status, "needs_review");
  const reasons = (row.meta as any).promotion_block_reasons as string[];
  assertEquals(reasons.includes("missing_competency_id"), true);
  assertEquals(reasons.includes("missing_learning_field_id"), true);
  assertEquals(reasons.includes("missing_cognitive_level"), true);
  assertEquals(reasons.includes("missing_exam_part"), true);
});
