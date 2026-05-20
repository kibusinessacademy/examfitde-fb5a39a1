/**
 * Phase 6.8 — Adaptive Motivation Without Gamification
 *
 * Pures Derivations-Modul. Spiegelt Fortschritt als Stabilisierung —
 * NICHT als XP/Streaks/Badges. Erzeugt Selbstwirksamkeit durch Sichtbarkeit
 * von realer Risikoreduktion.
 */
import { useMemo } from "react";
import {
  useSystemConsciousness,
  type RiskKey,
  type RiskState,
} from "./SystemConsciousness";

export interface EfficacyReflection {
  /** Was wirklich besser geworden ist — ruhig formuliert. */
  statement: string;
  /** Optionaler kausaler Hinweis. */
  because?: string;
}

export interface SelfEfficacyView {
  /** 0..100 — Stabilisierungs-Index (NICHT Score, NICHT Punkte). */
  stabilityIndex: number;
  /** Wie viele Risiken aktuell stabil sind. */
  stabilizedCount: number;
  totalRisks: number;
  /** Maximal 3 ruhige Spiegelungen. */
  reflections: EfficacyReflection[];
  /** Was als nächste Stabilisierung wahrscheinlich folgt — keine Versprechung. */
  nextLikely: string;
}

export function deriveSelfEfficacy(
  risks: Record<RiskKey, RiskState>,
  readiness: number,
): SelfEfficacyView {
  const all = Object.values(risks);
  const stabilized = all.filter((r) => r.tone === "stable");
  const watch = all.filter((r) => r.tone === "watch");
  const critical = all.filter((r) => r.tone === "critical");

  const stabilityIndex = Math.min(
    100,
    Math.round((stabilized.length / Math.max(1, all.length)) * 60 + readiness * 0.4),
  );

  const reflections: EfficacyReflection[] = [];
  for (const r of stabilized.slice(0, 2)) {
    reflections.push({
      statement: `${r.label}`,
      because: "Konsistente Beobachtung über mehrere Sessions.",
    });
  }
  if (stabilityIndex >= 60) {
    reflections.push({
      statement: "Belastbarkeit wächst — Stabilisierungsmuster überwiegen.",
    });
  } else if (stabilized.length === 0 && watch.length > 0) {
    reflections.push({
      statement: "Erste Stabilisierungsbewegungen sichtbar — Beobachtung läuft.",
    });
  }

  const nextLikely =
    critical.length === 0
      ? "Konsolidierung der bestehenden Stabilität."
      : `${critical[0].label} — nächstes wahrscheinliches Stabilisierungsfeld.`;

  return {
    stabilityIndex,
    stabilizedCount: stabilized.length,
    totalRisks: all.length,
    reflections: reflections.slice(0, 3),
    nextLikely,
  };
}

export function useSelfEfficacy(): SelfEfficacyView {
  const { risks, readiness } = useSystemConsciousness();
  return useMemo(() => deriveSelfEfficacy(risks, readiness), [risks, readiness]);
}
