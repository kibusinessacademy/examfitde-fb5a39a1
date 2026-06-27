/**
 * STORE.OPS.INTELLIGENCE.OS.1 — Risk scoring (pure).
 *
 * technical risk:   build failures, recurring action failures, blocker density
 * governance risk:  rejections, manual interventions, autopilot blocked
 * operational risk: trend degradation, batch failure share
 */
import type {
  ActionSuccessStat,
  AutopilotRunSnapshot,
  BatchSnapshot,
  IntelligenceRiskLevel,
  KpiHistorySnapshot,
  RiskBreakdown,
  TrendDelta,
} from "./contracts.ts";

function clamp(n: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, n));
}

export function technicalRisk(
  actions: ActionSuccessStat[],
  kpi: KpiHistorySnapshot[],
): number {
  let score = 0;
  const totals = actions.reduce((s, a) => s + a.total, 0);
  if (totals > 0) {
    const failed = actions.reduce((s, a) => s + a.failed, 0);
    score += (failed / totals) * 60;
  }
  const latestKpi = [...kpi].sort((a, b) => (a.created_at_reference < b.created_at_reference ? -1 : 1)).pop();
  if (latestKpi) {
    score += (1 - clamp(latestKpi.build_success_rate, 0, 1)) * 40;
  }
  return Math.round(clamp(score));
}

export function governanceRisk(
  runs: AutopilotRunSnapshot[],
  kpi: KpiHistorySnapshot[],
): number {
  let score = 0;
  const manual = runs.reduce((s, r) => s + r.manual_count, 0);
  const blocked = runs.reduce((s, r) => s + r.blocked_count, 0);
  const totalRunActions = runs.reduce((s, r) => s + r.safe_count + r.manual_count + r.blocked_count, 0);
  if (totalRunActions > 0) {
    score += (manual / totalRunActions) * 40;
    score += (blocked / totalRunActions) * 40;
  }
  const latestKpi = [...kpi].sort((a, b) => (a.created_at_reference < b.created_at_reference ? -1 : 1)).pop();
  if (latestKpi) {
    score += clamp(latestKpi.rejected_count, 0, 20);
  }
  return Math.round(clamp(score));
}

export function operationalRisk(
  batches: BatchSnapshot[],
  trends: TrendDelta[],
): number {
  let score = 0;
  const totals = batches.reduce((s, b) => s + b.total, 0);
  if (totals > 0) {
    const failed = batches.reduce((s, b) => s + b.failed + b.blocked, 0);
    score += (failed / totals) * 60;
  }
  for (const t of trends) {
    if (t.metric === "health_score" && t.direction === "down") score += Math.min(Math.abs(t.delta), 20);
    if (t.metric === "risk_score" && t.direction === "up") score += Math.min(Math.abs(t.delta), 20);
    if (t.metric === "build_success_rate" && t.direction === "down") score += Math.min(Math.abs(t.delta) * 100, 20);
  }
  return Math.round(clamp(score));
}

export function aggregateRisk(technical: number, governance: number, operational: number): RiskBreakdown {
  // Weighted: technical 0.4, governance 0.35, operational 0.25.
  const total = Math.round(clamp(technical * 0.4 + governance * 0.35 + operational * 0.25));
  let level: IntelligenceRiskLevel = "low";
  if (total >= 70) level = "critical";
  else if (total >= 50) level = "high";
  else if (total >= 25) level = "medium";
  return { technical, governance, operational, total, level };
}
