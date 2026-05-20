/**
 * Phase 6.4 — Cognitive Fatigue Modeling
 *
 * Pures Derivations-Modul. Modelliert prüfungsbezogene mentale Belastung
 * aus Verhaltenssignalen. KEINE medizinische/psychologische Diagnostik —
 * nur Leistungsdynamik unter Prüfungsbedingungen.
 */
import { useMemo } from "react";
import { useSystemConsciousness, type BehavioralSignals } from "./SystemConsciousness";

export type FatigueLevel = "stabil" | "leicht" | "erhöht" | "kritisch";

export interface FatigueState {
  level: FatigueLevel;
  /** 0..100 — bounded fatigue score. */
  score: number;
  /** Welche Signale die Belastung treiben. */
  drivers: string[];
  /** Empfohlene Dramaturgie-Anpassung. */
  recommendation:
    | "weiter_normal"
    | "ruhephase_verlängern"
    | "belastung_reduzieren"
    | "session_pausieren";
  /** Recalc-Gewichtung — wie stark der Fatigue-Wert Recalc-Entscheidungen mitführt. */
  recalcWeight: number;
}

export function deriveFatigue(signals: BehavioralSignals): FatigueState {
  const drivers: string[] = [];

  // Konzentrationsabfall: Hesitation + sinkende Confidence
  const concentrationLoss = Math.max(0, signals.hesitation - 0.4) + Math.max(0, 0.6 - signals.confidence);
  if (concentrationLoss > 0.15) drivers.push("Konzentrationsabfall");

  // Strukturverlust unter Zeit
  const structureDecay = Math.max(0, 0.6 - signals.structureStability);
  if (structureDecay > 0.15) drivers.push("Strukturverlust");

  // Reaktionsinstabilität: hoher Zeitdruck + hohes Zögern (paradox = Ermüdung)
  const reactivityDrift = signals.timePressure * signals.hesitation;
  if (reactivityDrift > 0.3) drivers.push("Reaktionsinstabilität");

  // Antwortverkürzung-Proxy: hohe Pressure + niedrige Structure
  const shortening = signals.timePressure > 0.55 && signals.structureStability < 0.5;
  if (shortening) drivers.push("Antwortverkürzung");

  // Bounded score 0..100
  const raw =
    concentrationLoss * 40 +
    structureDecay * 30 +
    reactivityDrift * 30 +
    (shortening ? 10 : 0);
  const score = Math.min(100, Math.max(0, Math.round(raw)));

  let level: FatigueLevel = "stabil";
  let recommendation: FatigueState["recommendation"] = "weiter_normal";
  if (score >= 75) {
    level = "kritisch";
    recommendation = "session_pausieren";
  } else if (score >= 55) {
    level = "erhöht";
    recommendation = "belastung_reduzieren";
  } else if (score >= 30) {
    level = "leicht";
    recommendation = "ruhephase_verlängern";
  }

  return {
    level,
    score,
    drivers,
    recommendation,
    recalcWeight: Math.min(1, score / 100),
  };
}

export function useCognitiveFatigue(): FatigueState {
  const { signals } = useSystemConsciousness();
  return useMemo(() => deriveFatigue(signals), [signals]);
}

export function fatigueLabel(level: FatigueLevel): string {
  return {
    stabil: "Belastung stabil",
    leicht: "Belastung leicht erhöht",
    erhöht: "Belastung erhöht — Ruhephase empfohlen",
    kritisch: "Belastung kritisch — Pause empfohlen",
  }[level];
}
