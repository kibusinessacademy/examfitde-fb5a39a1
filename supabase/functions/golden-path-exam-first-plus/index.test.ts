/**
 * Golden-Path Test: Track Capability SSOT
 *
 * Proves that all 4 tracks correctly:
 * A. Have correct capability fingerprints
 * B. Skip/require the right steps (with cert-based oral for EXAM_FIRST_PLUS)
 * C. Aliases normalize correctly
 * D. Required + skipped are disjoint and cover FULL_STEP_ORDER
 * E. Strict normalization rejects unknowns
 */
import "https://deno.land/std@0.224.0/dotenv/load.ts";
import {
  assertEquals,
  assertArrayIncludes,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  getTrackCapabilities,
  getSkippedSteps,
  getRequiredSteps,
  resolveHasOralExam,
  normalizeTrack,
  normalizeTrackStrict,
  TRACKS,
} from "../_shared/track-capabilities.ts";

// ── A. Track Capability SSOT ──

Deno.test("EXAM_FIRST_PLUS capabilities are correct (cert-based oral)", () => {
  const cap = getTrackCapabilities("EXAM_FIRST_PLUS");

  assertEquals(cap.hasLearningCourse, false, "no learning course");
  assertEquals(cap.hasMiniChecks, false, "no minichecks");
  assertEquals(cap.hasHandbook, true, "has handbook");
  assertEquals(cap.canSupportOralExam, true, "can support oral exam");
  assertEquals(cap.hasOralExam, false, "static hasOralExam is false (cert-based)");
  assertEquals(cap.isExamCentric, true, "is exam centric");
  assertEquals(cap.isExamOnly, false, "is NOT exam-only");
  assertEquals(cap.eliteHardenEligible, true, "elite harden eligible");
  assertEquals(cap.tutorMode, "limited_exam", "tutor mode = limited_exam");
});

Deno.test("EXAM_FIRST capabilities differ from PLUS on handbook + oral default", () => {
  const cap = getTrackCapabilities("EXAM_FIRST");

  assertEquals(cap.hasHandbook, false, "EXAM_FIRST has no handbook");
  assertEquals(cap.hasOralExam, true, "EXAM_FIRST has oral exam (static)");
  assertEquals(cap.isExamOnly, false, "EXAM_FIRST is not exam-only");
  assertEquals(cap.canSupportOralExam, true, "EXAM_FIRST can support oral exam");
});

