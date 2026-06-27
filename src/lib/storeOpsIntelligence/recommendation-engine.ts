/**
 * STORE.OPS.INTELLIGENCE.OS.1 — Recommendation engine (pure, allow-list only).
 * Every recommendation carries used_data, detected_patterns, risk, confidence, rationale.
 */
import type {
  ActionSuccessStat,
  AutopilotRunSnapshot,
  BatchSnapshot,
  BlockerCluster,
  ConfidenceBreakdown,
  FrequencyEntry,
  IntelligenceRecommendation,
  IntelligenceRecommendationCode,
  RiskBreakdown,
  TrendDelta,
} from "./contracts.ts";
import { filterAllowedRecommendations } from "./intelligence-policy.ts";

const TITLES: Record<IntelligenceRecommendationCode, string> = {
  RUN_SIMULATION_FIRST: "Zuerst Simulation durchführen",
  REDUCE_BATCH_SIZE: "Batch verkleinern",
  ENABLE_MAINTENANCE_MODE: "Maintenance Mode aktivieren",
  RECALCULATE_KPI: "KPI neu berechnen",
  RISK_ACCEPTABLE: "Risiko aktuell akzeptabel",
  START_MANUAL_REVIEW: "Manuellen Review starten",
  DISABLE_AUTOPILOT: "Autopilot deaktivieren",
  RETRY_FAILED_ACTIONS: "Erneuten Versuch starten",
  INVESTIGATE_RECURRING_BLOCKER: "Wiederkehrenden Blocker untersuchen",
  NO_ACTION_REQUIRED: "Keine Aktion erforderlich",
};

interface BuildArgs {
  risk: RiskBreakdown;
  confidence: ConfidenceBreakdown;
  topBlockers: FrequencyEntry[];
  topFailures: FrequencyEntry[];
  actionStats: ActionSuccessStat[];
  runs: AutopilotRunSnapshot[];
  batches: BatchSnapshot[];
  clusters: BlockerCluster[];
  trends: TrendDelta[];
}

export function buildRecommendations(args: BuildArgs): IntelligenceRecommendation[] {
  const recs: IntelligenceRecommendation[] = [];
  const { risk, confidence, topBlockers, topFailures, actionStats, runs, batches, clusters, trends } = args;

  const failedActions = actionStats.filter((a) => a.failed > 0);
  const recurringCluster = clusters.find((c) => c.occurrences >= 3);
  const trendUpRisk = trends.find((t) => t.metric === "risk_score" && t.direction === "up");
  const trendDownHealth = trends.find((t) => t.metric === "health_score" && t.direction === "down");

  if (risk.level === "critical") {
    recs.push(make("DISABLE_AUTOPILOT", {
      rationale: `Gesamt-Risiko ${risk.total} (kritisch). Autopilot pausieren.`,
      used_data: ["risk", "autopilot_runs"],
      detected_patterns: ["risk_level=critical"],
      risk, confidence,
    }));
    recs.push(make("ENABLE_MAINTENANCE_MODE", {
      rationale: "Maintenance Mode reduziert Auto-Execution, bis Befunde geklärt sind.",
      used_data: ["risk"],
      detected_patterns: ["risk_level=critical"],
      risk, confidence,
    }));
  } else if (risk.level === "high") {
    recs.push(make("RUN_SIMULATION_FIRST", {
      rationale: `Risiko ${risk.total} (hoch). Simulation vor jeder Safe-Execution einplanen.`,
      used_data: ["risk", "autopilot_runs"],
      detected_patterns: ["risk_level=high"],
      risk, confidence,
    }));
    recs.push(make("START_MANUAL_REVIEW", {
      rationale: "Hohes Risiko → manueller Review der offenen Blocker.",
      used_data: ["risk", "blocker_clusters"],
      detected_patterns: ["risk_level=high"],
      risk, confidence,
    }));
  }

  if (recurringCluster) {
    recs.push(make("INVESTIGATE_RECURRING_BLOCKER", {
      rationale: `Cluster ${recurringCluster.cluster_key} taucht ${recurringCluster.occurrences}× auf (${recurringCluster.affected_manifest_count} Manifeste).`,
      used_data: ["blocker_clusters", "batch_items", "autopilot_actions"],
      detected_patterns: [`recurring_cluster=${recurringCluster.cluster_key}`],
      risk, confidence,
    }));
  }

  if (failedActions.length > 0 && confidence.score >= 0.4) {
    recs.push(make("RETRY_FAILED_ACTIONS", {
      rationale: `${failedActions.length} Action-Type(s) mit Fehlschlägen — kontrollierter Retry möglich.`,
      used_data: ["action_success"],
      detected_patterns: failedActions.map((a) => `failed:${a.action_type}`),
      risk, confidence,
    }));
  }

  const largeBatch = batches.find((b) => b.total >= 25 && b.failed + b.blocked >= 5);
  if (largeBatch) {
    recs.push(make("REDUCE_BATCH_SIZE", {
      rationale: `Batch ${largeBatch.batch_id} mit ${largeBatch.total} Items und ${largeBatch.failed + largeBatch.blocked} Fail/Block — Größe reduzieren.`,
      used_data: ["batches"],
      detected_patterns: [`large_batch=${largeBatch.batch_id}`],
      risk, confidence,
    }));
  }

  if (trendUpRisk || trendDownHealth) {
    recs.push(make("RECALCULATE_KPI", {
      rationale: trendUpRisk
        ? `Risk-Score steigt (Δ${trendUpRisk.delta}).`
        : `Health-Score fällt (Δ${trendDownHealth!.delta}).`,
      used_data: ["trend", "kpi_history"],
      detected_patterns: ["trend_degradation"],
      risk, confidence,
    }));
  }

  if (recs.length === 0 && risk.level === "low" && confidence.score >= 0.5) {
    recs.push(make("RISK_ACCEPTABLE", {
      rationale: "Niedriges Risiko und stabile Erfolgsquoten — keine Eingriffe nötig.",
      used_data: ["risk", "confidence"],
      detected_patterns: ["risk_level=low"],
      risk, confidence,
    }));
  } else if (recs.length === 0) {
    recs.push(make("NO_ACTION_REQUIRED", {
      rationale: "Keine handlungsrelevanten Muster erkannt.",
      used_data: [],
      detected_patterns: [],
      risk, confidence,
    }));
  }

  // Mark top blockers and failures in patterns of every rec for transparency.
  for (const r of recs) {
    for (const b of topBlockers.slice(0, 3)) r.detected_patterns.push(`top_blocker:${b.key}(${b.count})`);
    for (const f of topFailures.slice(0, 3)) r.detected_patterns.push(`top_failure:${f.key}(${f.count})`);
    if (!r.used_data.includes("runs") && runs.length) r.used_data.push("runs");
  }

  const { allowed } = filterAllowedRecommendations(recs);
  // Dedup by code, keep first occurrence (deterministic order).
  const seen = new Set<string>();
  const out: IntelligenceRecommendation[] = [];
  for (const r of allowed) {
    if (seen.has(r.code)) continue;
    seen.add(r.code);
    out.push(r);
  }
  return out;
}

function make(
  code: IntelligenceRecommendationCode,
  partial: Omit<IntelligenceRecommendation, "code" | "title">,
): IntelligenceRecommendation {
  return {
    code,
    title: TITLES[code],
    ...partial,
    used_data: [...partial.used_data],
    detected_patterns: [...partial.detected_patterns],
  };
}
