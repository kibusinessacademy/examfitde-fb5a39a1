/**
 * Golden-Path Test: EXAM_FIRST_PLUS
 *
 * Proves that the EXAM_FIRST_PLUS track correctly:
 * A. Skips learning-course and minicheck steps
 * B. Requires handbook, oral-exam, exam-pool, integrity, publish steps
 * C. Feature flags are correct
 * D. Capability SSOT is consistent
 */
import "https://deno.land/std@0.224.0/dotenv/load.ts";
import { assertEquals, assertArrayIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  getTrackCapabilities,
  getSkippedSteps,
  getRequiredSteps,
  normalizeTrack,
} from "../_shared/track-capabilities.ts";

// ── A. Track Capability SSOT ──

Deno.test("EXAM_FIRST_PLUS capabilities are correct", () => {
  const cap = getTrackCapabilities("EXAM_FIRST_PLUS");

  assertEquals(cap.hasLearningCourse, false, "no learning course");
  assertEquals(cap.hasMiniChecks, false, "no minichecks");
  assertEquals(cap.hasHandbook, true, "has handbook");
  assertEquals(cap.hasOralExam, true, "has oral exam");
  assertEquals(cap.isExamCentric, true, "is exam centric");
  assertEquals(cap.isExamOnly, false, "is NOT exam-only");
  assertEquals(cap.eliteHardenEligible, true, "elite harden eligible");
  assertEquals(cap.tutorMode, "limited_exam", "tutor mode = limited_exam");
});

Deno.test("EXAM_FIRST capabilities differ from PLUS", () => {
  const cap = getTrackCapabilities("EXAM_FIRST");

  assertEquals(cap.hasHandbook, false, "EXAM_FIRST has no handbook");
  assertEquals(cap.hasOralExam, false, "EXAM_FIRST has no oral exam");
  assertEquals(cap.isExamOnly, true, "EXAM_FIRST is exam-only");
});

Deno.test("AUSBILDUNG_VOLL has full learning", () => {
  const cap = getTrackCapabilities("AUSBILDUNG_VOLL");

  assertEquals(cap.hasLearningCourse, true);
  assertEquals(cap.hasMiniChecks, true);
  assertEquals(cap.hasHandbook, true);
  assertEquals(cap.hasOralExam, false);
  assertEquals(cap.isExamCentric, false);
});

Deno.test("STUDIUM has learning but no oral", () => {
  const cap = getTrackCapabilities("STUDIUM");

  assertEquals(cap.hasLearningCourse, true);
  assertEquals(cap.hasMiniChecks, true);
  assertEquals(cap.hasHandbook, true);
  assertEquals(cap.hasOralExam, false);
  assertEquals(cap.isExamCentric, false);
});

// ── B. Step Layout ──

Deno.test("EXAM_FIRST_PLUS skipped steps include learning and minicheck", () => {
  const skipped = getSkippedSteps("EXAM_FIRST_PLUS");

  assertArrayIncludes(skipped, [
    "scaffold_learning_course",
    "fanout_learning_content",
    "generate_learning_content",
    "finalize_learning_content",
    "validate_learning_content",
    "generate_lesson_minichecks",
    "validate_lesson_minichecks",
  ]);
});

Deno.test("EXAM_FIRST_PLUS required steps include handbook and oral", () => {
  const required = getRequiredSteps("EXAM_FIRST_PLUS");

  assertArrayIncludes(required, [
    "generate_handbook",
    "validate_handbook",
    "generate_oral_exam",
    "validate_oral_exam",
    "generate_exam_pool",
    "validate_exam_pool",
    "run_integrity_check",
    "quality_council",
    "auto_publish",
    "elite_harden",
  ]);
});

