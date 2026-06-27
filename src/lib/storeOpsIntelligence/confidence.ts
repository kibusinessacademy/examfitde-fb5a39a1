/**
 * STORE.OPS.INTELLIGENCE.OS.1 — Confidence scoring (pure, explainable).
 */
import type {
  ActionSuccessStat,
  AutopilotRunSnapshot,
  BatchItemSnapshot,
  ConfidenceBreakdown,
} from "./contracts.ts";

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

export function computeConfidence(input: {
  items: BatchItemSnapshot[];
  runs: AutopilotRunSnapshot[];
  actions: ActionSuccessStat[];
}): ConfidenceBreakdown {
  const sample = input.items.length + input.runs.length;
  // sample_size: saturates at 100 events.
  const sample_size = clamp01(sample / 100);

  // repeatability: how many action_types appear ≥3 times.
  const repeatable = input.actions.filter((a) => a.total >= 3).length;
  const repeatability = clamp01(repeatable / Math.max(input.actions.length, 1));

  // success_rate: weighted average success across actions.
  const totals = input.actions.reduce((s, a) => s + a.total, 0);
  const succ = input.actions.reduce((s, a) => s + a.succeeded, 0);
  const success_rate = totals > 0 ? clamp01(succ / totals) : 0;

  // consistency: stddev of success_rate across actions (lower = better → invert).
  const mean = input.actions.length
    ? input.actions.reduce((s, a) => s + a.success_rate, 0) / input.actions.length
    : 0;
  const variance = input.actions.length
    ? input.actions.reduce((s, a) => s + (a.success_rate - mean) ** 2, 0) / input.actions.length
    : 0;
  const stddev = Math.sqrt(variance);
  const consistency = clamp01(1 - stddev);

  const score = clamp01(
    sample_size * 0.3 + repeatability * 0.25 + success_rate * 0.2 + consistency * 0.25,
  );

  return {
    sample_size: round(sample_size),
    repeatability: round(repeatability),
    success_rate: round(success_rate),
    consistency: round(consistency),
    score: round(score),
  };
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
