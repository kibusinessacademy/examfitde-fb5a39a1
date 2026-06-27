/**
 * STORE.OPS.PREDICTION.OS.1 — Outcome model.
 *
 * Combines per-action baselines with the planned operation to compute an
 * overall success probability and expected counts. Pure & deterministic.
 *
 * Strategy:
 *  - If the action_type has ≥ 5 historical samples, use its action_baseline.
 *  - Else fall back to the global baseline aggregated across all actions.
 *  - Else mark `no_data`.
 *
 * Counts are distributed evenly across planned_action_types per manifest.
 */
import type {
  ActionBaseline,
  OutcomeForecast,
  PlannedOperation,
} from "./contracts.ts";

const MIN_SAMPLES_FOR_ACTION_BASELINE = 5;

export function computeOutcome(
  planned: PlannedOperation,
  baselines: ActionBaseline[],
): OutcomeForecast {
  const totalActions = Math.max(planned.expected_manifest_count, 0) *
    Math.max(planned.planned_action_types.length, 0);

  if (totalActions === 0) {
    return {
      success_probability: 0,
      expected_failures: 0,
      expected_blocked: 0,
      expected_succeeded: 0,
      baseline_used: "no_data",
    };
  }

  const byKey = new Map<string, ActionBaseline>();
  for (const b of baselines) byKey.set(b.action_type, b);

  const global = aggregateGlobal(baselines);

  let actionBaselineHits = 0;
  let totalSucc = 0;
  let totalFail = 0;
  let totalBlock = 0;

  const perAction = Math.max(planned.expected_manifest_count, 0);
  for (const at of planned.planned_action_types) {
    const b = byKey.get(at);
    if (b && b.observed_total >= MIN_SAMPLES_FOR_ACTION_BASELINE) {
      actionBaselineHits += 1;
      totalSucc += perAction * b.success_rate;
      totalFail += perAction * b.failure_rate;
      totalBlock += perAction * b.block_rate;
    } else if (global) {
      totalSucc += perAction * global.success_rate;
      totalFail += perAction * global.failure_rate;
      totalBlock += perAction * global.block_rate;
    }
  }

  const baseline_used: OutcomeForecast["baseline_used"] = actionBaselineHits > 0
    ? "action_baseline"
    : global
    ? "global_baseline"
    : "no_data";

  if (baseline_used === "no_data") {
    return {
      success_probability: 0,
      expected_failures: 0,
      expected_blocked: 0,
      expected_succeeded: 0,
      baseline_used,
    };
  }

  const expected_failures = Math.round(totalFail);
  const expected_blocked = Math.round(totalBlock);
  const expected_succeeded = Math.max(totalActions - expected_failures - expected_blocked, 0);
  const success_probability = totalActions > 0
    ? Math.max(0, Math.min(1, expected_succeeded / totalActions))
    : 0;

  return {
    success_probability: round3(success_probability),
    expected_failures,
    expected_blocked,
    expected_succeeded,
    baseline_used,
  };
}

function aggregateGlobal(baselines: ActionBaseline[]):
  | { success_rate: number; failure_rate: number; block_rate: number }
  | null {
  const total = baselines.reduce((s, b) => s + b.observed_total, 0);
  if (total === 0) return null;
  const succ = baselines.reduce((s, b) => s + b.observed_succeeded, 0);
  const fail = baselines.reduce((s, b) => s + b.observed_failed, 0);
  const block = baselines.reduce((s, b) => s + b.observed_blocked, 0);
  return {
    success_rate: round3(succ / total),
    failure_rate: round3(fail / total),
    block_rate: round3(block / total),
  };
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
