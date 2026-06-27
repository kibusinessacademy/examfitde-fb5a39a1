/**
 * STORE.OPS.PREDICTION.OS.1 — Projection orchestrator.
 *
 * Pure, deterministic. Combines baselines, outcome, forecasts, risk and
 * confidence into one explainable PredictionProjection.
 */
import type {
  AutopilotActionSnapshot,
  AutopilotRunSnapshot,
  BatchItemSnapshot,
  BatchSnapshot,
  ExplainabilityBlock,
  InfluenceFactor,
  IntelligenceRunSnapshot,
  KpiHistorySnapshot,
  PlannedOperation,
  PredictionFinding,
  PredictionInput,
  PredictionProjection,
  PredictionRiskLevel,
  RiskBreakdown,
  RiskComponent,
  SimilarRunRef,
} from "./contracts.ts";
import { assertPlannedOperation } from "./prediction-policy.ts";
import { computeActionBaselines } from "./predictor.ts";
import { computeOutcome } from "./outcome-model.ts";
import {
  forecastBlockers,
  forecastManualInterventions,
  forecastRejections,
} from "./blocker-forecast.ts";
import { estimateDuration, estimateQueueLoad } from "./duration-estimator.ts";
import { computeConfidence } from "./confidence.ts";

function clampScore(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

function toLevel(score: number): PredictionRiskLevel {
  if (score >= 70) return "critical";
  if (score >= 50) return "high";
  if (score >= 25) return "medium";
  return "low";
}

function technicalRisk(
  baselines: ReturnType<typeof computeActionBaselines>,
  kpi: KpiHistorySnapshot[],
): RiskComponent {
  const totals = baselines.reduce((s, b) => s + b.observed_total, 0);
  const failed = baselines.reduce((s, b) => s + b.observed_failed, 0);
  const failRate = totals > 0 ? failed / totals : 0;
  const latestKpi = kpi[0];
  const buildFail = latestKpi ? 1 - Math.max(0, Math.min(1, latestKpi.build_success_rate)) : 0;
  const score = clampScore(failRate * 60 + buildFail * 40);
  const signals: string[] = [];
  if (failRate > 0.1) signals.push(`historical_failure_rate=${failRate.toFixed(3)}`);
  if (buildFail > 0.05) signals.push(`build_failure_rate=${buildFail.toFixed(3)}`);
  return {
    kind: "technical",
    score,
    level: toLevel(score),
    rationale: "Weighted historical failure rate and latest KPI build_success_rate.",
    signals,
  };
}

function governanceRisk(
  runs: AutopilotRunSnapshot[],
  kpi: KpiHistorySnapshot[],
): RiskComponent {
  const manual = runs.reduce((s, r) => s + (r.manual_count ?? 0), 0);
  const blocked = runs.reduce((s, r) => s + (r.blocked_count ?? 0), 0);
  const total = runs.reduce(
    (s, r) => s + (r.manual_count ?? 0) + (r.safe_count ?? 0) + (r.blocked_count ?? 0),
    0,
  );
  const manualRate = total > 0 ? manual / total : 0;
  const blockedRate = total > 0 ? blocked / total : 0;
  const rejections = (kpi[0]?.rejected_count ?? 0);
  const score = clampScore(manualRate * 40 + blockedRate * 40 + Math.min(rejections, 20));
  const signals: string[] = [];
  if (manualRate > 0) signals.push(`manual_rate=${manualRate.toFixed(3)}`);
  if (blockedRate > 0) signals.push(`blocked_rate=${blockedRate.toFixed(3)}`);
  if (rejections > 0) signals.push(`recent_rejections=${rejections}`);
  return {
    kind: "governance",
    score,
    level: toLevel(score),
    rationale: "Share of manual / blocked autopilot actions plus latest KPI rejections.",
    signals,
  };
}

function operationalRisk(
  batches: BatchSnapshot[],
  intelRuns: IntelligenceRunSnapshot[],
): RiskComponent {
  const total = batches.reduce((s, b) => s + (b.total ?? 0), 0);
  const bad = batches.reduce((s, b) => s + (b.failed ?? 0) + (b.blocked ?? 0), 0);
  const ratio = total > 0 ? bad / total : 0;
  const intelTotal = intelRuns[0]?.risk_total ?? 0;
  const score = clampScore(ratio * 70 + Math.min(intelTotal * 0.3, 30));
  const signals: string[] = [];
  if (ratio > 0) signals.push(`batch_failure_blocked_ratio=${ratio.toFixed(3)}`);
  if (intelTotal > 0) signals.push(`latest_intelligence_risk_total=${intelTotal}`);
  return {
    kind: "operational",
    score,
    level: toLevel(score),
    rationale: "Batch failure/blocked ratio combined with latest intelligence risk.",
    signals,
  };
}

function dataQualityRisk(
  items: BatchItemSnapshot[],
  baselines: ReturnType<typeof computeActionBaselines>,
): RiskComponent {
  let missingStatus = 0;
  for (const it of items) if (!it.status) missingStatus += 1;
  const missingShare = items.length > 0 ? missingStatus / items.length : 0;
  const sparseActions = baselines.filter((b) => b.observed_total < 3).length;
  const sparseShare = baselines.length > 0 ? sparseActions / baselines.length : 1;
  const score = clampScore(missingShare * 60 + sparseShare * 40);
  const signals: string[] = [];
  if (missingShare > 0) signals.push(`items_missing_status_share=${missingShare.toFixed(3)}`);
  if (sparseShare > 0) signals.push(`sparse_action_baselines_share=${sparseShare.toFixed(3)}`);
  return {
    kind: "data_quality",
    score,
    level: toLevel(score),
    rationale: "Share of items with missing status and sparse per-action samples.",
    signals,
  };
}

function capacityRisk(loadFactor: number, expectedSeconds: number): RiskComponent {
  // load_factor 1 = same size as average recent batch.
  const loadComp = Math.min(loadFactor, 4) / 4; // saturates at 4x load
  const durationComp = Math.min(expectedSeconds, 3600 * 6) / (3600 * 6); // saturates at 6h
  const score = clampScore(loadComp * 60 + durationComp * 40);
  const signals: string[] = [];
  if (loadFactor > 1) signals.push(`load_factor=${loadFactor}`);
  if (expectedSeconds > 0) signals.push(`expected_duration_seconds=${expectedSeconds}`);
  return {
    kind: "capacity",
    score,
    level: toLevel(score),
    rationale: "Planned size vs. recent batches plus expected total duration.",
    signals,
  };
}

function aggregateRisk(components: RiskComponent[]): RiskBreakdown {
  const get = (k: RiskComponent["kind"]) =>
    components.find((c) => c.kind === k)?.score ?? 0;
  const technical = get("technical");
  const governance = get("governance");
  const operational = get("operational");
  const data_quality = get("data_quality");
  const capacity = get("capacity");
  // weights sum to 1.0
  const total = clampScore(
    technical * 0.3 +
      governance * 0.25 +
      operational * 0.2 +
      data_quality * 0.1 +
      capacity * 0.15,
  );
  return {
    technical,
    governance,
    operational,
    data_quality,
    capacity,
    total,
    level: toLevel(total),
    components,
  };
}

function findSimilarRuns(
  planned: PlannedOperation,
  batches: BatchSnapshot[],
  runs: AutopilotRunSnapshot[],
  intel: IntelligenceRunSnapshot[],
): SimilarRunRef[] {
  const out: SimilarRunRef[] = [];
  const targetSize = Math.max(planned.expected_manifest_count, 0);
  for (const b of batches.slice(0, 20)) {
    const denom = Math.max(targetSize, b.total ?? 0, 1);
    const sim = 1 - Math.abs((b.total ?? 0) - targetSize) / denom;
    if (sim > 0.5) {
      out.push({
        source: "batch",
        ref_id: b.batch_id,
        similarity_score: round3(Math.max(0, Math.min(1, sim))),
        matched_on: ["batch_size"],
      });
    }
  }
  if (planned.mode) {
    for (const r of runs.slice(0, 20)) {
      if (r.mode === planned.mode) {
        out.push({
          source: "autopilot_run",
          ref_id: r.run_id,
          similarity_score: 0.6,
          matched_on: ["mode"],
        });
      }
    }
  }
  for (const i of intel.slice(0, 3)) {
    out.push({
      source: "intelligence_run",
      ref_id: i.run_id,
      similarity_score: 0.3,
      matched_on: ["latest_intelligence"],
    });
  }
  out.sort((a, b) => b.similarity_score - a.similarity_score || a.ref_id.localeCompare(b.ref_id));
  return out.slice(0, 10);
}

function influenceFactors(risk: RiskBreakdown, loadFactor: number): InfluenceFactor[] {
  const factors: InfluenceFactor[] = [];
  for (const c of risk.components) {
    if (c.score === 0) continue;
    factors.push({
      key: c.kind,
      weight: round3(c.score / 100),
      direction: "increases_risk",
      explanation: c.rationale,
    });
  }
  if (loadFactor > 1.5) {
    factors.push({
      key: "queue_pressure",
      weight: round3(Math.min(loadFactor, 4) / 4),
      direction: "increases_risk",
      explanation: "Planned operation is larger than recent average batch load.",
    });
  } else if (loadFactor > 0 && loadFactor < 0.5) {
    factors.push({
      key: "queue_pressure",
      weight: round3(1 - loadFactor),
      direction: "reduces_risk",
      explanation: "Planned operation is smaller than recent average batch load.",
    });
  }
  factors.sort((a, b) => b.weight - a.weight || a.key.localeCompare(b.key));
  return factors;
}

function detectPatterns(
  blockers: ReturnType<typeof forecastBlockers>,
  manual: ReturnType<typeof forecastManualInterventions>,
  risk: RiskBreakdown,
): string[] {
  const out: string[] = [];
  if (blockers[0] && blockers[0].historical_occurrences >= 3) {
    out.push(`recurring_blocker:${blockers[0].blocker_code}`);
  }
  if (manual.historical_rate >= 0.2 && manual.sample_size >= 5) {
    out.push("high_manual_intervention_rate");
  }
  for (const c of risk.components) {
    if (c.level === "high" || c.level === "critical") {
      out.push(`risk_component_${c.kind}_${c.level}`);
    }
  }
  return out;
}

export function projectPrediction(input: PredictionInput): PredictionProjection {
  const warnings: string[] = [];
  const policy = assertPlannedOperation(input.planned);
  if (!policy.ok) {
    for (const v of policy.violations) warnings.push(`policy_violation:${v}`);
  }

  const baselines = computeActionBaselines(input.batch_items, input.autopilot_actions);
  const outcome = computeOutcome(input.planned, baselines);
  const duration = estimateDuration(baselines, input.planned);
  const queue_load = estimateQueueLoad(input.batches, input.planned);
  const blockers = forecastBlockers(input.batch_items, input.autopilot_actions, input.planned);
  const rejections = forecastRejections(input.kpi_history, input.planned);
  const manual_intervention = forecastManualInterventions(input.autopilot_runs, input.planned);

  const risk = aggregateRisk([
    technicalRisk(baselines, input.kpi_history),
    governanceRisk(input.autopilot_runs, input.kpi_history),
    operationalRisk(input.batches, input.intelligence_runs),
    dataQualityRisk(input.batch_items, baselines),
    capacityRisk(queue_load.load_factor, duration.expected_total_seconds),
  ]);

  const confidence = computeConfidence({
    baselines,
    items: input.batch_items,
    kpi: input.kpi_history,
    total_events: input.batch_items.length + input.autopilot_actions.length,
  });

  const similar_runs = findSimilarRuns(
    input.planned,
    input.batches,
    input.autopilot_runs,
    input.intelligence_runs,
  );

  const detected_patterns = detectPatterns(blockers, manual_intervention, risk);
  const influence_factors = influenceFactors(risk, queue_load.load_factor);

  const used_data: string[] = [];
  if (input.batches.length) used_data.push(`store_ops_batches:${input.batches.length}`);
  if (input.batch_items.length) used_data.push(`store_ops_batch_items:${input.batch_items.length}`);
  if (input.kpi_history.length) used_data.push(`store_ops_kpi_snapshots:${input.kpi_history.length}`);
  if (input.autopilot_runs.length) used_data.push(`store_ops_autopilot_runs:${input.autopilot_runs.length}`);
  if (input.autopilot_actions.length) used_data.push(`store_ops_autopilot_actions:${input.autopilot_actions.length}`);
  if (input.intelligence_runs.length) used_data.push(`store_ops_intelligence_runs:${input.intelligence_runs.length}`);
  if (input.intelligence_findings.length) used_data.push(`store_ops_intelligence_findings:${input.intelligence_findings.length}`);

  if (used_data.length === 0) warnings.push("no_historical_data_available");
  if (outcome.baseline_used === "no_data") warnings.push("no_baseline_for_planned_actions");
  if (confidence.score < 0.3) warnings.push("low_confidence_prediction");

  const explainability: ExplainabilityBlock = {
    used_data,
    similar_runs,
    detected_patterns,
    influence_factors,
    rationale:
      "Deterministic projection: action baselines × planned size, weighted risk across five dimensions, " +
      "confidence from sample size, pattern consistency, data quality, repeatability and historical stability.",
  };

  const findings: PredictionFinding[] = [];
  findings.push({
    kind: "outcome",
    key: "success_probability",
    value_numeric: outcome.success_probability,
    value_text: outcome.baseline_used,
    detail: outcome as unknown as Record<string, unknown>,
  });
  for (const b of blockers.slice(0, 10)) {
    findings.push({
      kind: "expected_blocker",
      key: b.blocker_code,
      value_numeric: b.expected_occurrences,
      value_text: null,
      detail: b as unknown as Record<string, unknown>,
    });
  }
  for (const r of rejections.slice(0, 10)) {
    findings.push({
      kind: "expected_rejection",
      key: r.reason,
      value_numeric: r.expected_occurrences,
      value_text: null,
      detail: r as unknown as Record<string, unknown>,
    });
  }
  for (const d of duration.per_action) {
    findings.push({
      kind: "expected_duration",
      key: d.action_type,
      value_numeric: d.expected_seconds,
      value_text: null,
      detail: d as unknown as Record<string, unknown>,
    });
  }
  findings.push({
    kind: "queue_load",
    key: "queue_load",
    value_numeric: queue_load.load_factor,
    value_text: null,
    detail: queue_load as unknown as Record<string, unknown>,
  });
  findings.push({
    kind: "manual_intervention_forecast",
    key: "manual_intervention_forecast",
    value_numeric: manual_intervention.expected_count,
    value_text: null,
    detail: manual_intervention as unknown as Record<string, unknown>,
  });
  for (const c of risk.components) {
    findings.push({
      kind: "risk_component",
      key: c.kind,
      value_numeric: c.score,
      value_text: c.level,
      detail: c as unknown as Record<string, unknown>,
    });
  }
  for (const f of influence_factors) {
    findings.push({
      kind: "influence_factor",
      key: f.key,
      value_numeric: f.weight,
      value_text: f.direction,
      detail: f as unknown as Record<string, unknown>,
    });
  }
  for (const s of similar_runs) {
    findings.push({
      kind: "similar_run",
      key: s.ref_id,
      value_numeric: s.similarity_score,
      value_text: s.source,
      detail: s as unknown as Record<string, unknown>,
    });
  }
  for (const w of warnings) {
    findings.push({ kind: "warning", key: w, value_numeric: null, value_text: w, detail: { warning: w } });
  }

  return {
    run_id: input.run_id,
    evaluated_at_reference: input.evaluated_at_reference,
    operation_key: input.planned.operation_key,
    outcome,
    duration,
    queue_load,
    manual_intervention,
    blockers,
    rejections,
    action_baselines: baselines,
    risk,
    confidence,
    explainability,
    findings,
    warnings,
  };
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
