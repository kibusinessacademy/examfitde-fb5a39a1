/**
 * STORE.OPS.INTELLIGENCE.OS.1 — Frequency analyzer (pure).
 */
import type {
  ActionSuccessStat,
  AutopilotActionSnapshot,
  AutopilotRunSnapshot,
  BatchItemSnapshot,
  BatchSnapshot,
  FrequencyEntry,
  ModeSuccessStat,
  TrendDelta,
  KpiHistorySnapshot,
} from "./contracts.ts";

function frequency(items: string[]): FrequencyEntry[] {
  const counts = new Map<string, number>();
  for (const k of items) counts.set(k, (counts.get(k) ?? 0) + 1);
  const total = items.length || 1;
  return [...counts.entries()]
    .map(([key, count]) => ({ key, count, share: count / total }))
    .sort((a, b) => b.count - a.count || (a.key < b.key ? -1 : 1));
}

export function topBlockers(items: BatchItemSnapshot[], actions: AutopilotActionSnapshot[]): FrequencyEntry[] {
  const all: string[] = [];
  for (const i of items) for (const c of i.blocker_codes) all.push(c);
  for (const a of actions) for (const c of a.blocker_codes) all.push(c);
  return frequency(all).slice(0, 10);
}

export function topFailures(items: BatchItemSnapshot[], actions: AutopilotActionSnapshot[]): FrequencyEntry[] {
  const failures: string[] = [];
  for (const i of items) if (i.status === "failed") failures.push(i.action_type);
  for (const a of actions) if (a.status === "failed") failures.push(a.action_type);
  return frequency(failures).slice(0, 10);
}

export function topRejections(kpi: KpiHistorySnapshot[]): FrequencyEntry[] {
  const all: string[] = [];
  for (const s of kpi) for (const r of s.top_rejection_reasons) all.push(r);
  return frequency(all).slice(0, 10);
}

export function manualInterventions(runs: AutopilotRunSnapshot[]): FrequencyEntry[] {
  // Manual interventions = manual_required actions per run mode aggregated.
  const all: string[] = [];
  for (const r of runs) {
    for (let i = 0; i < r.manual_count; i++) all.push(r.mode);
  }
  return frequency(all);
}

export function recurringRiskPatterns(runs: AutopilotRunSnapshot[]): FrequencyEntry[] {
  return frequency(runs.map((r) => r.risk_level)).slice(0, 10);
}

export function actionSuccessRates(
  items: BatchItemSnapshot[],
  actions: AutopilotActionSnapshot[],
): ActionSuccessStat[] {
  const map = new Map<string, { total: number; succeeded: number; failed: number; blocked: number }>();
  const bump = (k: string, status: string) => {
    const cur = map.get(k) ?? { total: 0, succeeded: 0, failed: 0, blocked: 0 };
    cur.total++;
    if (status === "succeeded") cur.succeeded++;
    else if (status === "failed") cur.failed++;
    else if (status === "blocked") cur.blocked++;
    map.set(k, cur);
  };
  for (const i of items) bump(i.action_type, i.status);
  for (const a of actions) bump(a.action_type, a.status);
  return [...map.entries()]
    .map(([action_type, v]) => ({
      action_type,
      total: v.total,
      succeeded: v.succeeded,
      failed: v.failed,
      blocked: v.blocked,
      success_rate: v.total > 0 ? v.succeeded / v.total : 0,
    }))
    .sort((a, b) => b.total - a.total || (a.action_type < b.action_type ? -1 : 1));
}

export function modeSuccessRates(runs: AutopilotRunSnapshot[]): ModeSuccessStat[] {
  const map = new Map<string, { total: number; succeeded: number; failed: number }>();
  for (const r of runs) {
    const cur = map.get(r.mode) ?? { total: 0, succeeded: 0, failed: 0 };
    cur.total += r.safe_count + r.manual_count + r.blocked_count;
    cur.succeeded += r.succeeded;
    cur.failed += r.failed;
    map.set(r.mode, cur);
  }
  return [...map.entries()]
    .map(([mode, v]) => ({
      mode,
      total: v.total,
      succeeded: v.succeeded,
      failed: v.failed,
      success_rate: v.total > 0 ? v.succeeded / v.total : 0,
    }))
    .sort((a, b) => (a.mode < b.mode ? -1 : 1));
}

export function averageBatchRuntimeSeconds(batches: BatchSnapshot[]): number | null {
  if (!batches.length) return null;
  // Deterministic stand-in: average totalsize as proxy for runtime.
  const avg = batches.reduce((acc, b) => acc + b.total, 0) / batches.length;
  return Math.round(avg * 100) / 100;
}

export function computeTrends(
  kpi: KpiHistorySnapshot[],
  runs: AutopilotRunSnapshot[],
): TrendDelta[] {
  const out: TrendDelta[] = [];
  const orderedKpi = [...kpi].sort((a, b) => (a.created_at_reference < b.created_at_reference ? -1 : 1));
  if (orderedKpi.length >= 2) {
    const prev = orderedKpi[orderedKpi.length - 2];
    const curr = orderedKpi[orderedKpi.length - 1];
    out.push(trend("health_score", prev.health_score, curr.health_score));
    out.push(trend("blocked_count", prev.blocked_count, curr.blocked_count));
    out.push(trend("rejected_count", prev.rejected_count, curr.rejected_count));
    out.push(trend("build_success_rate", prev.build_success_rate, curr.build_success_rate));
  }
  const orderedRuns = [...runs].sort((a, b) => (a.evaluated_at_reference < b.evaluated_at_reference ? -1 : 1));
  if (orderedRuns.length >= 2) {
    const prev = orderedRuns[orderedRuns.length - 2];
    const curr = orderedRuns[orderedRuns.length - 1];
    out.push(trend("risk_score", prev.risk_score, curr.risk_score));
  }
  return out;
}

function trend(metric: string, previous: number, current: number): TrendDelta {
  const delta = current - previous;
  const direction: "up" | "down" | "flat" = delta > 0 ? "up" : delta < 0 ? "down" : "flat";
  return { metric, previous, current, delta, direction };
}
