/**
 * Auto-Publish Guard — track-aware publish readiness check.
 *
 * Only requires artifacts that the ContentProfile mandates for the track.
 * EXAM_FIRST skips learning course, minichecks, handbook expand, etc.
 */

import { getContentProfile } from "../contentProfiles";
import { normalizeTrack } from "../tracks";

interface PublishInputs {
  track: unknown;
  approvedExamQuestions: number;
  hasLearningCourse: boolean;
  hasMiniChecks: boolean;
  hasHandbook: boolean;
  hasOralExam: boolean;
  hasTutorIndex: boolean;
  integrityPassed: boolean;
  qualityCouncilPassed: boolean;
  /** Quality Gate v2: lesson QC status */
  lessonQcFailedCount?: number;
  /** Quality Gate v2: council step actually completed */
  councilStepDone?: boolean;
}

export function canAutoPublish(input: PublishInputs) {
  const track = normalizeTrack(input.track);
  const profile = getContentProfile(track);
  const missing: string[] = [];

  if (input.approvedExamQuestions < profile.minApprovedExamQuestions) {
    missing.push("approved_exam_questions");
  }

  if (profile.includeLearningCourse && !input.hasLearningCourse) {
    missing.push("learning_course");
  }

  if (profile.includeMiniChecks && !input.hasMiniChecks) {
    missing.push("minichecks");
  }

  if (profile.includeHandbook && !input.hasHandbook) {
    missing.push("handbook");
  }

  if (profile.includeOralExam && !profile.oralExamOptional && !input.hasOralExam) {
    missing.push("oral_exam");
  }

  if (profile.includeTutorIndex && !input.hasTutorIndex) {
    missing.push("tutor_index");
  }

  if (!input.integrityPassed) {
    missing.push("integrity_check");
  }

  if (!input.qualityCouncilPassed) {
    missing.push("quality_council");
  }

  return {
    allowed: missing.length === 0,
    missing,
    track,
  };
}
