/**
 * Phase 6.7 — Systemic Examiner Intelligence
 *
 * Pures Derivations-Modul. Liest System-Memory + Risks als langfristige
 * Entwicklung — wie ein Prüfer, der einen Lerner über Zeit beobachtet.
 * KEINE Korrektur — nur Interpretation der Entwicklung.
 */
import { useMemo } from "react";
import {
  useSystemConsciousness,
  type MemoryEntry,
  type RiskKey,
  type RiskState,
  type RiskTone,
} from "./SystemConsciousness";

export type DevelopmentTrend = "stabilisiert" | "uneinheitlich" | "regredierend" | "neu_beobachtet";

export interface ExaminerObservation {
  /** Was der Prüfer über die Entwicklung sieht. */
  text: string;
  trend: DevelopmentTrend;
  tone: RiskTone;
  /** 0..1 — wie konsistent das Muster über Memory hinweg ist. */
  consistency: number;
}

export interface ExaminerMemoryView {
  observations: ExaminerObservation[];
  /** Ein einziger Satz, der die Gesamteinschätzung trägt. */
  longitudinalSummary: string;
  /** Wie lange Risiken durchschnittlich bereits beobachtet werden (Tage). */
  averageRiskAgeDays: number;
}

const order: Record<RiskTone, number> = { critical: 0, watch: 1, stable: 2 };

function classifyTrend(memory: MemoryEntry[], risk: RiskState): DevelopmentTrend {
  const related = memory.filter((m) => m.text.toLowerCase().includes(risk.label.split(" ")[0].toLowerCase()));
  if (related.length === 0) return "neu_beobachtet";
  const tones = related.map((m) => m.tone);
  const stableRatio = tones.filter((t) => t === "stable").length / tones.length;
  const criticalRatio = tones.filter((t) => t === "critical").length / tones.length;
  if (stableRatio >= 0.6) return "stabilisiert";
  if (criticalRatio >= 0.6) return "regredierend";
  return "uneinheitlich";
}

export function deriveExaminerMemory(
  risks: Record<RiskKey, RiskState>,
  memory: MemoryEntry[],
): ExaminerMemoryView {
  const observations: ExaminerObservation[] = [];

  const sortedRisks = Object.values(risks).sort((a, b) => order[a.tone] - order[b.tone]);
  for (const risk of sortedRisks.slice(0, 4)) {
    const trend = classifyTrend(memory, risk);
    const ageDays = Math.max(1, Math.floor((Date.now() - risk.since) / 86400000));
    const text =
      trend === "stabilisiert" ? `${risk.label} — Entwicklung stabilisiert sich über ${ageDays} Tage.` :
      trend === "regredierend" ? `${risk.label} — Muster verfestigt sich seit ${ageDays} Tagen.` :
      trend === "uneinheitlich" ? `${risk.label} — Entwicklung uneinheitlich, kein klarer Trend.` :
      `${risk.label} — neu beobachtet, noch keine Vergleichsbasis.`;
    observations.push({
      text,
      trend,
      tone: risk.tone,
      consistency: trend === "stabilisiert" || trend === "regredierend" ? 0.8 : 0.4,
    });
  }

  const avgAge = Math.round(
    Object.values(risks).reduce((acc, r) => acc + Math.max(1, (Date.now() - r.since) / 86400000), 0) /
      Math.max(1, Object.values(risks).length),
  );

  const criticalCount = sortedRisks.filter((r) => r.tone === "critical").length;
  const stableCount = sortedRisks.filter((r) => r.tone === "stable").length;
  const longitudinalSummary =
    criticalCount === 0
      ? `Über durchschnittlich ${avgAge} Tage zeigt sich konsolidierende Stabilität.`
      : criticalCount >= 2
      ? `Über durchschnittlich ${avgAge} Tage verfestigen sich ${criticalCount} kritische Muster — Entwicklung bedarf Beobachtung.`
      : `Über durchschnittlich ${avgAge} Tage stabilisiert sich ein Teil der Muster, während ${criticalCount} kritisch bleibt.`;

  return {
    observations,
    longitudinalSummary,
    averageRiskAgeDays: avgAge,
  };
}

export function useExaminerMemory(): ExaminerMemoryView {
  const { risks, memory } = useSystemConsciousness();
  return useMemo(() => deriveExaminerMemory(risks, memory), [risks, memory]);
}
