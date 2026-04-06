import { describe, it, expect } from "vitest";
import {
  TRACK_CAPABILITIES,
  getTrackCapabilities,
  getSkippedSteps,
  getRequiredSteps,
  resolveHasOralExam,
  cap,
} from "../track-capabilities";
import type { TrackCapabilities, CertificationContext } from "../track-capabilities";
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
      canSupportOralExam: true,
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
      canSupportOralExam: true,
      hasOralExam: true,
      isExamCentric: true,
      isExamOnly: false,
      eliteHardenEligible: true,
      tutorMode: "exam_only",
    },
    EXAM_FIRST_PLUS: {
      hasLearningCourse: false,
      hasMiniChecks: false,
      hasHandbook: true,
      canSupportOralExam: true,
      hasOralExam: false, // cert-based
      isExamCentric: true,
      isExamOnly: false,
      eliteHardenEligible: true,
      tutorMode: "limited_exam",
    },
    STUDIUM: {
      hasLearningCourse: true,
      hasMiniChecks: true,
      hasHandbook: true,
      canSupportOralExam: true,
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

  it("cap.hasOralExam (static default only)", () => {
    expect(cap.hasOralExam("AUSBILDUNG_VOLL")).toBe(true);
    expect(cap.hasOralExam("EXAM_FIRST")).toBe(true);
    expect(cap.hasOralExam("EXAM_FIRST_PLUS")).toBe(false); // cert-based → static false
    expect(cap.hasOralExam("STUDIUM")).toBe(false);
  });

  it("cap.canSupportOralExam — all tracks can support", () => {
    for (const t of TRACKS) {
      expect(cap.canSupportOralExam(t)).toBe(true);
    }
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

// ── resolveHasOralExam — cert-based resolver ─────────────────

describe("resolveHasOralExam", () => {
  it("AUSBILDUNG_VOLL → always true regardless of cert", () => {
    expect(resolveHasOralExam("AUSBILDUNG_VOLL")).toBe(true);
    expect(resolveHasOralExam("AUSBILDUNG_VOLL", null)).toBe(true);
    expect(resolveHasOralExam("AUSBILDUNG_VOLL", { oral_exam_enabled: false })).toBe(true);
  });

  it("EXAM_FIRST → always true regardless of cert", () => {
    expect(resolveHasOralExam("EXAM_FIRST")).toBe(true);
    expect(resolveHasOralExam("EXAM_FIRST", { oral_exam_enabled: false })).toBe(true);
  });

  it("EXAM_FIRST_PLUS → cert-based", () => {
    expect(resolveHasOralExam("EXAM_FIRST_PLUS")).toBe(false);
    expect(resolveHasOralExam("EXAM_FIRST_PLUS", null)).toBe(false);
    expect(resolveHasOralExam("EXAM_FIRST_PLUS", { oral_exam_enabled: false })).toBe(false);
    expect(resolveHasOralExam("EXAM_FIRST_PLUS", { oral_exam_enabled: null })).toBe(false);
    expect(resolveHasOralExam("EXAM_FIRST_PLUS", { oral_exam_enabled: true })).toBe(true);
  });

  it("STUDIUM → always false regardless of cert", () => {
    expect(resolveHasOralExam("STUDIUM")).toBe(false);
    expect(resolveHasOralExam("STUDIUM", { oral_exam_enabled: true })).toBe(false);
  });

  it("works with aliases", () => {
    expect(resolveHasOralExam("FORTBILDUNG", { oral_exam_enabled: true })).toBe(true);
    expect(resolveHasOralExam("ZERTIFIKAT")).toBe(false);
  });
});

// ── Skipped / Required steps — symmetry & completeness ───────

describe("getSkippedSteps / getRequiredSteps symmetry", () => {
  for (const track of TRACKS) {
    describe(`${track} (no cert context)`, () => {
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

  it("EXAM_FIRST has oral exam + elite, skips learning, minichecks, handbook", () => {
    const req = getRequiredSteps("EXAM_FIRST");
    const skip = getSkippedSteps("EXAM_FIRST");
    expect(skip).toContain("scaffold_learning_course");
    expect(skip).toContain("generate_lesson_minichecks");
    expect(skip).toContain("generate_handbook");
    expect(req).toContain("generate_oral_exam");
    expect(req).toContain("elite_harden");
    expect(req).toContain("generate_exam_pool");
  });

  it("EXAM_FIRST_PLUS without cert skips oral, with cert includes oral", () => {
    // Without certification → no oral exam
    const reqNoCert = getRequiredSteps("EXAM_FIRST_PLUS");
    const skipNoCert = getSkippedSteps("EXAM_FIRST_PLUS");
    expect(reqNoCert).toContain("generate_handbook");
    expect(reqNoCert).toContain("elite_harden");
    expect(skipNoCert).toContain("generate_oral_exam");
    expect(skipNoCert).toContain("scaffold_learning_course");

    // With certification oral_exam_enabled = true → oral exam active
    const cert: CertificationContext = { oral_exam_enabled: true };
    const reqCert = getRequiredSteps("EXAM_FIRST_PLUS", cert);
    const skipCert = getSkippedSteps("EXAM_FIRST_PLUS", cert);
    expect(reqCert).toContain("generate_oral_exam");
    expect(reqCert).toContain("validate_oral_exam");
    expect(skipCert).not.toContain("generate_oral_exam");

    // With certification oral_exam_enabled = false → no oral exam
    const certOff: CertificationContext = { oral_exam_enabled: false };
    const reqCertOff = getRequiredSteps("EXAM_FIRST_PLUS", certOff);
    const skipCertOff = getSkippedSteps("EXAM_FIRST_PLUS", certOff);
    expect(skipCertOff).toContain("generate_oral_exam");
    expect(reqCertOff).not.toContain("generate_oral_exam");
  });

  it("EXAM_FIRST_PLUS with context object syntax", () => {
    const ctx = { track: "EXAM_FIRST_PLUS", certification: { oral_exam_enabled: true } };
    const req = getRequiredSteps(ctx);
    expect(req).toContain("generate_oral_exam");

    const ctxOff = { track: "EXAM_FIRST_PLUS", certification: { oral_exam_enabled: false } };
    const skip = getSkippedSteps(ctxOff);
    expect(skip).toContain("generate_oral_exam");
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