Deno.test("AUSBILDUNG_VOLL has full learning + oral", () => {
  const cap = getTrackCapabilities("AUSBILDUNG_VOLL");

  assertEquals(cap.hasLearningCourse, true);
  assertEquals(cap.hasMiniChecks, true);
  assertEquals(cap.hasHandbook, true);
  assertEquals(cap.hasOralExam, true);
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

// ── A2. resolveHasOralExam ──

Deno.test("resolveHasOralExam: AUSBILDUNG_VOLL always true", () => {
  assertEquals(resolveHasOralExam("AUSBILDUNG_VOLL"), true);
  assertEquals(resolveHasOralExam("AUSBILDUNG_VOLL", { oral_exam_enabled: false }), true);
});

Deno.test("resolveHasOralExam: EXAM_FIRST always true", () => {
  assertEquals(resolveHasOralExam("EXAM_FIRST"), true);
  assertEquals(resolveHasOralExam("EXAM_FIRST", { oral_exam_enabled: false }), true);
});

Deno.test("resolveHasOralExam: EXAM_FIRST_PLUS cert-based", () => {
  assertEquals(resolveHasOralExam("EXAM_FIRST_PLUS"), false);
  assertEquals(resolveHasOralExam("EXAM_FIRST_PLUS", null), false);
  assertEquals(resolveHasOralExam("EXAM_FIRST_PLUS", { oral_exam_enabled: false }), false);
  assertEquals(resolveHasOralExam("EXAM_FIRST_PLUS", { oral_exam_enabled: true }), true);
});

Deno.test("resolveHasOralExam: STUDIUM always false", () => {
  assertEquals(resolveHasOralExam("STUDIUM"), false);
  assertEquals(resolveHasOralExam("STUDIUM", { oral_exam_enabled: true }), false);
});

// ── B. Step Layout ──

Deno.test("EXAM_FIRST_PLUS without cert: skips learning, minichecks AND oral", () => {
  const skipped = getSkippedSteps("EXAM_FIRST_PLUS");

  assertArrayIncludes(skipped, [
    "scaffold_learning_course",
    "fanout_learning_content",
    "generate_learning_content",
    "finalize_learning_content",
    "validate_learning_content",
    "generate_lesson_minichecks",
    "validate_lesson_minichecks",
    "generate_oral_exam",
    "validate_oral_exam",
  ]);

  // Must NOT skip handbook
  assertEquals(skipped.includes("generate_handbook"), false, "must not skip handbook");
});

Deno.test("EXAM_FIRST_PLUS with cert oral enabled: required includes handbook + oral", () => {
  const cert = { oral_exam_enabled: true };
  const required = getRequiredSteps("EXAM_FIRST_PLUS", cert);

  assertArrayIncludes(required, [
    "generate_handbook",
    "validate_handbook",
    "enqueue_handbook_expand",
    "expand_handbook",
    "validate_handbook_depth",
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

Deno.test("EXAM_FIRST_PLUS with cert oral disabled: no oral in required", () => {
  const cert = { oral_exam_enabled: false };
  const required = getRequiredSteps("EXAM_FIRST_PLUS", cert);

  assertEquals(required.includes("generate_oral_exam"), false, "no oral when cert disabled");
  assertEquals(required.includes("validate_oral_exam"), false, "no validate oral when cert disabled");
  // Handbook still there
  assertArrayIncludes(required, ["generate_handbook", "validate_handbook"]);
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

Deno.test("EXAM_FIRST skips handbook but has oral + elite_harden", () => {
  const required = getRequiredSteps("EXAM_FIRST");
  const skipped = getSkippedSteps("EXAM_FIRST");

  // EXAM_FIRST skips handbook only (no learning either)
  assertArrayIncludes(skipped, [
    "generate_handbook",
    "validate_handbook",
  ]);

  // Has oral exam now
  assertEquals(required.includes("generate_oral_exam"), true, "EXAM_FIRST has oral exam");
  assertEquals(required.includes("validate_oral_exam"), true, "EXAM_FIRST has validate oral");

  // And includes elite_harden (eligible)
  assertEquals(required.includes("elite_harden"), true, "EXAM_FIRST has elite_harden");
});

Deno.test("AUSBILDUNG_VOLL required steps include learning + oral, no elite_harden", () => {
  const required = getRequiredSteps("AUSBILDUNG_VOLL");
  const skipped = getSkippedSteps("AUSBILDUNG_VOLL");

  assertArrayIncludes(required, [
    "scaffold_learning_course",
    "generate_learning_content",
    "validate_learning_content",
    "generate_lesson_minichecks",
    "generate_handbook",
    "generate_oral_exam",
    "validate_oral_exam",
  ]);

  assertArrayIncludes(skipped, [
    "elite_harden",
  ]);
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

Deno.test("case-insensitive normalization works", () => {
  assertEquals(normalizeTrack("fortbildung"), "EXAM_FIRST_PLUS");
  assertEquals(normalizeTrack("Studium"), "STUDIUM");
  assertEquals(normalizeTrack("ausbildung"), "AUSBILDUNG_VOLL");
});

// ── D. Disjoint & Coverage ──

Deno.test("Required and skipped steps are disjoint for every track (no cert)", () => {
  for (const track of TRACKS) {
    const required = new Set(getRequiredSteps(track));
    const skipped = new Set(getSkippedSteps(track));

    for (const step of required) {
      assertEquals(skipped.has(step), false, `${track}: ${step} cannot be both required and skipped`);
    }
    for (const step of skipped) {
      assertEquals(required.has(step), false, `${track}: ${step} cannot be both skipped and required`);
    }
  }
});

Deno.test("Required and skipped are disjoint for EXAM_FIRST_PLUS with cert", () => {
  const cert = { oral_exam_enabled: true };
  const required = new Set(getRequiredSteps("EXAM_FIRST_PLUS", cert));
  const skipped = new Set(getSkippedSteps("EXAM_FIRST_PLUS", cert));

  for (const step of required) {
    assertEquals(skipped.has(step), false, `${step} cannot be both required and skipped`);
  }
});

Deno.test("EXAM_FIRST_PLUS differs from EXAM_FIRST on handbook + oral default", () => {
  const ef = getTrackCapabilities("EXAM_FIRST");
  const efp = getTrackCapabilities("EXAM_FIRST_PLUS");

  // Both are exam-centric
  assertEquals(ef.isExamCentric, true);
  assertEquals(efp.isExamCentric, true);

  // EXAM_FIRST has static oral, EXAM_FIRST_PLUS does not (cert-based)
  assertEquals(ef.hasOralExam, true);
  assertEquals(efp.hasOralExam, false);

  // Both are not exam-only
  assertEquals(ef.isExamOnly, false);
  assertEquals(efp.isExamOnly, false);

  // Differ on handbook
  assertEquals(ef.hasHandbook, false);
  assertEquals(efp.hasHandbook, true);
});

// ── E. Strict Normalization ──

Deno.test("normalizeTrackStrict rejects unknown track", () => {
  assertThrows(
    () => normalizeTrackStrict("FOO_BAR_UNKNOWN"),
    Error,
    "Unknown track",
  );
});

Deno.test("normalizeTrackStrict rejects empty input", () => {
  assertThrows(
    () => normalizeTrackStrict(""),
    Error,
    "Unknown track",
  );
});

Deno.test("normalizeTrackStrict accepts valid canonical tracks", () => {
  for (const track of TRACKS) {
    assertEquals(normalizeTrackStrict(track), track);
  }
});

Deno.test("normalizeTrack tolerant returns fallback for unknown", () => {
  assertEquals(normalizeTrack("TOTALLY_UNKNOWN"), "AUSBILDUNG_VOLL");
  assertEquals(normalizeTrack(""), "AUSBILDUNG_VOLL");
  assertEquals(normalizeTrack(null), "AUSBILDUNG_VOLL");
  assertEquals(normalizeTrack(undefined), "AUSBILDUNG_VOLL");
});

// ── F. Cross-track symmetry ──

Deno.test("Exam-centric tracks have distinct fingerprint from learning tracks", () => {
  const examFirst = getTrackCapabilities("EXAM_FIRST");
  const examPlus = getTrackCapabilities("EXAM_FIRST_PLUS");
  const vollTrack = getTrackCapabilities("AUSBILDUNG_VOLL");
  const studium = getTrackCapabilities("STUDIUM");

  // Exam tracks vs learning tracks
  assertEquals(examFirst.isExamCentric, true);
  assertEquals(examPlus.isExamCentric, true);
  assertEquals(vollTrack.isExamCentric, false);
  assertEquals(studium.isExamCentric, false);

  // Learning tracks have learning course
  assertEquals(vollTrack.hasLearningCourse, true);
  assertEquals(studium.hasLearningCourse, true);
  assertEquals(examFirst.hasLearningCourse, false);
  assertEquals(examPlus.hasLearningCourse, false);
});
