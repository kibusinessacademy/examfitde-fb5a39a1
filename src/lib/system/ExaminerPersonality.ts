/**
 * Phase 6.2 — Adaptive Examiner Personalities
 *
 * Pures Derivations-Modul. Wählt eine prüferische Dynamik aus, die
 * den aktuellen Schwachstellen am ehesten Sichtbarkeit verschafft.
 * KEIN Rollenspiel — nur unterschiedliche Beobachtungs-Haltungen.
 */
import { useMemo } from "react";
import {
  useSystemConsciousness,
  type BehavioralSignals,
  type RiskKey,
  type RiskState,
  type RiskTone,
} from "./SystemConsciousness";
import { derivePatterns, type BehavioralPattern } from "./ExamPsychology";

export type ExaminerPersonality =
  | "analytical_cool"
  | "practice_oriented"
  | "structure_critical"
  | "transfer_focused"
  | "detail_oriented"
  | "load_probing";

export interface ExaminerProfile {
  key: ExaminerPersonality;
  label: string;
  intent: string;
  /** Stilistische Hinweise für Rückfragen-Auswahl. */
  followupTone: "konkret" | "kritisch" | "transfer" | "detail" | "belastung" | "praxis";
  tone: RiskTone;
  /** 0..1 — wie "scharf" die Prüfer-Haltung ist. */
  intensity: number;
}

const PROFILES: Record<ExaminerPersonality, Omit<ExaminerProfile, "key" | "intensity" | "tone">> = {
  analytical_cool:    { label: "Analytisch-kühl",     intent: "Saubere Begründungslogik prüfen.",          followupTone: "kritisch"  },
  practice_oriented:  { label: "Praxisorientiert",    intent: "Transfer in reale Fälle prüfen.",           followupTone: "praxis"    },
  structure_critical: { label: "Strukturkritisch",    intent: "Antwortstruktur unter Rückfragen prüfen.",  followupTone: "kritisch"  },
  transfer_focused:   { label: "Transferfokussiert",  intent: "Transferargumentation unter Druck prüfen.", followupTone: "transfer"  },
  detail_oriented:    { label: "Detailorientiert",    intent: "Begründungstiefe und Präzision prüfen.",    followupTone: "detail"    },
  load_probing:       { label: "Belastungsprüfend",   intent: "Stabilität unter Belastung beobachten.",    followupTone: "belastung" },
};

function r(risks: Record<RiskKey, RiskState>, k: RiskKey): RiskState | undefined {
  return risks[k];
}

/** Wählt die Persönlichkeit, die das aktuell dominante Schwachmuster am besten sichtbar macht. */
export function deriveExaminerPersonality(
  risks: Record<RiskKey, RiskState>,
  signals: BehavioralSignals,
  patterns: BehavioralPattern[],
): ExaminerProfile {
  const top = patterns[0];
  const transfer = r(risks, "transfer_argumentation");
  const struktur = r(risks, "antwortstruktur");
  const praxis = r(risks, "praxisbezug");

  let key: ExaminerPersonality = "analytical_cool";
  let tone: RiskTone = "watch";
  let intensity = 0.45;

  if (top?.key === "transfer_collapses_under_pressure" || (transfer && transfer.tone === "critical")) {
    key = "transfer_focused";
    tone = "critical";
    intensity = Math.min(1, signals.timePressure + 0.3);
  } else if (top?.key === "structure_breaks_on_followups" || (struktur && struktur.tone === "critical")) {
    key = "structure_critical";
    tone = "critical";
    intensity = 0.7;
  } else if (top?.key === "practice_lags_behind_facts" || (praxis && praxis.tone !== "stable")) {
    key = "practice_oriented";
    tone = praxis?.tone ?? "watch";
    intensity = 0.55;
  } else if (signals.timePressure >= 0.7 || signals.hesitation >= 0.6) {
    key = "load_probing";
    tone = "watch";
    intensity = Math.min(1, (signals.timePressure + signals.hesitation) / 2 + 0.1);
  } else if (signals.confidence >= 0.7 && signals.structureStability >= 0.6) {
    key = "detail_oriented";
    tone = "stable";
    intensity = 0.4;
  } else {
    key = "analytical_cool";
    tone = "watch";
    intensity = 0.5;
  }

  return { key, ...PROFILES[key], tone, intensity: Number(intensity.toFixed(2)) };
}

const FOLLOWUP_BY_STYLE: Record<ExaminerProfile["followupTone"], string[]> = {
  konkret:   ["Konkret: wie würden Sie das umsetzen?"],
  kritisch:  ["Wo sehen Sie die Schwachstelle Ihrer Begründung?", "Warum wäre genau diese Folgerung kritisch?"],
  transfer:  ["Wie überträgt sich Ihre Antwort auf einen anderen Fall?", "Welche Annahme bricht, wenn der Kontext kippt?"],
  detail:    ["Welcher Teilaspekt ist hier prüfungsrelevant?", "Welche Definition liegt zugrunde?"],
  belastung: ["Sie haben jetzt 30 Sekunden — was zählt zuerst?", "Welche Information darf in dieser Reihenfolge nicht fehlen?"],
  praxis:    ["Wie reagiert die Praxis, wenn die Theorie nicht trägt?", "Welche Konsequenz hätte das im Betrieb?"],
};

export function pickPersonalityFollowup(profile: ExaminerProfile, seed = Date.now()): string {
  const bank = FOLLOWUP_BY_STYLE[profile.followupTone];
  return bank[Math.abs(seed) % bank.length];
}

export function useExaminerPersonality(): ExaminerProfile {
  const { risks, signals } = useSystemConsciousness();
  return useMemo(() => {
    const patterns = derivePatterns(risks, signals);
    return deriveExaminerPersonality(risks, signals, patterns);
  }, [risks, signals]);
}
