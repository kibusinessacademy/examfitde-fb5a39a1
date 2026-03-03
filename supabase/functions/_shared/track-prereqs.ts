/**
 * Track-aware Artifact Prerequisites (SSOT)
 *
 * Not all pipeline steps require the same artifacts in every track.
 * EXAM_FIRST skips elite_harden entirely, so run_integrity_check
 * must NOT require "elite_ready" in that track.
 *
 * Steps NOT listed here fall back to the static PIPELINE_GRAPH requires[].
 * Steps listed here OVERRIDE the static requires[] completely for that track.
 */

export type Track = "AUSBILDUNG_VOLL" | "ELITE" | "EXAM_FIRST";

/**
 * Per-step, per-track artifact overrides.
 * If a step+track combo is listed here, this list replaces PIPELINE_GRAPH.requires.
 * If not listed, the static PIPELINE_GRAPH.requires[] is used unchanged.
 */
const TRACK_ARTIFACT_OVERRIDES: Record<string, Partial<Record<Track, string[]>>> = {
  // run_integrity_check: ELITE needs elite_ready, EXAM_FIRST does NOT
  run_integrity_check: {
    AUSBILDUNG_VOLL: ["elite_ready"],  // default from PIPELINE_GRAPH
    ELITE: ["elite_ready"],             // alias for full pipeline
    EXAM_FIRST: [],                     // no elite step → no elite artifact
  },

  // quality_council: ELITE needs integrity_passed, EXAM_FIRST needs validated_exam_pool
  quality_council: {
    AUSBILDUNG_VOLL: ["integrity_passed"],  // default from PIPELINE_GRAPH
    ELITE: ["integrity_passed"],             // alias for full pipeline
    EXAM_FIRST: ["validated_exam_pool"],     // skip integrity check entirely
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
  if (!overrides) return null; // no override → use static graph

  const resolved = overrides[track as Track];
  if (resolved !== undefined) return resolved;

  // Fallback: treat unknown tracks like AUSBILDUNG_VOLL (full pipeline)
  return overrides["AUSBILDUNG_VOLL"] ?? null;
}
