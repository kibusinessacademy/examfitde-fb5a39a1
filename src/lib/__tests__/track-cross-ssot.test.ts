import { describe, it, expect } from "vitest";
import { TRACKS } from "../tracks";
import {
  TRACK_CAPABILITIES,
  getSkippedSteps,
  getRequiredSteps,
} from "../track-capabilities";
import {
  DEFAULT_FLAGS,
  TRACK_LABELS,
  requiresLearning,
  requiresHandbook,
  requiresTutorIndex,
  type ProductTrack,
} from "../../hooks/useTrackConfig";
import { CERT_TYPE_LABELS } from "../../hooks/useTrackConfig";

// ═══════════════════════════════════════════════════════════════
// 1. Cross-SSOT Consistency — capabilities ↔ flags ↔ interpreters ↔ steps
// ═══════════════════════════════════════════════════════════════

describe("Cross-SSOT Consistency", () => {
  for (const track of TRACKS) {
    const cap = TRACK_CAPABILITIES[track];
    const flags = DEFAULT_FLAGS[track as ProductTrack];
    const required = getRequiredSteps(track);
    const skipped = getSkippedSteps(track);

    describe(track, () => {
      // capabilities ↔ DEFAULT_FLAGS
      it("hasLearningCourse ↔ has_learning_course flag", () => {
        expect(cap.hasLearningCourse).toBe(flags.has_learning_course);
      });
      it("hasMiniChecks ↔ has_minichecks flag", () => {
        expect(cap.hasMiniChecks).toBe(flags.has_minichecks);
      });
      it("hasHandbook ↔ has_handbook flag", () => {
        expect(cap.hasHandbook).toBe(flags.has_handbook);
      });
      it("hasOralExam ↔ has_oral_exam_trainer flag", () => {
        expect(cap.hasOralExam).toBe(flags.has_oral_exam_trainer);
      });

      // capabilities ↔ interpreter functions
      it("hasLearningCourse ↔ requiresLearning()", () => {
        expect(cap.hasLearningCourse).toBe(requiresLearning(track as ProductTrack));
      });
      it("hasHandbook ↔ requiresHandbook()", () => {
        expect(cap.hasHandbook).toBe(requiresHandbook(track as ProductTrack));
      });
      it("requiresTutorIndex() is always true", () => {
        expect(requiresTutorIndex(track as ProductTrack)).toBe(true);
      });

      // capabilities ↔ step composition
      it("hasLearningCourse → scaffold_learning_course in required/skipped", () => {
        if (cap.hasLearningCourse) {
          expect(required).toContain("scaffold_learning_course");
          expect(skipped).not.toContain("scaffold_learning_course");
        } else {
          expect(skipped).toContain("scaffold_learning_course");
          expect(required).not.toContain("scaffold_learning_course");
        }
      });
      it("hasHandbook → generate_handbook in required/skipped", () => {
        if (cap.hasHandbook) {
          expect(required).toContain("generate_handbook");
          expect(skipped).not.toContain("generate_handbook");
        } else {
          expect(skipped).toContain("generate_handbook");
          expect(required).not.toContain("generate_handbook");
        }
      });
      it("hasOralExam → generate_oral_exam in required/skipped", () => {
        if (cap.hasOralExam) {
          expect(required).toContain("generate_oral_exam");
          expect(skipped).not.toContain("generate_oral_exam");
        } else {
          expect(skipped).toContain("generate_oral_exam");
          expect(required).not.toContain("generate_oral_exam");
        }
      });
      it("hasMiniChecks → generate_lesson_minichecks in required/skipped", () => {
        if (cap.hasMiniChecks) {
          expect(required).toContain("generate_lesson_minichecks");
          expect(skipped).not.toContain("generate_lesson_minichecks");
        } else {
          expect(skipped).toContain("generate_lesson_minichecks");
          expect(required).not.toContain("generate_lesson_minichecks");
        }
      });
      it("eliteHardenEligible → elite_harden in required/skipped", () => {
        if (cap.eliteHardenEligible) {
          expect(required).toContain("elite_harden");
          expect(skipped).not.toContain("elite_harden");
        } else {
          expect(skipped).toContain("elite_harden");
          expect(required).not.toContain("elite_harden");
        }
      });
    });
  }
});

// ═══════════════════════════════════════════════════════════════
// 2. New-Track Drift Guard — every canonical track must exist in ALL maps
// ═══════════════════════════════════════════════════════════════

describe("New-Track Drift Guard", () => {
  for (const track of TRACKS) {
    it(`${track} exists in TRACK_CAPABILITIES`, () => {
      expect(TRACK_CAPABILITIES).toHaveProperty(track);
    });
    it(`${track} exists in DEFAULT_FLAGS`, () => {
      expect(DEFAULT_FLAGS).toHaveProperty(track);
    });
    it(`${track} exists in TRACK_LABELS`, () => {
      expect(TRACK_LABELS).toHaveProperty(track);
    });
    it(`${track} produces non-empty requiredSteps`, () => {
      expect(getRequiredSteps(track).length).toBeGreaterThan(0);
    });
  }

  it("no extra keys in TRACK_CAPABILITIES beyond TRACKS", () => {
    expect(Object.keys(TRACK_CAPABILITIES).sort()).toEqual([...TRACKS].sort());
  });
  it("no extra keys in DEFAULT_FLAGS beyond TRACKS", () => {
    expect(Object.keys(DEFAULT_FLAGS).sort()).toEqual([...TRACKS].sort());
  });
  it("no extra keys in TRACK_LABELS beyond TRACKS", () => {
    expect(Object.keys(TRACK_LABELS).sort()).toEqual([...TRACKS].sort());
  });
});

// ═══════════════════════════════════════════════════════════════
// 3. Pipeline Contract — hard invariants that must never break
// ═══════════════════════════════════════════════════════════════

const CORE_STEPS = [
  "generate_exam_pool",
  "validate_exam_pool",
  "build_ai_tutor_index",
  "validate_tutor_index",
  "run_integrity_check",
  "quality_council",
  "auto_publish",
] as const;

describe("Pipeline Contract", () => {
  for (const track of TRACKS) {
    const required = getRequiredSteps(track);
    const skipped = getSkippedSteps(track);

    describe(track, () => {
      it("required ∩ skipped = ∅", () => {
        const overlap = required.filter(s => skipped.includes(s));
        expect(overlap).toEqual([]);
      });

      for (const step of CORE_STEPS) {
        it(`core step '${step}' is always required`, () => {
          expect(required).toContain(step);
        });
        it(`core step '${step}' is never skipped`, () => {
          expect(skipped).not.toContain(step);
        });
      }
    });
  }
});
