/**
 * Track-aware Artifact Prerequisites (SSOT)
 *
 * Not all pipeline steps require the same artifacts in every track.
 * Steps NOT listed here fall back to the static PIPELINE_GRAPH requires[].
 * Steps listed here OVERRIDE the static requires[] completely for that track.
 *
 * EXAM_FIRST skips learning content chain entirely → exam blueprints
 * can start without validated_learning_content.
 */

import { type TrackKey } from "./track-normalize.ts";

/**
 * Per-step, per-track artifact overrides.
 * If a step+track combo is listed here, this list replaces PIPELINE_GRAPH.requires.
 * If not listed, the static PIPELINE_GRAPH.requires[] is used unchanged.
 */
const TRACK_ARTIFACT_OVERRIDES: Record<string, Partial<Record<TrackKey, string[]>>> = {
  // EXAM_FIRST: blueprints don't need validated_learning_content
  // (no learning course in EXAM_FIRST)
  auto_seed_exam_blueprints: {
    AUSBILDUNG_VOLL: ["validated_learning_content"],  // default from PIPELINE_GRAPH
    EXAM_FIRST: [],                                    // no learning content prerequisite
    STUDIUM: ["validated_learning_content"],
  },

  // EXAM_FIRST: handbook doesn't require validated_learning_content
  generate_handbook: {
    AUSBILDUNG_VOLL: ["validated_learning_content"],
    EXAM_FIRST: ["validated_blueprints"],              // handbook from blueprints only
    STUDIUM: ["validated_learning_content"],
  },

  // elite_harden: all tracks need validated_exam_pool
  elite_harden: {
    AUSBILDUNG_VOLL: ["validated_exam_pool"],
    EXAM_FIRST: ["validated_exam_pool"],
    STUDIUM: ["validated_exam_pool"],
  },

  // run_integrity_check: track-specific artifact requirements
  run_integrity_check: {
    AUSBILDUNG_VOLL: [
      "elite_ready",
      "validated_minichecks",
      "validated_handbook_depth",
      "validated_oral_exam",
      "validated_tutor_index",
    ],
    EXAM_FIRST: [
      "elite_ready",
      "validated_tutor_index",
    ],
    STUDIUM: [
      "elite_ready",
      "validated_minichecks",
      "validated_handbook_depth",
      "validated_tutor_index",
    ],
  },

  // quality_council: depends on integrity
  quality_council: {
    AUSBILDUNG_VOLL: ["integrity_passed"],
    EXAM_FIRST: ["integrity_passed"],
    STUDIUM: ["integrity_passed"],
  },
};

/**
 * Returns the effective required artifacts for a step in a given track.
 * If an override exists for the step+track combo, returns that.
 * Otherwise returns null (caller should use PIPELINE_GRAPH.requires[]).
 */
export function getTrackArtifactOverride(
  stepKey: string,
  track: string,
): string[] | null {
  const overrides = TRACK_ARTIFACT_OVERRIDES[stepKey];
  if (!overrides) return null;

  const resolved = overrides[track as TrackKey];
  if (resolved !== undefined) return resolved;

  // Fallback: treat unknown tracks like AUSBILDUNG_VOLL (full pipeline)
  return overrides["AUSBILDUNG_VOLL"] ?? null;
}

/**
 * EXAM_FIRST elite_harden eligibility: requires >= 60 approved questions.
 * Called by artifact-resolver to gate elite_harden for lean tracks.
 */
export const ELITE_HARDEN_MIN_APPROVED = 60;
