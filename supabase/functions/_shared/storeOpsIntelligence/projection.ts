/**
 * STORE.OPS.INTELLIGENCE.OS.1 — Projection orchestrator (pure).
 */
import {
  actionSuccessRates,
  averageBatchRuntimeSeconds,
  computeTrends,
  manualInterventions,
  modeSuccessRates,
  recurringRiskPatterns,
  topBlockers,
  topFailures,
  topRejections,
} from "./analyzer.ts";
import { clusterBlockers } from "./blocker-clustering.ts";
import { computeConfidence } from "./confidence.ts";
import { aggregateRisk, governanceRisk, operationalRisk, technicalRisk } from "./risk-score.ts";
import { buildRecommendations } from "./recommendation-engine.ts";
import type {
  IntelligenceFinding,
  IntelligenceInput,
  IntelligenceProjection,
} from "./contracts.ts";

export function projectIntelligence(input: IntelligenceInput): IntelligenceProjection {
  const warnings: string[] = [];
  if (!input.batches.length && !input.autopilot_runs.length) {
    warnings.push("no_historical_data");
  }

  const blockers = topBlockers(input.batch_items, input.autopilot_actions);
  const failures = topFailures(input.batch_items, input.autopilot_actions);
  const rejections = topRejections(input.kpi_history);
  const manual = manualInterventions(input.autopilot_runs);
  const riskPatterns = recurringRiskPatterns(input.autopilot_runs);
  const actionStats = actionSuccessRates(input.batch_items, input.autopilot_actions);
  const modeStats = modeSuccessRates(input.autopilot_runs);
  const avgRuntime = averageBatchRuntimeSeconds(input.batches);
  const trends = computeTrends(input.kpi_history, input.autopilot_runs);
  const clusters = clusterBlockers(input.batch_items, input.autopilot_actions);

  const tech = technicalRisk(actionStats, input.kpi_history);
  const gov = governanceRisk(input.autopilot_runs, input.kpi_history);
  const ops = operationalRisk(input.batches, trends);
  const risk = aggregateRisk(tech, gov, ops);
  const confidence = computeConfidence({
    items: input.batch_items,
    runs: input.autopilot_runs,
    actions: actionStats,
  });

  const recommendations = buildRecommendations({
    risk,
    confidence,
    topBlockers: blockers,
    topFailures: failures,
    actionStats,
    runs: input.autopilot_runs,
    batches: input.batches,
    clusters,
    trends,
  });

  const findings: IntelligenceFinding[] = [];
  for (const b of blockers) findings.push({ kind: "top_blocker", key: b.key, value_numeric: b.count, value_text: null, detail: { share: b.share } });
  for (const f of failures) findings.push({ kind: "top_failure", key: f.key, value_numeric: f.count, value_text: null, detail: { share: f.share } });
  for (const r of rejections) findings.push({ kind: "top_rejection", key: r.key, value_numeric: r.count, value_text: null, detail: { share: r.share } });
  for (const m of manual) findings.push({ kind: "manual_intervention", key: m.key, value_numeric: m.count, value_text: null, detail: { share: m.share } });
  for (const r of riskPatterns) findings.push({ kind: "risk_pattern", key: r.key, value_numeric: r.count, value_text: null, detail: { share: r.share } });
  for (const a of actionStats) findings.push({ kind: "action_success", key: a.action_type, value_numeric: a.success_rate, value_text: null, detail: { ...a } });
  for (const m of modeStats) findings.push({ kind: "mode_success", key: m.mode, value_numeric: m.success_rate, value_text: null, detail: { ...m } });
  for (const t of trends) findings.push({ kind: "trend", key: t.metric, value_numeric: t.delta, value_text: t.direction, detail: { previous: t.previous, current: t.current } });
  for (const c of clusters) findings.push({ kind: "blocker_cluster", key: c.cluster_key, value_numeric: c.occurrences, value_text: null, detail: { blocker_codes: c.blocker_codes, affected_manifest_count: c.affected_manifest_count, affected_action_types: c.affected_action_types } });
  for (const r of recommendations) findings.push({ kind: "recommendation", key: r.code, value_numeric: null, value_text: r.title, detail: { rationale: r.rationale, used_data: r.used_data, detected_patterns: r.detected_patterns, risk: r.risk, confidence: r.confidence } });

  return {
    run_id: input.run_id,
    evaluated_at_reference: input.evaluated_at_reference,
    top_blockers: blockers,
    top_failures: failures,
    top_rejections: rejections,
    manual_interventions: manual,
    recurring_risk_patterns: riskPatterns,
    action_success: actionStats,
    mode_success: modeStats,
    average_batch_runtime_seconds: avgRuntime,
    trend: trends,
    blocker_clusters: clusters,
    risk,
    confidence,
    recommendations,
    findings,
    warnings,
  };
}
