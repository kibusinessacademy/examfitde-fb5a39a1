/**
 * Phase 8.3 — Readiness Authority Layer.
 *
 * Zentraler, autoritativer Zertifizierungs-Zustand für Prüfungsreife.
 * KEINE andere Schicht darf eigene Readiness ableiten oder Empfehlungen
 * zur Prüfung aussprechen. Thresholds sind zentral, auditierbar, testbar.
 */
import type { ReadinessState, DeliberationResult } from "./ExaminerDeliberation";

export const READINESS_THRESHOLDS = {
  ready_for_exam: { minReadiness: 80, minConfidence: 0.7 },
  conditionally_ready: { minReadiness: 65, minConfidence: 0.55 },
  readiness_risk: { minReadiness: 50, minConfidence: 0.4 },
  not_ready: { minReadiness: 0, minConfidence: 0 },
} as const;

export interface ReadinessAuthorityVerdict {
  state: ReadinessState;
  label: string;
  recommendation: string;
  /** True, wenn der Nutzer aus prüferischer Sicht angemeldet werden darf. */
  examRecommended: boolean;
  /** Wenn nicht empfohlen — die ausschlaggebenden Gründe. */
  reasons: string[];
  confidence: number;
}

export function deriveReadinessAuthority(d: DeliberationResult): ReadinessAuthorityVerdict {
  const state = d.readiness_state;
  const label =
    state === "ready_for_exam" ? "Prüfungsreif" :
    state === "conditionally_ready" ? "Bedingt prüfungsreif" :
    state === "readiness_risk" ? "Prüfungsreife gefährdet" :
    "Noch nicht prüfungsreif";

  const examRecommended = state === "ready_for_exam";
  let recommendation: string;
  if (state === "ready_for_exam") {
    recommendation = "Prüfungsanmeldung aus prüferischer Sicht vertretbar.";
  } else if (state === "conditionally_ready") {
    recommendation = "Stabilisierung der offenen Achsen vor Anmeldung empfohlen.";
  } else if (state === "readiness_risk") {
    recommendation = "Prüfungsanmeldung derzeit nicht empfohlen — Risikomuster aktiv.";
  } else {
    recommendation = "Prüfungsanmeldung nicht empfohlen — kritische Kompetenzen instabil.";
  }

  return {
    state,
    label,
    recommendation,
    examRecommended,
    reasons: d.deliberation_reasoning,
    confidence: d.confidence,
  };
}
