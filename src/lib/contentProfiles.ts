/**
 * Content Profiles — SSOT for production depth per track + persona.
 *
 * Controls which artifacts are required, quality thresholds,
 * and trap distribution rules for each track.
 * 
 * v2: Persona-aware — uses persona config for differentiated thresholds.
 */

import { normalizeTrack, type Track } from "./tracks";
import { resolvePersonaProfile, type PersonaProfile } from "./persona-profiles";

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
  persona: PersonaProfile;

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

const VOCATIONAL_LIGHT_TRAPS: Record<TrapType, TrapDistributionRule> = {
  misconception:    { target: 30, min: 20, max: 40, warnBelow: 15, hardBelow: 10 },
  typical_error:    { target: 45, min: 35, max: 55, warnBelow: 28, hardBelow: 22 },
  calculation_trap: { target: 25, min: 12, max: 35, warnBelow: 8,  hardBelow: 5 },
};

const SACHKUNDE_TRAPS: Record<TrapType, TrapDistributionRule> = {
  misconception:    { target: 25, min: 15, max: 35, warnBelow: 12, hardBelow: 8 },
  typical_error:    { target: 50, min: 40, max: 60, warnBelow: 32, hardBelow: 25 },
  calculation_trap: { target: 25, min: 10, max: 35, warnBelow: 8,  hardBelow: 5 },
};

const FACHWIRT_TRAPS: Record<TrapType, TrapDistributionRule> = {
  misconception:    { target: 30, min: 20, max: 40, warnBelow: 18, hardBelow: 12 },
  typical_error:    { target: 45, min: 35, max: 55, warnBelow: 28, hardBelow: 22 },
  calculation_trap: { target: 25, min: 12, max: 35, warnBelow: 8,  hardBelow: 5 },
};

const STUDIUM_TRAPS: Record<TrapType, TrapDistributionRule> = {
  misconception:    { target: 45, min: 30, max: 60, warnBelow: 25, hardBelow: 20 },
  typical_error:    { target: 35, min: 20, max: 45, warnBelow: 18, hardBelow: 12 },
  calculation_trap: { target: 20, min: 10, max: 35, warnBelow: 8,  hardBelow: 5 },
};

// ── Persona Profiles ──────────────────────────────────────────

const AZUBI_HIGH_ROI_PROFILE: ContentProfile = {
  track: "AUSBILDUNG_VOLL",
  persona: "AZUBI_HIGH_ROI",
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

const AZUBI_LOW_ROI_PROFILE: ContentProfile = {
  track: "AUSBILDUNG_VOLL",
  persona: "AZUBI_LOW_ROI",
  includeLearningCourse: false,
  includeMiniChecks: false,
  includeHandbook: true,
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
  minTrapCoveragePct: 80,
  minExplanationCoveragePct: 90,
  minDistractorCoveragePct: 90,
  trapDistribution: VOCATIONAL_LIGHT_TRAPS,
};

const SACHKUNDE_PROFILE: ContentProfile = {
  track: "EXAM_FIRST",
  persona: "SACHKUNDE",
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
  minTrapCoveragePct: 80,
  minExplanationCoveragePct: 85,
  minDistractorCoveragePct: 85,
  trapDistribution: SACHKUNDE_TRAPS,
};

const FACHWIRT_PROFILE: ContentProfile = {
  track: "EXAM_FIRST_PLUS",
  persona: "FACHWIRT",
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
  trapDistribution: FACHWIRT_TRAPS,
};

const STUDIUM_CONTENT_PROFILE: ContentProfile = {
  track: "STUDIUM",
  persona: "STUDIUM",
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

// ── Lookup ─────────────────────────────────────────────────────

const PERSONA_PROFILES: Record<PersonaProfile, ContentProfile> = {
  AZUBI_HIGH_ROI: AZUBI_HIGH_ROI_PROFILE,
  AZUBI_LOW_ROI: AZUBI_LOW_ROI_PROFILE,
  SACHKUNDE: SACHKUNDE_PROFILE,
  FACHWIRT: FACHWIRT_PROFILE,
  STUDIUM: STUDIUM_CONTENT_PROFILE,
};

// Legacy track-based lookup (backward compat)
const TRACK_PROFILES: Record<Track, ContentProfile> = {
  AUSBILDUNG_VOLL: AZUBI_LOW_ROI_PROFILE,
  EXAM_FIRST: SACHKUNDE_PROFILE,
  EXAM_FIRST_PLUS: FACHWIRT_PROFILE,
  STUDIUM: STUDIUM_CONTENT_PROFILE,
};

/**
 * Get content profile. Priority: persona_profile > track fallback.
 */
export function getContentProfile(pkg: {
  track?: unknown;
  persona_profile?: string | null;
}): ContentProfile {
  const persona = resolvePersonaProfile(pkg);
  return PERSONA_PROFILES[persona];
}

// ── Legacy exports for backward compat ────────────────────────
export const AUSBILDUNG_PROFILE = AZUBI_HIGH_ROI_PROFILE;
export const EXAM_FIRST_PROFILE = SACHKUNDE_PROFILE;
export const EXAM_FIRST_PLUS_PROFILE = FACHWIRT_PROFILE;
export const STUDIUM_PROFILE = STUDIUM_CONTENT_PROFILE;
