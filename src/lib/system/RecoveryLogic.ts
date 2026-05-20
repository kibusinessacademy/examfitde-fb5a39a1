/**
 * Phase 6.5 — Adaptive Recovery Logic
 *
 * Pures Derivations-Modul. Erkennt Stabilisierungsmuster — nicht nur Fehler.
 * Liest aus Memory + Signals und identifiziert Erholung, Resilienz, Recovery.
 */
import { useMemo } from "react";
import {
  useSystemConsciousness,
  type BehavioralSignals,
  type MemoryEntry,
} from "./SystemConsciousness";

export type RecoveryPattern =
  | "fast_correction"        // schnelle Korrektur nach Fehler
  | "structure_recovery"     // Struktur stellt sich nach Bruch wieder her
  | "transfer_rebound"       // Transfer stabilisiert nach Belastung
  | "load_adaptation"        // Anpassung an dauerhafte Belastung
  | "confidence_consolidation"; // Sicherheit konsolidiert sich

export interface RecoverySignal {
  pattern: RecoveryPattern;
  observation: string;
  /** 0..1 — wie deutlich Erholung sichtbar ist. */
  strength: number;
}

export interface RecoveryState {
  signals: RecoverySignal[];
  /** 0..100 — globaler Recovery-Index. */
  index: number;
  /** Ruhige Spiegelung — was der Prüfer sieht. */
  reflection: string;
}

export function deriveRecovery(
  signals: BehavioralSignals,
  memory: MemoryEntry[],
): RecoveryState {
  const recent = memory.slice(0, 8);
  const out: RecoverySignal[] = [];

  // Confidence Consolidation
  if (signals.confidence >= 0.65 && signals.hesitation <= 0.4) {
    out.push({
      pattern: "confidence_consolidation",
      observation: "Wahlsicherheit konsolidiert sich.",
      strength: signals.confidence,
    });
  }

  // Structure Recovery: stabile Struktur trotz vergangenem Stress
  const hadStress = recent.some((m) => m.tone === "critical" || m.tone === "watch");
  if (hadStress && signals.structureStability >= 0.6) {
    out.push({
      pattern: "structure_recovery",
      observation: "Antwortstruktur stellt sich nach Belastung wieder her.",
      strength: signals.structureStability,
    });
  }

  // Transfer Rebound: stable-Memory nach critical
  const lastCriticalIdx = recent.findIndex((m) => m.tone === "critical");
  const firstStableAfter = recent.findIndex((m, i) => i < lastCriticalIdx && m.tone === "stable");
  if (lastCriticalIdx > 0 && firstStableAfter >= 0) {
    out.push({
      pattern: "transfer_rebound",
      observation: "Transferleistung erholt sich nach Rückschlag.",
      strength: 0.6,
    });
  }

  // Load Adaptation: hoher Druck aber Confidence hält
  if (signals.timePressure >= 0.6 && signals.confidence >= 0.55) {
    out.push({
      pattern: "load_adaptation",
      observation: "Belastung wird besser toleriert.",
      strength: signals.confidence * 0.8,
    });
  }

  // Fast Correction: niedriges Zögern bei moderater Pressure
  if (signals.hesitation <= 0.3 && signals.timePressure >= 0.45) {
    out.push({
      pattern: "fast_correction",
      observation: "Korrekturen erfolgen schnell und sicher.",
      strength: 1 - signals.hesitation,
    });
  }

  const index = Math.min(
    100,
    Math.round(out.reduce((acc, s) => acc + s.strength * 22, 0)),
  );

  let reflection = "Stabilisierung wird noch beobachtet.";
  if (index >= 70) reflection = "Erholung konsistent sichtbar — Belastbarkeit wächst.";
  else if (index >= 45) reflection = "Stabilisierungsmuster deutlich erkennbar.";
  else if (index >= 20) reflection = "Erste Stabilisierungssignale sichtbar.";

  return {
    signals: out.sort((a, b) => b.strength - a.strength).slice(0, 3),
    index,
    reflection,
  };
}

export function useRecoveryLogic(): RecoveryState {
  const { signals, memory } = useSystemConsciousness();
  return useMemo(() => deriveRecovery(signals, memory), [signals, memory]);
}
