import { describe, it, expect } from "vitest";
import {
  DEFAULT_FLAGS,
  CERT_TYPE_LABELS,
  TRACK_LABELS,
  requiresLearning,
  requiresHandbook,
  requiresTutorIndex,
  isExamOnlyScore,
  isExamPlusScore,
  isHigherEd,
  type ProductTrack,
  type CertificationType,
  type FeatureFlags,
} from "../../hooks/useTrackConfig";

// ── Label maps ───────────────────────────────────────────────

describe("TRACK_LABELS", () => {
  it("has labels for all 4 tracks", () => {
    const keys: ProductTrack[] = ["AUSBILDUNG_VOLL", "EXAM_FIRST", "EXAM_FIRST_PLUS", "STUDIUM"];
    for (const k of keys) {
      expect(TRACK_LABELS[k]).toBeTruthy();
    }
  });
});

describe("CERT_TYPE_LABELS", () => {
  it("has labels for all certification types", () => {
    const keys: CertificationType[] = [
      "ausbildung", "fortbildung_ihk", "fortbildung_hwk",
      "sachkunde", "branchenzertifikat", "projektmanagement", "studium",
    ];
    for (const k of keys) {
      expect(CERT_TYPE_LABELS[k]).toBeTruthy();
    }
  });
});

// ── DEFAULT_FLAGS consistency ────────────────────────────────

describe("DEFAULT_FLAGS", () => {
  it("AUSBILDUNG_VOLL has full features", () => {
    const f = DEFAULT_FLAGS.AUSBILDUNG_VOLL;
    expect(f.has_learning_course).toBe(true);
    expect(f.has_minichecks).toBe(true);
    expect(f.has_exam_trainer).toBe(true);
    expect(f.has_handbook).toBe(true);
    expect(f.has_oral_exam_trainer).toBe(true);
    expect(f.has_ai_tutor).toBe(true);
    expect(f.ai_tutor_mode).toBe("full");
  });

  it("EXAM_FIRST has no learning/handbook/oral", () => {
    const f = DEFAULT_FLAGS.EXAM_FIRST;
    expect(f.has_learning_course).toBe(false);
    expect(f.has_handbook).toBe(false);
    expect(f.has_oral_exam_trainer).toBe(false);
    expect(f.has_minichecks).toBe(false);
    expect(f.has_exam_trainer).toBe(true);
    expect(f.ai_tutor_mode).toBe("limited_exam");
  });

  it("EXAM_FIRST_PLUS has handbook + oral, no learning", () => {
    const f = DEFAULT_FLAGS.EXAM_FIRST_PLUS;
    expect(f.has_learning_course).toBe(false);
    expect(f.has_handbook).toBe(true);
    expect(f.has_oral_exam_trainer).toBe(true);
    expect(f.has_minichecks).toBe(false);
    expect(f.ai_tutor_mode).toBe("limited_exam");
  });

  it("STUDIUM has learning + minichecks, no oral", () => {
    const f = DEFAULT_FLAGS.STUDIUM;
    expect(f.has_learning_course).toBe(true);
    expect(f.has_minichecks).toBe(true);
    expect(f.has_handbook).toBe(true);
    expect(f.has_oral_exam_trainer).toBe(false);
    expect(f.ai_tutor_mode).toBe("full");
  });

  it("DEFAULT_FLAGS align with TRACK_CAPABILITIES", () => {
    // Cross-check: learning course flag matches capability
    expect(DEFAULT_FLAGS.AUSBILDUNG_VOLL.has_learning_course).toBe(true);
    expect(DEFAULT_FLAGS.EXAM_FIRST.has_learning_course).toBe(false);
    expect(DEFAULT_FLAGS.EXAM_FIRST_PLUS.has_learning_course).toBe(false);
    expect(DEFAULT_FLAGS.STUDIUM.has_learning_course).toBe(true);
  });
});

// ── SSOT track interpreter functions ─────────────────────────

describe("Track interpreter helpers", () => {
  const tracks: ProductTrack[] = ["AUSBILDUNG_VOLL", "EXAM_FIRST", "EXAM_FIRST_PLUS", "STUDIUM"];

  describe("requiresLearning", () => {
    it.each([
      ["AUSBILDUNG_VOLL", true],
      ["EXAM_FIRST", false],
      ["EXAM_FIRST_PLUS", false],
      ["STUDIUM", true],
    ] as const)("%s → %s", (t, expected) => {
      expect(requiresLearning(t)).toBe(expected);
    });
  });

  describe("requiresHandbook", () => {
    it.each([
      ["AUSBILDUNG_VOLL", true],
      ["EXAM_FIRST", false],
      ["EXAM_FIRST_PLUS", true],
      ["STUDIUM", true],
    ] as const)("%s → %s", (t, expected) => {
      expect(requiresHandbook(t)).toBe(expected);
    });
  });

  describe("requiresTutorIndex", () => {
    it.each([
      ["AUSBILDUNG_VOLL", true],
      ["EXAM_FIRST", false],
      ["EXAM_FIRST_PLUS", true],
      ["STUDIUM", true],
    ] as const)("%s → %s", (t, expected) => {
      expect(requiresTutorIndex(t)).toBe(expected);
    });
  });

  describe("isExamOnlyScore", () => {
    it("true only for EXAM_FIRST", () => {
      expect(isExamOnlyScore("EXAM_FIRST")).toBe(true);
      for (const t of tracks.filter(x => x !== "EXAM_FIRST")) {
        expect(isExamOnlyScore(t)).toBe(false);
      }
    });
  });

  describe("isExamPlusScore", () => {
    it("true only for EXAM_FIRST_PLUS", () => {
      expect(isExamPlusScore("EXAM_FIRST_PLUS")).toBe(true);
      for (const t of tracks.filter(x => x !== "EXAM_FIRST_PLUS")) {
        expect(isExamPlusScore(t)).toBe(false);
      }
    });
  });

  describe("isHigherEd", () => {
    it("true only for STUDIUM", () => {
      expect(isHigherEd("STUDIUM")).toBe(true);
      for (const t of tracks.filter(x => x !== "STUDIUM")) {
        expect(isHigherEd(t)).toBe(false);
      }
    });
  });
});
