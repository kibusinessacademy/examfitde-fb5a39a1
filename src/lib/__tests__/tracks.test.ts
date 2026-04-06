import { describe, it, expect } from "vitest";
import {
  TRACKS,
  normalizeTrack,
  normalizeTrackStrict,
  isAcademicTrack,
  isExamFirstTrack,
  isExamFirstPlusTrack,
  isExamOnlyTrack,
  isFullVocationalTrack,
  isExamCentricTrack,
  hasLearningCourseTrack,
  hasHandbookTrack,
  hasOralExamTrack,
  hasMiniChecksTrack,
} from "../tracks";

// ── normalizeTrack ────────────────────────────────────────────

describe("normalizeTrack", () => {
  it.each([
    ["AUSBILDUNG_VOLL", "AUSBILDUNG_VOLL"],
    ["AUSBILDUNG", "AUSBILDUNG_VOLL"],
    ["AUSBILDUNG-VOLL", "AUSBILDUNG_VOLL"],
    ["AUSBILDUNG_VOLL_ELITE", "AUSBILDUNG_VOLL"],
    ["ELITE", "AUSBILDUNG_VOLL"],
    ["EXAM_FIRST", "EXAM_FIRST"],
    ["EXAMFIRST", "EXAM_FIRST"],
    ["EXAM-FIRST", "EXAM_FIRST"],
    ["EXAM_FIRST_PLUS", "EXAM_FIRST_PLUS"],
    ["EXAM-FIRST-PLUS", "EXAM_FIRST_PLUS"],
    ["EXAMFIRSTPLUS", "EXAM_FIRST_PLUS"],
    ["FORTBILDUNG", "EXAM_FIRST_PLUS"],
    ["ZERTIFIKAT", "EXAM_FIRST_PLUS"],
    ["STUDIUM", "STUDIUM"],
    ["HIGHER_ED", "STUDIUM"],
    ["HIGHER_EDUCATION", "STUDIUM"],
    ["BACHELOR", "STUDIUM"],
    ["MASTER", "STUDIUM"],
    ["ACADEMIC", "STUDIUM"],
  ])("maps '%s' → '%s'", (input, expected) => {
    expect(normalizeTrack(input)).toBe(expected);
  });

  it("is case-insensitive", () => {
    expect(normalizeTrack("ausbildung")).toBe("AUSBILDUNG_VOLL");
    expect(normalizeTrack("Studium")).toBe("STUDIUM");
    expect(normalizeTrack("exam_first_plus")).toBe("EXAM_FIRST_PLUS");
  });

  it("trims whitespace", () => {
    expect(normalizeTrack("  STUDIUM  ")).toBe("STUDIUM");
  });

  it("returns fallback for unknown input", () => {
    expect(normalizeTrack("UNKNOWN")).toBe("AUSBILDUNG_VOLL");
    expect(normalizeTrack("UNKNOWN", "STUDIUM")).toBe("STUDIUM");
  });

  it("handles null/undefined/empty gracefully", () => {
    expect(normalizeTrack(null)).toBe("AUSBILDUNG_VOLL");
    expect(normalizeTrack(undefined)).toBe("AUSBILDUNG_VOLL");
    expect(normalizeTrack("")).toBe("AUSBILDUNG_VOLL");
  });
});

// ── normalizeTrackStrict ──────────────────────────────────────

describe("normalizeTrackStrict", () => {
  it("returns canonical track for valid input", () => {
    expect(normalizeTrackStrict("AUSBILDUNG")).toBe("AUSBILDUNG_VOLL");
    expect(normalizeTrackStrict("STUDIUM")).toBe("STUDIUM");
  });

  it("throws on unknown input", () => {
    expect(() => normalizeTrackStrict("BOGUS")).toThrow("Unknown track: BOGUS");
  });

  it("throws on empty/null", () => {
    expect(() => normalizeTrackStrict("")).toThrow("<empty>");
    expect(() => normalizeTrackStrict(null)).toThrow("<empty>");
  });
});

// ── TRACKS constant ──────────────────────────────────────────

describe("TRACKS constant", () => {
  it("contains exactly 4 canonical tracks", () => {
    expect(TRACKS).toHaveLength(4);
    expect([...TRACKS]).toEqual([
      "AUSBILDUNG_VOLL",
      "EXAM_FIRST",
      "EXAM_FIRST_PLUS",
      "STUDIUM",
    ]);
  });
});

// ── Boolean helpers — exhaustive per track ───────────────────

describe("Track boolean helpers", () => {
  const matrix: Record<string, Record<string, boolean>> = {
    AUSBILDUNG_VOLL: {
      isAcademicTrack: false,
      isExamFirstTrack: false,
      isExamFirstPlusTrack: false,
      isExamOnlyTrack: false,
      isFullVocationalTrack: true,
      isExamCentricTrack: false,
      hasLearningCourseTrack: true,
      hasHandbookTrack: true,
      hasOralExamTrack: true,
      hasMiniChecksTrack: true,
    },
    EXAM_FIRST: {
      isAcademicTrack: false,
      isExamFirstTrack: true,
      isExamFirstPlusTrack: false,
      isExamOnlyTrack: false,
      isFullVocationalTrack: false,
      isExamCentricTrack: true,
      hasLearningCourseTrack: false,
      hasHandbookTrack: false,
      hasOralExamTrack: true,
      hasMiniChecksTrack: false,
    },
    EXAM_FIRST_PLUS: {
      isAcademicTrack: false,
      isExamFirstTrack: true,
      isExamFirstPlusTrack: true,
      isExamOnlyTrack: false,
      isFullVocationalTrack: false,
      isExamCentricTrack: true,
      hasLearningCourseTrack: false,
      hasHandbookTrack: true,
      hasOralExamTrack: false, // cert-based, static default is false
      hasMiniChecksTrack: false,
    },
    STUDIUM: {
      isAcademicTrack: true,
      isExamFirstTrack: false,
      isExamFirstPlusTrack: false,
      isExamOnlyTrack: false,
      isFullVocationalTrack: false,
      isExamCentricTrack: false,
      hasLearningCourseTrack: true,
      hasHandbookTrack: true,
      hasOralExamTrack: false,
      hasMiniChecksTrack: true,
    },
  };

  const fns: Record<string, (t: unknown) => boolean> = {
    isAcademicTrack,
    isExamFirstTrack,
    isExamFirstPlusTrack,
    isExamOnlyTrack,
    isFullVocationalTrack,
    isExamCentricTrack,
    hasLearningCourseTrack,
    hasHandbookTrack,
    hasOralExamTrack,
    hasMiniChecksTrack,
  };

  for (const [track, expectations] of Object.entries(matrix)) {
    describe(track, () => {
      for (const [fnName, expected] of Object.entries(expectations)) {
        it(`${fnName}() → ${expected}`, () => {
          expect(fns[fnName](track)).toBe(expected);
        });
      }
    });
  }
});
