/**
 * model-aliases.ts — Backward-compatible re-export
 *
 * All model catalog logic has moved to model-catalog.ts (SSOT).
 * This file re-exports everything so existing imports continue to work.
 */

export {
  MODEL_ALIASES,
  PIPELINE_MODEL_MAP,
  EXPLICIT_DRIFT_PRONE_MODELS,
  isDriftProneModel,
  resolveAlias,
  calcCourseCostEur,
  getStepCostBreakdown,
  EXAMFIT_COURSE_PROFILE,
} from "./model-catalog.ts";

export type {
  ModelAlias,
  ConcreteModel,
  RouteProfile,
  PipelineStepEstimate,
} from "./model-catalog.ts";

// Legacy alias for backward compat
export { EXPLICIT_DRIFT_PRONE_MODELS as DRIFT_PRONE_ALIASES } from "./model-catalog.ts";
