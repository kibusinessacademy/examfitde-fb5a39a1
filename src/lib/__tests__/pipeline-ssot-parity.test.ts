/**
 * Pipeline SSOT Parity Test
 * 
 * Ensures frontend and backend step registries are IDENTICAL.
 * Ensures track capabilities form a complete partition of FULL_STEP_ORDER.
 * 
 * If this test fails, you have SSOT drift — fix it immediately.
 */
import { describe, it, expect } from "vitest";
import {
  FULL_STEP_ORDER,
  type PipelineStepKey,
} from "../pipeline-steps";
import {
  FULL_STEP_ORDER as POLICY_STEP_ORDER,
} from "../pipeline/stepPolicy";
import {
  getRequiredSteps,
  getSkippedSteps,
} from "../track-capabilities";

// ── Backend SSOT reference (must match job-map.ts exactly) ──
const BACKEND_FULL_STEP_ORDER: string[] = [
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
];

describe("Pipeline SSOT Parity (Frontend ↔ Backend)", () => {
  it("pipeline-steps.ts FULL_STEP_ORDER matches backend exactly (29 steps)", () => {
    expect(FULL_STEP_ORDER).toHaveLength(29);
    expect(FULL_STEP_ORDER).toEqual(BACKEND_FULL_STEP_ORDER);
  });

  it("stepPolicy.ts FULL_STEP_ORDER matches backend exactly", () => {
    expect([...POLICY_STEP_ORDER]).toEqual(BACKEND_FULL_STEP_ORDER);
  });

  it("pipeline-steps.ts and stepPolicy.ts are identical", () => {
    expect(FULL_STEP_ORDER).toEqual([...POLICY_STEP_ORDER]);
  });
});

describe("Track Capability Partition Completeness", () => {
  const TRACKS = ["AUSBILDUNG_VOLL", "EXAM_FIRST", "EXAM_FIRST_PLUS", "STUDIUM"] as const;

  for (const track of TRACKS) {
    it(`${track}: required ∪ skipped = FULL_STEP_ORDER`, () => {
      const required = new Set(getRequiredSteps(track));
      const skipped = new Set(getSkippedSteps(track));
      const union = new Set([...required, ...skipped]);

      const fullSet = new Set(BACKEND_FULL_STEP_ORDER);
      const missing = [...fullSet].filter(k => !union.has(k));
      const extra = [...union].filter(k => !fullSet.has(k));

      expect(missing).toEqual([]);
      expect(extra).toEqual([]);
      expect(union.size).toBe(BACKEND_FULL_STEP_ORDER.length);
    });

    it(`${track}: required ∩ skipped = ∅ (no overlap)`, () => {
      const required = new Set(getRequiredSteps(track));
      const skipped = new Set(getSkippedSteps(track));
      const overlap = [...required].filter(k => skipped.has(k));
      expect(overlap).toEqual([]);
    });
  }
});

describe("STEP_TO_JOB_TYPE Uniqueness", () => {
  // Import is backend-only; mirror the mapping here for uniqueness check
  const STEP_TO_JOB_TYPE: Record<string, string> = {
    scaffold_learning_course: "package_scaffold_learning_course",
    generate_glossary: "package_generate_glossary",
    fanout_learning_content: "package_fanout_learning_content",
    generate_learning_content: "package_generate_learning_content",
    finalize_learning_content: "package_finalize_learning_content",
    validate_learning_content: "package_validate_learning_content",
    auto_seed_exam_blueprints: "package_auto_seed_exam_blueprints",
    validate_blueprints: "package_validate_blueprints",
    generate_blueprint_variants: "package_generate_blueprint_variants",
    validate_blueprint_variants: "package_validate_blueprint_variants",
    promote_blueprint_variants: "package_promote_blueprint_variants",
    generate_exam_pool: "package_generate_exam_pool",
    validate_exam_pool: "package_validate_exam_pool",
    repair_exam_pool_quality: "package_repair_exam_pool_quality",
    build_ai_tutor_index: "package_build_ai_tutor_index",
    validate_tutor_index: "package_validate_tutor_index",
    generate_oral_exam: "package_generate_oral_exam",
    validate_oral_exam: "package_validate_oral_exam",
    generate_lesson_minichecks: "package_generate_lesson_minichecks",
    validate_lesson_minichecks: "package_validate_lesson_minichecks",
    generate_handbook: "package_generate_handbook",
    validate_handbook: "package_validate_handbook",
    enqueue_handbook_expand: "package_enqueue_handbook_expand",
    expand_handbook: "handbook_expand_section",
    validate_handbook_depth: "package_validate_handbook_depth",
    elite_harden: "package_elite_harden",
    run_integrity_check: "package_run_integrity_check",
    quality_council: "package_quality_council",
    auto_publish: "package_auto_publish",
  };

  it("every job_type maps to exactly one step (no duplicates)", () => {
    const jobTypes = Object.values(STEP_TO_JOB_TYPE);
    const unique = new Set(jobTypes);
    const duplicates = jobTypes.filter((jt, i) => jobTypes.indexOf(jt) !== i);
    expect(duplicates).toEqual([]);
    expect(unique.size).toBe(jobTypes.length);
  });

  it("step keys in STEP_TO_JOB_TYPE match FULL_STEP_ORDER exactly", () => {
    const mappingKeys = Object.keys(STEP_TO_JOB_TYPE);
    expect(mappingKeys).toEqual(BACKEND_FULL_STEP_ORDER);
  });

  it("no null/undefined values in STEP_TO_JOB_TYPE", () => {
    for (const [step, jobType] of Object.entries(STEP_TO_JOB_TYPE)) {
      expect(jobType).toBeTruthy();
    }
  });
});

describe("Critical Safety Guards", () => {
  it("AUSBILDUNG_VOLL must include learning course, minichecks, handbook", () => {
    const required = new Set(getRequiredSteps("AUSBILDUNG_VOLL"));
    expect(required.has("scaffold_learning_course")).toBe(true);
    expect(required.has("generate_learning_content")).toBe(true);
    expect(required.has("generate_lesson_minichecks")).toBe(true);
    expect(required.has("generate_handbook")).toBe(true);
  });

  it("EXAM_FIRST must skip learning course, minichecks", () => {
    const skipped = new Set(getSkippedSteps("EXAM_FIRST"));
    expect(skipped.has("scaffold_learning_course")).toBe(true);
    expect(skipped.has("generate_learning_content")).toBe(true);
    expect(skipped.has("generate_lesson_minichecks")).toBe(true);
  });

  it("auto_publish is always last", () => {
    expect(FULL_STEP_ORDER[FULL_STEP_ORDER.length - 1]).toBe("auto_publish");
  });

  it("no duplicate step keys in FULL_STEP_ORDER", () => {
    expect(new Set(FULL_STEP_ORDER).size).toBe(FULL_STEP_ORDER.length);
  });
});
