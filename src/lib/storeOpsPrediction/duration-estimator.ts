/**
 * STORE.OPS.PREDICTION.OS.1 — Duration & queue load estimator.
 *
 * Pure & deterministic. Uses per-action average durations where available
 * and falls back to the global average duration across all observations.
 */
import type {
  ActionBaseline,
  BatchSnapshot,
  DurationForecast,
  PlannedOperation,
  QueueLoadForecast,
} from "./contracts.ts";

const DEFAULT_SECONDS_PER_ACTION = 90;

export function estimateDuration(
  baselines: ActionBaseline[],
  planned: PlannedOperation,
): DurationForecast {
  const perAction: DurationForecast["per_action"] = [];
  const byKey = new Map<string, ActionBaseline>();
  for (const b of baselines) byKey.set(b.action_type, b);

  // Global fallback.
  let globalSum = 0;
  let globalCount = 0;
  for (const b of baselines) {
    if (b.average_duration_seconds != null && b.duration_sample_count > 0) {
      globalSum += b.average_duration_seconds * b.duration_sample_count;
      globalCount += b.duration_sample_count;
    }
  }
  const globalAvg = globalCount > 0 ? globalSum / globalCount : DEFAULT_SECONDS_PER_ACTION;

  let total = 0;
  for (const at of planned.planned_action_types) {
    const b = byKey.get(at);
    const avg = b?.average_duration_seconds ?? globalAvg;
    const sampleSize = b?.duration_sample_count ?? 0;
    const expected = Math.round(avg * Math.max(planned.expected_manifest_count, 0));
    total += expected;
    perAction.push({ action_type: at, expected_seconds: expected, sample_size: sampleSize });
  }

  return {
    expected_total_seconds: total,
    per_action: perAction,
    sample_size: globalCount,
  };
}

export function estimateQueueLoad(
  batches: BatchSnapshot[],
  planned: PlannedOperation,
): QueueLoadForecast {
  const plannedActions = Math.max(planned.expected_manifest_count, 0) *
    Math.max(planned.planned_action_types.length, 0);
  const recent = batches.slice(0, 10);
  const totals = recent.map((b) => Math.max(b.total ?? 0, 0));
  const avg = totals.length > 0 ? totals.reduce((s, v) => s + v, 0) / totals.length : 0;
  const load = avg > 0 ? plannedActions / avg : plannedActions > 0 ? 99 : 0;
  return {
    expected_action_count: plannedActions,
    average_recent_batch_load: Math.round(avg * 100) / 100,
    load_factor: Math.round(load * 100) / 100,
  };
}