Deno.test("EXAM_FIRST_PLUS required steps do NOT include learning steps", () => {
  const required = getRequiredSteps("EXAM_FIRST_PLUS");
  const learningSteps = [
    "scaffold_learning_course",
    "fanout_learning_content",
    "generate_learning_content",
    "finalize_learning_content",
    "validate_learning_content",
    "generate_lesson_minichecks",
    "validate_lesson_minichecks",
  ];

  for (const step of learningSteps) {
    assertEquals(required.includes(step), false, `${step} must NOT be in required steps`);
  }
});

Deno.test("EXAM_FIRST required steps do NOT include handbook or oral", () => {
  const required = getRequiredSteps("EXAM_FIRST");

  assertEquals(required.includes("generate_handbook"), false, "no handbook for EXAM_FIRST");
  assertEquals(required.includes("validate_handbook"), false, "no validate_handbook for EXAM_FIRST");
  assertEquals(required.includes("generate_oral_exam"), false, "no oral exam for EXAM_FIRST");
  assertEquals(required.includes("validate_oral_exam"), false, "no validate_oral_exam for EXAM_FIRST");
});

Deno.test("AUSBILDUNG_VOLL required steps include learning but not oral", () => {
  const required = getRequiredSteps("AUSBILDUNG_VOLL");

  assertArrayIncludes(required, [
    "scaffold_learning_course",
    "generate_learning_content",
    "validate_learning_content",
    "generate_lesson_minichecks",
    "generate_handbook",
  ]);

  assertEquals(required.includes("generate_oral_exam"), false, "no oral for AUSBILDUNG_VOLL");
  assertEquals(required.includes("elite_harden"), false, "no elite_harden for AUSBILDUNG_VOLL");
});

// ── C. Alias Normalization ──

Deno.test("FORTBILDUNG normalizes to EXAM_FIRST_PLUS", () => {
  assertEquals(normalizeTrack("FORTBILDUNG"), "EXAM_FIRST_PLUS");
});

Deno.test("ZERTIFIKAT normalizes to EXAM_FIRST_PLUS", () => {
  assertEquals(normalizeTrack("ZERTIFIKAT"), "EXAM_FIRST_PLUS");
});

Deno.test("BACHELOR normalizes to STUDIUM", () => {
  assertEquals(normalizeTrack("BACHELOR"), "STUDIUM");
});

// ── D. Cross-track symmetry ──

Deno.test("Exam-centric tracks have distinct fingerprint from learning tracks", () => {
  const examFirst = getTrackCapabilities("EXAM_FIRST");
  const examPlus = getTrackCapabilities("EXAM_FIRST_PLUS");
  const vollTrack = getTrackCapabilities("AUSBILDUNG_VOLL");

  // EXAM_FIRST and EXAM_FIRST_PLUS must differ
  assertEquals(examFirst.hasHandbook !== examPlus.hasHandbook, true, "EXAM_FIRST vs PLUS differ on handbook");
  assertEquals(examFirst.hasOralExam !== examPlus.hasOralExam, true, "EXAM_FIRST vs PLUS differ on oral");
  assertEquals(examFirst.isExamOnly !== examPlus.isExamOnly, true, "EXAM_FIRST vs PLUS differ on isExamOnly");

  // Both exam-centric differ from AUSBILDUNG_VOLL
  assertEquals(examFirst.isExamCentric !== vollTrack.isExamCentric, true, "EXAM_FIRST vs VOLL differ on exam-centric");
  assertEquals(examPlus.hasLearningCourse !== vollTrack.hasLearningCourse, true, "PLUS vs VOLL differ on learning");
});

Deno.test("Skipped steps and required steps never overlap for any track", () => {
  for (const track of ["AUSBILDUNG_VOLL", "EXAM_FIRST", "EXAM_FIRST_PLUS", "STUDIUM"]) {
    const skipped = new Set(getSkippedSteps(track));
    const required = getRequiredSteps(track);
    for (const step of required) {
      assertEquals(skipped.has(step), false, `${track}: ${step} is both skipped and required`);
    }
  }
});
