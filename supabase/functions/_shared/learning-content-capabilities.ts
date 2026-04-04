/**
 * SSOT: Capability-based Downstream Routing
 *
 * Replaces the single boolean `allowsDownstream` with per-step
 * capability flags derived from gateClass + coverage + tier1PassRate.
 */

import type { LearningContentGateClass } from "./learning-content-gate.ts";

export interface LearningContentCapabilities {
  allowsBlueprintSeeding: boolean;
  allowsExamPoolGeneration: boolean;
  allowsMiniCheckGeneration: boolean;
  allowsHandbookGeneration: boolean;
  allowsTutorIndexing: boolean;
}

/**
 * Derive per-step capabilities from the gate classification and content metrics.
 *
 * - healthy / soft_pass_with_debt → all downstream allowed
 * - repair_required → conditionally allow core artefacts (blueprints, exam, minichecks)
 * - major_regeneration_required / hard_fail → nothing allowed
 */
export function deriveLearningContentCapabilities(params: {
  gateClass: LearningContentGateClass;
  tier1PassRate: number;
  materializedLessons: number;
  totalLessons: number;
}): LearningContentCapabilities {
  const coverage =
    params.totalLessons > 0
      ? params.materializedLessons / params.totalLessons
      : 0;

  if (
    params.gateClass === "healthy" ||
    params.gateClass === "soft_pass_with_debt"
  ) {
    return {
      allowsBlueprintSeeding: true,
      allowsExamPoolGeneration: true,
      allowsMiniCheckGeneration: true,
      allowsHandbookGeneration: true,
      allowsTutorIndexing: true,
    };
  }

  if (params.gateClass === "repair_required") {
    return {
      allowsBlueprintSeeding: coverage >= 0.9,
      allowsExamPoolGeneration:
        coverage >= 0.9 && params.tier1PassRate >= 0.6,
      allowsMiniCheckGeneration: coverage >= 0.9,
      allowsHandbookGeneration: false,
      allowsTutorIndexing: false,
    };
  }

  // major_regeneration_required or hard_fail
  return {
    allowsBlueprintSeeding: false,
    allowsExamPoolGeneration: false,
    allowsMiniCheckGeneration: false,
    allowsHandbookGeneration: false,
    allowsTutorIndexing: false,
  };
}

/**
 * Simple helper: does the capability set allow ANY downstream step?
 */
export function hasAnyDownstreamCapability(
  caps: LearningContentCapabilities,
): boolean {
  return Object.values(caps).some(Boolean);
}
