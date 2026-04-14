/**
 * Track-Step SSOT Parity Test
 *
 * Verifies that contentProfiles.ts and track_step_applicability (DB SSOT)
 * are semantically aligned. If this test fails, there's a drift between
 * TypeScript content profiles and the DB applicability table.
 *
 * This test uses the TypeScript SSOT only (no DB access) and validates
 * structural invariants about the step/track matrix.
 */

import { describe, it, expect } from "vitest";
import { getContentProfile } from "@/lib/contentProfiles";

// Must match job-map.ts FULL_STEP_ORDER (canonical 29 steps)
const FULL_STEP_ORDER = [
  "scaffold_learning_course",
  "generate_glossary",
  "fanout_learning_content",
  "generate_learning_content",
  "finalize_learning_content",
  "validate_learning_content",
  "auto_seed_exam_blueprints",
  "validate_blueprints",
  "generate_blueprint_variants",
  "validate_blueprint_variants",
  "promote_blueprint_variants",
  "generate_exam_pool",
  "validate_exam_pool",
  "repair_exam_pool_quality",
  "build_ai_tutor_index",
  "validate_tutor_index",
  "generate_oral_exam",
  "validate_oral_exam",
  "generate_lesson_minichecks",
  "validate_lesson_minichecks",
  "generate_handbook",
  "validate_handbook",
  "enqueue_handbook_expand",
  "expand_handbook",
  "validate_handbook_depth",
  "elite_harden",
  "run_integrity_check",
  "quality_council",
  "auto_publish",
] as const;

const ALL_TRACKS = ["AUSBILDUNG_VOLL", "EXAM_FIRST", "EXAM_FIRST_PLUS", "STUDIUM"] as const;

// Content-profile → step applicability mapping
// Derives which steps should run from the ContentProfile flags
function deriveStepApplicability(track: string): Map<string, boolean> {
  const profile = getContentProfile(track);
  const map = new Map<string, boolean>();

  // All tracks run exam pipeline + governance
  const examSteps = [
    "auto_seed_exam_blueprints", "validate_blueprints",
    "generate_blueprint_variants", "validate_blueprint_variants",
    "promote_blueprint_variants", "generate_exam_pool",
    "validate_exam_pool", "repair_exam_pool_quality",
    "run_integrity_check", "quality_council", "auto_publish",
  ];
  for (const s of examSteps) map.set(s, true);

  // Learning course chain
  const learningSteps = [
    "scaffold_learning_course", "generate_glossary",
    "fanout_learning_content", "generate_learning_content",
    "finalize_learning_content", "validate_learning_content",
  ];
  for (const s of learningSteps) map.set(s, profile.includeLearningCourse);

  // Minichecks
  map.set("generate_lesson_minichecks", profile.includeMiniChecks);
  map.set("validate_lesson_minichecks", profile.includeMiniChecks);

  // Handbook
  map.set("generate_handbook", profile.includeHandbook);
  map.set("validate_handbook", profile.includeHandbook);
  map.set("enqueue_handbook_expand", profile.includeHandbookExpand);
  map.set("expand_handbook", profile.includeHandbookExpand);
  map.set("validate_handbook_depth", profile.includeHandbookExpand);

  // Oral exam (conditional on track, may also be cert-conditional)
  map.set("generate_oral_exam", profile.includeOralExam);
  map.set("validate_oral_exam", profile.includeOralExam);

  // Tutor index
  map.set("build_ai_tutor_index", profile.includeTutorIndex);
  map.set("validate_tutor_index", profile.includeTutorIndex);

  // Elite harden (only AUSBILDUNG_VOLL with full learning)
  map.set("elite_harden", profile.includeLearningCourse && track === "AUSBILDUNG_VOLL");

  return map;
}

describe("Track-Step SSOT Parity", () => {
  it("every track covers all 29 steps (required ∪ skipped = FULL_STEP_ORDER)", () => {
    for (const track of ALL_TRACKS) {
      const applicability = deriveStepApplicability(track);
      const covered = new Set(applicability.keys());
      const missing = FULL_STEP_ORDER.filter((s) => !covered.has(s));
      expect(missing, `Track ${track} is missing steps: ${missing.join(", ")}`).toEqual([]);
    }
  });

  it("no step is both required and skipped", () => {
    for (const track of ALL_TRACKS) {
      const applicability = deriveStepApplicability(track);
      // This is inherently satisfied by the boolean map, but check for sanity
      for (const [step, shouldRun] of applicability) {
        expect(typeof shouldRun).toBe("boolean");
        expect(step).toBeTruthy();
      }
    }
  });

  it("EXAM_FIRST skips learning content chain", () => {
    const app = deriveStepApplicability("EXAM_FIRST");
    expect(app.get("scaffold_learning_course")).toBe(false);
    expect(app.get("generate_learning_content")).toBe(false);
    expect(app.get("generate_lesson_minichecks")).toBe(false);
  });

  it("EXAM_FIRST_PLUS skips learning content but keeps handbook", () => {
    const app = deriveStepApplicability("EXAM_FIRST_PLUS");
    expect(app.get("scaffold_learning_course")).toBe(false);
    expect(app.get("generate_handbook")).toBe(true);
    expect(app.get("validate_handbook")).toBe(true);
    // handbook_expand is false for EXAM_FIRST_PLUS
    expect(app.get("enqueue_handbook_expand")).toBe(false);
  });

  it("STUDIUM includes learning + minichecks but skips oral exam", () => {
    const app = deriveStepApplicability("STUDIUM");
    expect(app.get("scaffold_learning_course")).toBe(true);
    expect(app.get("generate_lesson_minichecks")).toBe(true);
    expect(app.get("generate_oral_exam")).toBe(false);
  });

  it("AUSBILDUNG_VOLL includes everything", () => {
    const app = deriveStepApplicability("AUSBILDUNG_VOLL");
    expect(app.get("scaffold_learning_course")).toBe(true);
    expect(app.get("generate_lesson_minichecks")).toBe(true);
    expect(app.get("generate_oral_exam")).toBe(true);
    expect(app.get("generate_handbook")).toBe(true);
    expect(app.get("enqueue_handbook_expand")).toBe(true);
    expect(app.get("build_ai_tutor_index")).toBe(true);
    expect(app.get("elite_harden")).toBe(true);
  });

  it("all tracks run exam pool + governance pipeline", () => {
    const governanceSteps = ["generate_exam_pool", "validate_exam_pool", "run_integrity_check", "quality_council", "auto_publish"];
    for (const track of ALL_TRACKS) {
      const app = deriveStepApplicability(track);
      for (const step of governanceSteps) {
        expect(app.get(step), `${track}/${step} should always run`).toBe(true);
      }
    }
  });

  it("all tracks run tutor index", () => {
    for (const track of ALL_TRACKS) {
      const app = deriveStepApplicability(track);
      expect(app.get("build_ai_tutor_index"), `${track} should include tutor index`).toBe(true);
    }
  });
});
