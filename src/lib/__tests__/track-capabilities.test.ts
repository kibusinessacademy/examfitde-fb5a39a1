import { describe, it, expect } from "vitest";
import {
  TRACK_CAPABILITIES,
  getTrackCapabilities,
  getSkippedSteps,
  getRequiredSteps,
  cap,
} from "../track-capabilities";
import type { TrackCapabilities } from "../track-capabilities";
import { TRACKS } from "../tracks";

// ── Capability map completeness ──────────────────────────────

describe("TRACK_CAPABILITIES map", () => {
  it("has an entry for every canonical track", () => {
    for (const t of TRACKS) {
      expect(TRACK_CAPABILITIES[t]).toBeDefined();
    }
  });

  it("has no extra keys", () => {
    expect(Object.keys(TRACK_CAPABILITIES).sort()).toEqual([...TRACKS].sort());
  });
});

// ── Per-track capability snapshot ────────────────────────────

describe("Capability snapshots", () => {
  const expected: Record<string, TrackCapabilities> = {
    AUSBILDUNG_VOLL: {
      hasLearningCourse: true,
      hasMiniChecks: true,
      hasHandbook: true,
      hasOralExam: true,
      isExamCentric: false,
      isExamOnly: false,
      eliteHardenEligible: false,
      tutorMode: "full",
    },
    EXAM_FIRST: {
      hasLearningCourse: false,
      hasMiniChecks: false,
      hasHandbook: false,
      hasOralExam: false,
      isExamCentric: true,
      isExamOnly: true,
      eliteHardenEligible: true,
      tutorMode: "exam_only",
    },
    EXAM_FIRST_PLUS: {
      hasLearningCourse: false,
      hasMiniChecks: false,
      hasHandbook: true,
      hasOralExam: true,
      isExamCentric: true,
      isExamOnly: false,
      eliteHardenEligible: true,
      tutorMode: "limited_exam",
    },
    STUDIUM: {
      hasLearningCourse: true,
      hasMiniChecks: true,
      hasHandbook: true,
      hasOralExam: false,
      isExamCentric: false,
      isExamOnly: false,
      eliteHardenEligible: false,
      tutorMode: "full",
    },
  };

  for (const [track, caps] of Object.entries(expected)) {
    it(`${track} matches expected capabilities`, () => {
      expect(TRACK_CAPABILITIES[track as keyof typeof TRACK_CAPABILITIES]).toEqual(caps);
    });
  }
});

// ── getTrackCapabilities with aliases ────────────────────────

describe("getTrackCapabilities", () => {
  it("resolves aliases", () => {
    expect(getTrackCapabilities("FORTBILDUNG")).toEqual(TRACK_CAPABILITIES.EXAM_FIRST_PLUS);
    expect(getTrackCapabilities("BACHELOR")).toEqual(TRACK_CAPABILITIES.STUDIUM);
    expect(getTrackCapabilities("ELITE")).toEqual(TRACK_CAPABILITIES.AUSBILDUNG_VOLL);
  });

  it("falls back to AUSBILDUNG_VOLL for unknown input", () => {
    expect(getTrackCapabilities("NOPE")).toEqual(TRACK_CAPABILITIES.AUSBILDUNG_VOLL);
  });
});

// ── cap.* convenience accessors ──────────────────────────────

describe("cap convenience accessors", () => {
  it("cap.hasLearningCourse", () => {
    expect(cap.hasLearningCourse("AUSBILDUNG_VOLL")).toBe(true);
    expect(cap.hasLearningCourse("EXAM_FIRST")).toBe(false);
  });

  it("cap.hasOralExam", () => {
    expect(cap.hasOralExam("EXAM_FIRST_PLUS")).toBe(true);
    expect(cap.hasOralExam("STUDIUM")).toBe(false);
  });

  it("cap.eliteHardenEligible", () => {
    expect(cap.eliteHardenEligible("EXAM_FIRST")).toBe(true);
    expect(cap.eliteHardenEligible("AUSBILDUNG_VOLL")).toBe(false);
  });

  it("cap.tutorMode", () => {
    expect(cap.tutorMode("AUSBILDUNG_VOLL")).toBe("full");
    expect(cap.tutorMode("EXAM_FIRST")).toBe("exam_only");
    expect(cap.tutorMode("EXAM_FIRST_PLUS")).toBe("limited_exam");
    expect(cap.tutorMode("STUDIUM")).toBe("full");
  });
});

// ── Skipped / Required steps — symmetry & completeness ───────

describe("getSkippedSteps / getRequiredSteps symmetry", () => {
  for (const track of TRACKS) {
    describe(track, () => {
      const skipped = getSkippedSteps(track);
      const required = getRequiredSteps(track);

      it("skipped and required are disjoint", () => {
        const overlap = skipped.filter(s => required.includes(s));
        expect(overlap).toEqual([]);
      });

      it("no duplicates in skipped", () => {
        expect(new Set(skipped).size).toBe(skipped.length);
      });

      it("no duplicates in required", () => {
        expect(new Set(required).size).toBe(required.length);
      });
    });
  }
});

// ── Track-specific step assertions ───────────────────────────

describe("Step composition per track", () => {
  it("AUSBILDUNG_VOLL includes learning + minichecks + handbook + oral, no elite", () => {
    const req = getRequiredSteps("AUSBILDUNG_VOLL");
    const skip = getSkippedSteps("AUSBILDUNG_VOLL");
    expect(req).toContain("scaffold_learning_course");
    expect(req).toContain("generate_lesson_minichecks");
    expect(req).toContain("generate_handbook");
    expect(req).toContain("generate_oral_exam");
    expect(skip).toContain("elite_harden");
  });

  it("EXAM_FIRST skips learning, minichecks, handbook, oral; has elite", () => {
    const req = getRequiredSteps("EXAM_FIRST");
    const skip = getSkippedSteps("EXAM_FIRST");
    expect(skip).toContain("scaffold_learning_course");
    expect(skip).toContain("generate_lesson_minichecks");
    expect(skip).toContain("generate_handbook");
    expect(skip).toContain("generate_oral_exam");
    expect(req).toContain("elite_harden");
    expect(req).toContain("generate_exam_pool");
  });

  it("EXAM_FIRST_PLUS has handbook + oral + elite, no learning/minichecks", () => {
    const req = getRequiredSteps("EXAM_FIRST_PLUS");
    const skip = getSkippedSteps("EXAM_FIRST_PLUS");
    expect(req).toContain("generate_handbook");
    expect(req).toContain("generate_oral_exam");
    expect(req).toContain("elite_harden");
    expect(skip).toContain("scaffold_learning_course");
    expect(skip).toContain("generate_lesson_minichecks");
  });

  it("STUDIUM has learning + minichecks + handbook, no oral/elite", () => {
    const req = getRequiredSteps("STUDIUM");
    const skip = getSkippedSteps("STUDIUM");
    expect(req).toContain("scaffold_learning_course");
    expect(req).toContain("generate_lesson_minichecks");
    expect(req).toContain("generate_handbook");
    expect(skip).toContain("generate_oral_exam");
    expect(skip).toContain("elite_harden");
  });

  it("all tracks include core exam + publish steps", () => {
    for (const track of TRACKS) {
      const req = getRequiredSteps(track);
      expect(req).toContain("generate_exam_pool");
      expect(req).toContain("validate_exam_pool");
      expect(req).toContain("build_ai_tutor_index");
      expect(req).toContain("run_integrity_check");
      expect(req).toContain("quality_council");
      expect(req).toContain("auto_publish");
    }
  });
});
