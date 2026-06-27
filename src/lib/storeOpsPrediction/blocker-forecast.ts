/**
 * STORE.OPS.PREDICTION.OS.1 — Blocker & rejection forecasts.
 *
 * Pure, deterministic. Derives per-blocker historical rates and projects
 * expected occurrences onto the planned operation size.
 */
import type {
  AutopilotActionSnapshot,
  BatchItemSnapshot,
  BlockerForecastEntry,
  KpiHistorySnapshot,
  ManualInterventionForecast,
  PlannedOperation,
  RejectionForecastEntry,
} from "./contracts.ts";

export function forecastBlockers(
  items: BatchItemSnapshot[],
  actions: AutopilotActionSnapshot[],
  planned: PlannedOperation,
): BlockerForecastEntry[] {
  const totalEvents = items.length + actions.length;
  if (totalEvents === 0) return [];

  const counts = new Map<string, number>();
  for (const it of items) for (const b of it.blocker_codes ?? []) counts.set(b, (counts.get(b) ?? 0) + 1);
  for (const a of actions) for (const b of a.blocker_codes ?? []) counts.set(b, (counts.get(b) ?? 0) + 1);

  const plannedActions = Math.max(planned.expected_manifest_count, 0) *
    Math.max(planned.planned_action_types.length, 0);

  const out: BlockerForecastEntry[] = [];
  for (const [code, occurrences] of counts) {
    const rate = occurrences / totalEvents;
    out.push({
      blocker_code: code,
      historical_occurrences: occurrences,
      historical_rate: round3(rate),
      expected_occurrences: Math.round(rate * plannedActions),
    });
  }
  // Deterministic: by occurrences desc, then code asc.
  out.sort((a, b) =>
    b.historical_occurrences - a.historical_occurrences || a.blocker_code.localeCompare(b.blocker_code)
  );
  return out.slice(0, 20);
}

export function forecastRejections(
  kpi: KpiHistorySnapshot[],
  planned: PlannedOperation,
): RejectionForecastEntry[] {
  const counts = new Map<string, number>();
  for (const s of kpi) {
    for (const r of s.top_rejection_reasons ?? []) {
      const key = typeof r === "string" ? r : ((r as any)?.reason ?? "");
      if (!key) continue;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  if (counts.size === 0) return [];
  const total = [...counts.values()].reduce((s, v) => s + v, 0);
  const plannedActions = Math.max(planned.expected_manifest_count, 0) *
    Math.max(planned.planned_action_types.length, 0);

  const out: RejectionForecastEntry[] = [];
  for (const [reason, occ] of counts) {
    const rate = total > 0 ? occ / total : 0;
    out.push({
      reason,
      historical_occurrences: occ,
      expected_occurrences: Math.round(rate * Math.min(plannedActions, 50)),
    });
  }
  out.sort((a, b) =>
    b.historical_occurrences - a.historical_occurrences || a.reason.localeCompare(b.reason)
  );
  return out.slice(0, 10);
}

export function forecastManualInterventions(
  runs: { manual_count: number; safe_count: number; blocked_count: number }[],
  planned: PlannedOperation,
): ManualInterventionForecast {
  let manual = 0;
  let total = 0;
  for (const r of runs) {
    manual += r.manual_count ?? 0;
    total += (r.manual_count ?? 0) + (r.safe_count ?? 0) + (r.blocked_count ?? 0);
  }
  const rate = total > 0 ? manual / total : 0;
  const plannedActions = Math.max(planned.expected_manifest_count, 0) *
    Math.max(planned.planned_action_types.length, 0);
  return {
    historical_rate: round3(rate),
    expected_count: Math.round(rate * plannedActions),
    sample_size: total,
  };
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
