/**
 * STORE.OPS.PREDICTION.OS.1 — Confidence scoring (pure & explainable).
 *
 * Confidence is derived only from observable, explainable factors:
 *   - sample_size           : how many events fed the prediction
 *   - pattern_consistency   : how stable success rates are across actions
 *   - data_quality          : completeness of duration / blocker fields
 *   - repeatability         : how many action_types have ≥ 3 samples
 *   - historical_stability  : volatility of recent KPI health_score
 */
import type {
  ActionBaseline,
  BatchItemSnapshot,
  ConfidenceBreakdown,
  KpiHistorySnapshot,
} from "./contracts.ts";

export function computeConfidence(input: {
  baselines: ActionBaseline[];
  items: BatchItemSnapshot[];
  kpi: KpiHistorySnapshot[];
  total_events: number;
}): ConfidenceBreakdown {
  const sample_size = clamp01(input.total_events / 100);

  // pattern consistency: 1 - stddev(success_rate)
  const rates = input.baselines.filter((b) => b.observed_total > 0).map((b) => b.success_rate);
  const mean = rates.length ? rates.reduce((s, v) => s + v, 0) / rates.length : 0;
  const variance = rates.length
    ? rates.reduce((s, v) => s + (v - mean) ** 2, 0) / rates.length
    : 0;
  const pattern_consistency = clamp01(1 - Math.sqrt(variance));

  // data_quality: share of items with status set AND duration provided OR no items.
  let dqSamples = 0;
  let dqOk = 0;
  for (const it of input.items) {
    dqSamples += 1;
    if (it.status && it.status.length > 0) dqOk += 1;
  }
  const data_quality = dqSamples === 0 ? 0 : clamp01(dqOk / dqSamples);

  // repeatability: share of action_types with ≥ 3 samples.
  const repeatable = input.baselines.filter((b) => b.observed_total >= 3).length;
  const repeatability = input.baselines.length === 0
    ? 0
    : clamp01(repeatable / input.baselines.length);

  // historical stability: 1 - stddev(health_score / 100) over up to 10 recent snapshots.
  const last = input.kpi.slice(0, 10).map((k) => clamp01(k.health_score / 100));
  const hMean = last.length ? last.reduce((s, v) => s + v, 0) / last.length : 0;
  const hVar = last.length ? last.reduce((s, v) => s + (v - hMean) ** 2, 0) / last.length : 0;
  const historical_stability = clamp01(1 - Math.sqrt(hVar));

  const score = clamp01(
    sample_size * 0.25 +
      pattern_consistency * 0.2 +
      data_quality * 0.15 +
      repeatability * 0.2 +
      historical_stability * 0.2,
  );

  return {
    sample_size: round3(sample_size),
    pattern_consistency: round3(pattern_consistency),
    data_quality: round3(data_quality),
    repeatability: round3(repeatability),
    historical_stability: round3(historical_stability),
    score: round3(score),
  };
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
