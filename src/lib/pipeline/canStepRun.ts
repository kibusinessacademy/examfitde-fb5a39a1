/**
 * Transition Guard — track-aware step readiness check.
 *
 * Evaluates whether a step can run based on its active dependencies
 * (filtered by track). Skipped steps never block downstream.
 */

import { getActiveGraphForTrack } from "./graph";
import type { StepKey } from "./stepPolicy";

export interface PackageStepState {
  step_key: StepKey;
  status: "pending" | "queued" | "processing" | "done" | "failed" | "skipped";
}

export function canStepRun(
  track: unknown,
  targetStep: StepKey,
  states: PackageStepState[],
): { allowed: boolean; blockedBy: StepKey[] } {
  const graph = getActiveGraphForTrack(track);
  const node = graph.find((n) => n.key === targetStep);

  if (!node) {
    // Step not in active graph for this track → not allowed
    return { allowed: false, blockedBy: [] };
  }

  const statusMap = new Map(states.map((s) => [s.step_key, s.status]));

  const blockedBy = node.dependsOn.filter((dep) => {
    const status = statusMap.get(dep);
    return status !== "done" && status !== "skipped";
  });

  return {
    allowed: blockedBy.length === 0,
    blockedBy,
  };
}
