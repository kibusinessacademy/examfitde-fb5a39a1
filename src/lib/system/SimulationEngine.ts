/**
 * Phase 6.6 — Strategic Simulation Engine
 *
 * Pures Derivations-Modul. Generiert eine individuelle Prüfungsdramaturgie
 * (Sequenz aus Beats) basierend auf Risikoprofil + Signals.
 * KEINE Quiz-Generierung — nur strategische Dramaturgie-Planung.
 */
import { useMemo } from "react";
import {
  useSystemConsciousness,
  type BehavioralSignals,
  type RiskKey,
  type RiskState,
  type RiskTone,
} from "./SystemConsciousness";

export type BeatKind =
  | "warmup"                 // Orientierung, niedrige Last
  | "stability_anchor"       // bekanntes Terrain, Confidence aufbauen
  | "transfer_probe"         // Transfer-Diagnostik
  | "ambiguity_test"         // mehrdeutige Bewertung
  | "followup_pressure"      // Rückfragen-Stress
  | "structural_break_test"  // strukturkritische Aufgabe
  | "recovery_window"        // gezielte Erholungsphase
  | "consolidation_close";   // ruhiger Abschluss

export interface SimulationBeat {
  position: number;          // 1..n
  kind: BeatKind;
  label: string;
  intent: string;
  /** 0..1 — dramaturgische Spannung dieses Beats. */
  tension: number;
  tone: RiskTone;
  /** Welche Risiken dieser Beat diagnostisch adressiert. */
  targets: RiskKey[];
}

export interface SimulationPlan {
  beats: SimulationBeat[];
  signature: string;       // wiedererkennbarer Plan-Fingerprint
  rationale: string;       // warum genau diese Sequenz
}

const BEAT_TABLE: Record<BeatKind, Omit<SimulationBeat, "position" | "tension" | "targets">> = {
  warmup:                  { kind: "warmup",                 label: "Orientierung",          intent: "Antwortverhalten kalibrieren.",                          tone: "stable"   },
  stability_anchor:        { kind: "stability_anchor",       label: "Stabilitätsanker",      intent: "Bekanntes Terrain — Confidence aufbauen.",               tone: "stable"   },
  transfer_probe:          { kind: "transfer_probe",         label: "Transfer-Diagnostik",   intent: "Transferargumentation gezielt prüfen.",                  tone: "watch"    },
  ambiguity_test:          { kind: "ambiguity_test",         label: "Mehrdeutigkeit",        intent: "Reaktion auf strittige Bewertung beobachten.",           tone: "watch"    },
  followup_pressure:       { kind: "followup_pressure",      label: "Rückfragen-Druck",      intent: "Antwortstruktur unter Folgefragen prüfen.",              tone: "critical" },
  structural_break_test:   { kind: "structural_break_test",  label: "Strukturprüfung",       intent: "Strukturkritische Aufgabe — Struktur muss tragen.",      tone: "critical" },
  recovery_window:         { kind: "recovery_window",        label: "Erholungsfenster",      intent: "Bewusste Stabilisierungsphase.",                         tone: "stable"   },
  consolidation_close:     { kind: "consolidation_close",    label: "Bewertungsruhe",        intent: "Ruhiger Abschluss — Bewertung deliberativ.",             tone: "stable"   },
};

function beat(kind: BeatKind, position: number, tension: number, targets: RiskKey[]): SimulationBeat {
  return { ...BEAT_TABLE[kind], position, tension: Number(tension.toFixed(2)), targets };
}

export function deriveSimulationPlan(
  risks: Record<RiskKey, RiskState>,
  signals: BehavioralSignals,
): SimulationPlan {
  const critical = Object.values(risks).filter((r) => r.tone === "critical").map((r) => r.key);
  const beats: SimulationBeat[] = [];

  // 1. Warmup — immer
  beats.push(beat("warmup", 1, 0.15, []));

  // 2. Stabilitätsanker
  beats.push(beat("stability_anchor", 2, 0.3, ["antwortstruktur"]));

  // 3. Erste Diagnostik — adressiert größtes Risiko
  if (critical.includes("transfer_argumentation")) {
    beats.push(beat("transfer_probe", 3, 0.55, ["transfer_argumentation"]));
  } else if (critical.includes("antwortstruktur")) {
    beats.push(beat("structural_break_test", 3, 0.6, ["antwortstruktur"]));
  } else {
    beats.push(beat("transfer_probe", 3, 0.5, ["transfer_argumentation"]));
  }

  // 4. Belastungsspitze — nur wenn Stabilität aktuell hoch genug
  if (signals.structureStability >= 0.5) {
    if (critical.includes("rueckfragen_wahrscheinlich") || critical.includes("antwortstruktur")) {
      beats.push(beat("followup_pressure", 4, 0.8, ["rueckfragen_wahrscheinlich", "antwortstruktur"]));
    } else {
      beats.push(beat("ambiguity_test", 4, 0.7, ["transfer_argumentation"]));
    }
  } else {
    beats.push(beat("recovery_window", 4, 0.25, []));
  }

  // 5. Erholung — bei kritischer Fatigue mehr Raum
  beats.push(beat("recovery_window", 5, 0.2, []));

  // 6. Letzte Diagnostik
  if (critical.length > 0) {
    beats.push(beat("transfer_probe", 6, 0.6, critical.slice(0, 2)));
  } else {
    beats.push(beat("stability_anchor", 6, 0.35, ["praxisbezug"]));
  }

  // 7. Abschluss
  beats.push(beat("consolidation_close", 7, 0.15, []));

  const signature = beats.map((b) => b.kind[0]).join("");
  const rationale =
    critical.length > 0
      ? `Dramaturgie priorisiert ${critical.length} kritische Risiken — Belastungsspitze auf ${beats[3].label}.`
      : "Dramaturgie beobachtend kalibriert — keine kritischen Risiken in Sequenz.";

  return { beats, signature, rationale };
}

export function useSimulationPlan(): SimulationPlan {
  const { risks, signals } = useSystemConsciousness();
  return useMemo(() => deriveSimulationPlan(risks, signals), [risks, signals]);
}
