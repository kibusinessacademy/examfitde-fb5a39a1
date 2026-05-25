/**
 * P-Completion 2 — Mastery Recovery Engine.
 *
 * Builds a deterministic RecoveryPlan from weak Kompetenz-IDs +
 * SystemConsciousness signals. Pure function, SSR-safe.
 *
 * Inputs:
 *   - weak_kompetenz_ids   (from resolveWeakKompetenzIds bridge)
 *   - graph                (KnowledgeGraph, read-only)
 *   - signals              (BehavioralSignals — confidence/hesitation/etc.)
 *   - risk_tones           (per-RiskKey tone, used as severity hint)
 *
 * Outputs RecoveryRecommendation[] with up to 4 actions per Kompetenz,
 * ordered by recovery priority:
 *   1. confidence_recovery  → if signals indicate confidence collapse
 *   2. exam_trap_training   → if Kompetenz has cluster_typische_pruefungsfalle
 *   3. explain_again        → always available (Tutor)
 *   4. practice_drill       → always available (Exam-Trainer)
 *
 * Recovery is offered ONLY when there is a real weakness signal.
 * No demo fallback. No engagement-optimised "more questions" copy.
 */

import type { KnowledgeGraph } from "@/lib/semantic/KnowledgeGraph";
import type { Kompetenz } from "@/lib/semantic/types";
import type { BehavioralSignals, RiskTone } from "@/lib/system/SystemConsciousness";
import { classifyWeaknessClusters } from "@/lib/recommendations/weakness-clusters";
import type {
  RecoveryAction,
  RecoveryPathType,
  RecoveryPlan,
  RecoveryRecommendation,
  RecoverySeverity,
  RecoverySource,
} from "./types";

export interface BuildRecoveryPlanInput {
  graph: KnowledgeGraph;
  weakKompetenzIds: ReadonlyArray<string>;
  signals: BehavioralSignals;
  /** Aggregate tone — caller may pass max tone across active risks. */
  aggregateTone?: RiskTone;
  /** Optional limit on number of competencies (default 4). */
  limit?: number;
}

const RETRY_AFTER_HOURS: Record<RecoverySeverity, number> = {
  high: 6,
  medium: 24,
  low: 72,
};

const TARGET_DELTA: Record<RecoverySeverity, number> = {
  high: 0.18,
  medium: 0.12,
  low: 0.06,
};

function deriveSeverity(
  k: Kompetenz,
  aggregateTone: RiskTone | undefined,
): RecoverySeverity {
  const diff = k.difficulty ?? 0;
  if (aggregateTone === "critical" || diff >= 5) return "high";
  if (aggregateTone === "watch" || diff >= 4) return "medium";
  return "low";
}

function confidenceCollapsed(s: BehavioralSignals): boolean {
  // Threshold chosen to be stable + observable; not engagement-tuned.
  return s.confidence <= 0.4 || s.hesitation >= 0.6;
}

function buildActions(
  k: Kompetenz,
  severity: RecoverySeverity,
  signals: BehavioralSignals,
): ReadonlyArray<RecoveryAction> {
  const clusters = classifyWeaknessClusters(k);
  const hasTrap = clusters.includes("typische_pruefungsfalle")
    || clusters.includes("oft_verwechselt_mit")
    || clusters.includes("hohe_durchfall_relevanz");

  const orderedTypes: RecoveryPathType[] = [];
  if (confidenceCollapsed(signals)) orderedTypes.push("confidence_recovery");
  if (hasTrap) orderedTypes.push("exam_trap_training");
  orderedTypes.push("explain_again");
  orderedTypes.push("practice_drill");

  // Deterministic dedupe.
  const seen = new Set<RecoveryPathType>();
  const actions: RecoveryAction[] = [];
  for (const t of orderedTypes) {
    if (seen.has(t)) continue;
    seen.add(t);
    actions.push(actionFor(t, k, severity));
  }
  return actions;
}

