/**
 * Demo Narratives — deterministisch generiert aus Cohort-Daten.
 * Kein AI-Call. Pure Templating für sofortige Reaktion.
 * (Echte Tutor-Narratives nutzen Graph-Evidence über ai_tutor.)
 */
import type { SampleCohort } from "./cohorts";

export interface CohortNarrative {
  headline: string;
  bullets: string[];
  recommendation: string;
}

export function buildCohortNarrative(cohort: SampleCohort): CohortNarrative {
  const topHotspot = [...cohort.competencyHotspots].sort((a, b) => a.masteryPct - b.masteryPct)[0];
  const redCount = cohort.riskDistribution.red;
  const lift = cohort.recentInterventions[0]?.effectPct ?? 0;
  const probability = cohort.outcomeForecast.examPassProbability;

  return {
    headline: `${cohort.name}: ${probability}% Prüfungswahrscheinlichkeit · ${redCount} kritische Lernende`,
    bullets: [
      `Schwachstelle: ${topHotspot.competency} bei ${topHotspot.masteryPct}% Beherrschung (${topHotspot.note}).`,
      `Recovery-Wirkung der letzten Intervention: +${lift}% — ${cohort.recentInterventions[0]?.outcome ?? "n/a"}.`,
      `Forecast-Driver: ${cohort.outcomeForecast.drivers.join(" · ")}.`,
    ],
    recommendation:
      redCount >= 5
        ? `Sofort handeln: Recovery-Pfad für ${redCount} rote Lernende dispatchen — Wirkung in 14 Tagen messbar.`
        : `Kohorte ist stabil. Fokus auf ${topHotspot.competency} hält Forecast ≥ ${probability}%.`,
  };
}
