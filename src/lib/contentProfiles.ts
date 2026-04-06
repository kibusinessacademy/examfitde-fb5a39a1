/**
 * Content Profiles — SSOT for production depth per track.
 *
 * Controls which artifacts are required, quality thresholds,
 * and trap distribution rules for each track.
 */

import { normalizeTrack, type Track } from "./tracks";

export type TrapType = "misconception" | "typical_error" | "calculation_trap";

export interface TrapDistributionRule {
  target: number;
  min: number;
  max: number;
  warnBelow: number;
  hardBelow: number;
}

export interface ContentProfile {
  track: Track;

  // ── Learning ──────────────────────────────────────
  includeLearningCourse: boolean;
  includeMiniChecks: boolean;
  includeHandbook: boolean;
  includeHandbookExpand: boolean;

  // ── Exam ──────────────────────────────────────────
  includeExamPool: boolean;
  includeExamSimulation: boolean;
  minApprovedExamQuestions: number;
  recommendedApprovedExamQuestions: number;

  // ── Oral / Tutor ──────────────────────────────────
  includeOralExam: boolean;
  oralExamOptional: boolean;
  includeTutorIndex: boolean;
  tutorDepth: "none" | "reduced" | "full";

  // ── Quality Thresholds ────────────────────────────
  requireTrapCoverage: boolean;
  minTrapCoveragePct: number;
  minExplanationCoveragePct: number;
  minDistractorCoveragePct: number;

  // ── Trap Distribution ─────────────────────────────
  trapDistribution: Record<TrapType, TrapDistributionRule>;
}

// ── Trap Distribution Presets ──────────────────────────────

const VOCATIONAL_TRAPS: Record<TrapType, TrapDistributionRule> = {
  misconception:    { target: 35, min: 25, max: 45, warnBelow: 20, hardBelow: 15 },
  typical_error:    { target: 40, min: 30, max: 50, warnBelow: 25, hardBelow: 20 },
  calculation_trap: { target: 25, min: 15, max: 35, warnBelow: 10, hardBelow: 5 },
};

const EXAM_FIRST_TRAPS: Record<TrapType, TrapDistributionRule> = {
  misconception:    { target: 30, min: 20, max: 40, warnBelow: 18, hardBelow: 12 },
  typical_error:    { target: 45, min: 35, max: 55, warnBelow: 28, hardBelow: 22 },
  calculation_trap: { target: 25, min: 12, max: 35, warnBelow: 8,  hardBelow: 5 },
};

const EXAM_FIRST_PLUS_TRAPS: Record<TrapType, TrapDistributionRule> = {
  misconception:    { target: 30, min: 20, max: 40, warnBelow: 18, hardBelow: 12 },
  typical_error:    { target: 45, min: 35, max: 55, warnBelow: 28, hardBelow: 22 },
  calculation_trap: { target: 25, min: 12, max: 35, warnBelow: 8,  hardBelow: 5 },
};

const STUDIUM_TRAPS: Record<TrapType, TrapDistributionRule> = {
  misconception:    { target: 45, min: 30, max: 60, warnBelow: 25, hardBelow: 20 },
  typical_error:    { target: 35, min: 20, max: 45, warnBelow: 18, hardBelow: 12 },
  calculation_trap: { target: 20, min: 10, max: 35, warnBelow: 8,  hardBelow: 5 },
};

// ── Track Profiles ──────────────────────────────────────────

export const AUSBILDUNG_PROFILE: ContentProfile = {
  track: "AUSBILDUNG_VOLL",

  includeLearningCourse: true,
  includeMiniChecks: true,
  includeHandbook: true,
  includeHandbookExpand: true,

  includeExamPool: true,
  includeExamSimulation: true,
  minApprovedExamQuestions: 800,
  recommendedApprovedExamQuestions: 1200,

  includeOralExam: true,
  oralExamOptional: false,
  includeTutorIndex: true,
  tutorDepth: "full",

  requireTrapCoverage: true,
  minTrapCoveragePct: 85,
  minExplanationCoveragePct: 95,
  minDistractorCoveragePct: 95,

  trapDistribution: VOCATIONAL_TRAPS,
};

export const EXAM_FIRST_PROFILE: ContentProfile = {
  track: "EXAM_FIRST",

  includeLearningCourse: false,
  includeMiniChecks: false,
  includeHandbook: false,
  includeHandbookExpand: false,

  includeExamPool: true,
  includeExamSimulation: true,
  minApprovedExamQuestions: 300,
  recommendedApprovedExamQuestions: 500,

  includeOralExam: true,
  oralExamOptional: false,
  includeTutorIndex: true,
  tutorDepth: "reduced",

  requireTrapCoverage: true,
  minTrapCoveragePct: 85,
  minExplanationCoveragePct: 90,
  minDistractorCoveragePct: 90,

  trapDistribution: EXAM_FIRST_TRAPS,
};

export const STUDIUM_PROFILE: ContentProfile = {
  track: "STUDIUM",
  // ... keep existing ...
  includeLearningCourse: true,
  includeMiniChecks: true,
  includeHandbook: true,
  includeHandbookExpand: true,
  includeExamPool: true,
  includeExamSimulation: true,
  minApprovedExamQuestions: 400,
  recommendedApprovedExamQuestions: 700,
  includeOralExam: false,
  oralExamOptional: true,
  includeTutorIndex: true,
  tutorDepth: "full",
  requireTrapCoverage: true,
  minTrapCoveragePct: 80,
  minExplanationCoveragePct: 92,
  minDistractorCoveragePct: 90,
  trapDistribution: STUDIUM_TRAPS,
};

export const EXAM_FIRST_PLUS_PROFILE: ContentProfile = {
  track: "EXAM_FIRST_PLUS",

  includeLearningCourse: false,
  includeMiniChecks: false,
  includeHandbook: true,
  includeHandbookExpand: false,

  includeExamPool: true,
  includeExamSimulation: true,
  minApprovedExamQuestions: 300,
  recommendedApprovedExamQuestions: 600,

  includeOralExam: true,
  oralExamOptional: true,
  includeTutorIndex: true,
  tutorDepth: "reduced",

  requireTrapCoverage: true,
  minTrapCoveragePct: 85,
  minExplanationCoveragePct: 90,
  minDistractorCoveragePct: 90,

  trapDistribution: EXAM_FIRST_PLUS_TRAPS,
};

const PROFILES: Record<Track, ContentProfile> = {
  AUSBILDUNG_VOLL: AUSBILDUNG_PROFILE,
  EXAM_FIRST: EXAM_FIRST_PROFILE,
  EXAM_FIRST_PLUS: EXAM_FIRST_PLUS_PROFILE,
  STUDIUM: STUDIUM_PROFILE,
};

export function getContentProfile(track: unknown): ContentProfile {
  return PROFILES[normalizeTrack(track)];
}