function actionFor(
  type: RecoveryPathType,
  k: Kompetenz,
  severity: RecoverySeverity,
): RecoveryAction {
  switch (type) {
    case "explain_again":
      return {
        label: "Fehler verstehen",
        to: `/app/tutor?focus=${encodeURIComponent(k.key)}&mode=explain_again`,
        path_type: "explain_again",
        est_minutes: severity === "high" ? 5 : 3,
      };
    case "practice_drill":
      return {
        label: "Schnell-Recovery starten",
        to: `/app/exam-trainer?focus=${encodeURIComponent(k.key)}&mode=drill`,
        path_type: "practice_drill",
        est_minutes: severity === "high" ? 8 : 5,
      };
    case "exam_trap_training":
      return {
        label: "Prüfungsfalle trainieren",
        to: `/app/exam-trainer?focus=${encodeURIComponent(k.key)}&mode=trap`,
        path_type: "exam_trap_training",
        est_minutes: 7,
      };
    case "confidence_recovery":
      return {
        label: "5-Minuten-Rebuild",
        to: `/app/minicheck?focus=${encodeURIComponent(k.key)}&mode=confidence`,
        path_type: "confidence_recovery",
        est_minutes: 5,
      };
  }
}

function deriveSources(
  signals: BehavioralSignals,
  aggregateTone: RiskTone | undefined,
  k: Kompetenz,
): ReadonlyArray<RecoverySource> {
  const out: RecoverySource[] = [];
  if (aggregateTone === "critical" || aggregateTone === "watch") out.push("risk_signal");
  if ((k.difficulty ?? 0) >= 4) out.push("low_mastery");
  if (confidenceCollapsed(signals)) out.push("repeat_wrong");
  if (signals.timePressure >= 0.7) out.push("slow_response");
  // Deterministic order.
  return Array.from(new Set(out));
}

function reflectionFor(plan: ReadonlyArray<RecoveryRecommendation>): string {
  if (plan.length === 0) return "Aktuell keine akute Schwäche — Stabilität halten.";
  const high = plan.filter((r) => r.severity === "high").length;
  if (high >= 2) return "Mehrere kritische Lücken — wir bringen dich zurück in einen sicheren Prüfungszustand.";
  if (high === 1) return "Eine kritische Lücke — gezielter Rebuild empfohlen.";
  return "Stabilisierungsphase — kleine, konkrete Schritte.";
}

export function buildRecoveryPlan(input: BuildRecoveryPlanInput): RecoveryPlan {
  const limit = Math.max(1, Math.min(10, input.limit ?? 4));
  if (input.weakKompetenzIds.length === 0) {
    return { recommendations: [], total_target_delta: 0, reflection: reflectionFor([]) };
  }

  const seen = new Set<string>();
  const recs: RecoveryRecommendation[] = [];
  for (const id of input.weakKompetenzIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    const entity = input.graph.getEntity(id);
    if (!entity || entity.kind !== "kompetenz") continue;
    const k = entity as Kompetenz;
    const severity = deriveSeverity(k, input.aggregateTone);
    const actions = buildActions(k, severity, input.signals);
    const sources = deriveSources(input.signals, input.aggregateTone, k);
    recs.push({
      id: `recovery:${k.id}`,
      competency_id: k.id,
      competency_key: k.key,
      competency_name: k.name,
      severity,
      weakness_sources: sources,
      actions,
      recovery_reason: `${severity}/${sources.join("+") || "graph_signal"}`,
      retry_after_hours: RETRY_AFTER_HOURS[severity],
      mastery_target_delta: TARGET_DELTA[severity],
    });
    if (recs.length >= limit) break;
  }

  // Deterministic sort: severity desc (high>medium>low), then competency_key asc.
  const sevRank: Record<RecoverySeverity, number> = { high: 3, medium: 2, low: 1 };
  recs.sort((a, b) => {
    if (sevRank[b.severity] !== sevRank[a.severity]) return sevRank[b.severity] - sevRank[a.severity];
    return a.competency_key < b.competency_key ? -1 : 1;
  });

  const total_target_delta = recs.reduce((acc, r) => acc + r.mastery_target_delta, 0);
  return { recommendations: recs, total_target_delta, reflection: reflectionFor(recs) };
}
