/**
 * Phase 6 — Prüfungspsychologie & System Intelligence
 *
 * Pures Derivations-Modul (kein State, keine Side-Effects).
 * Liest aus `SystemConsciousness` (Risks + Memory + Signals) und liefert:
 *   - BehavioralPattern[]    → erkannte Muster
 *   - ExaminerInterpretation[] → prüferische Deutung
 *   - StrategicPriority      → was als nächstes wirklich zählt
 *   - shouldRecalc()         → Recalc nur bei echtem Musterwechsel
 *
 * Wichtig: Keine medizinische/therapeutische Sprache. Nur Prüfungspsychologie:
 * beobachtend, leistungsdiagnostisch, ruhig.
 */
import { useMemo } from "react";
import {
  useSystemConsciousness,
  type BehavioralSignals,
  type RiskKey,
  type RiskState,
  type RiskTone,
} from "./SystemConsciousness";

/* ------------------------------ Patterns ------------------------------ */

export type PatternKey =
  | "transfer_collapses_under_pressure"
  | "structure_breaks_on_followups"
  | "practice_lags_behind_facts"
  | "oral_stable_written_volatile"
  | "confidence_stabilizing"
  | "time_pressure_dominant"
  | "rebound_after_setback";

export interface BehavioralPattern {
  key: PatternKey;
  /** Diagnostische Beobachtungsform — niemals motivierend, niemals klinisch. */
  observation: string;
  /** Welche Bedingung das Muster getriggert hat (für Tutor-Erklärung). */
  cause: string;
  tone: RiskTone;
  /** 0..1 — wie deutlich das Muster aktuell sichtbar ist. */
  strength: number;
}

export interface ExaminerInterpretation {
  /** Was ein Prüfer sehen würde, nicht was ein Coach sagen würde. */
  text: string;
  tone: RiskTone;
}

export interface StrategicPriority {
  focus: string;          // ein einziger Fokus, kein Optionsmenü
  reason: string;         // kausale Begründung
  expectedImpact: string; // z.B. "+3 Pkt Prüfungsreife"
  tone: RiskTone;
}

/* ------------------------------ Derivation ------------------------------ */

function getRisk(risks: Record<RiskKey, RiskState>, key: RiskKey): RiskState | undefined {
  return risks[key];
}

function toneWorse(a: RiskTone, b: RiskTone): RiskTone {
  const order: Record<RiskTone, number> = { critical: 0, watch: 1, stable: 2 };
  return order[a] <= order[b] ? a : b;
}

/** Erkennt Verhaltensmuster aus Risiko-Korrelationen + Signals. */
export function derivePatterns(
  risks: Record<RiskKey, RiskState>,
  signals: BehavioralSignals,
): BehavioralPattern[] {
  const patterns: BehavioralPattern[] = [];

  const transfer = getRisk(risks, "transfer_argumentation");
  const time = getRisk(risks, "zeitdruck_relevant");
  const rueckfragen = getRisk(risks, "rueckfragen_wahrscheinlich");
  const oral = getRisk(risks, "muendliche_stabilitaet");
  const schriftlich = getRisk(risks, "schriftliche_stabilitaet");
  const praxis = getRisk(risks, "praxisbezug");
  const struktur = getRisk(risks, "antwortstruktur");

  // 1. Transfer kollabiert unter Zeitdruck — klassische Belastungsdiagnostik
  if (
    transfer &&
    transfer.tone !== "stable" &&
    (signals.timePressure >= 0.5 || (time && time.tone !== "stable"))
  ) {
    patterns.push({
      key: "transfer_collapses_under_pressure",
      observation: "Transferargumentation wird unter Belastung instabil.",
      cause: "Zeitdruck korreliert mit fallender Antwortqualität bei Transferaufgaben.",
      tone: toneWorse(transfer.tone, "watch"),
      strength: Math.min(1, signals.timePressure + 0.25),
    });
  }

  // 2. Struktur bricht bei Rückfragen
  if (
    struktur &&
    rueckfragen &&
    rueckfragen.tone !== "stable" &&
    (signals.structureStability < 0.6 || struktur.tone !== "stable")
  ) {
    patterns.push({
      key: "structure_breaks_on_followups",
      observation: "Mündliche Struktur bricht bei Rückfragen schneller ein.",
      cause: "Folgefragen verschieben die Argumentationsebene — Struktur folgt nicht nach.",
      tone: rueckfragen.tone,
      strength: 1 - signals.structureStability,
    });
  }

  // 3. Praxisbezug stabilisiert langsamer als Fachlichkeit
  if (praxis && praxis.tone !== "stable") {
    patterns.push({
      key: "practice_lags_behind_facts",
      observation: "Praxisbezug stabilisiert sich langsamer als Fachlichkeit.",
      cause: "Fachliche Korrektheit liegt vor — Übertragung in Praxisszenarien noch fragil.",
      tone: praxis.tone,
      strength: 0.55,
    });
  }

  // 4. Oral stabil, schriftlich volatil
  if (oral && schriftlich && oral.tone === "stable" && schriftlich.tone !== "stable") {
    patterns.push({
      key: "oral_stable_written_volatile",
      observation: "Mündliche Belastbarkeit höher als schriftliche Stabilität.",
      cause: "Strukturierung gelingt im Dialog, nicht aber unter schriftlichem Zeitdruck.",
      tone: schriftlich.tone,
      strength: 0.6,
    });
  }

  // 5. Confidence stabilisiert sich (positives Muster)
  if (signals.confidence >= 0.65 && signals.hesitation <= 0.35) {
    patterns.push({
      key: "confidence_stabilizing",
      observation: "Wahlsicherheit stabilisiert sich konsistent.",
      cause: "Zögern sinkt, Antwortwahl folgt klareren Mustern.",
      tone: "stable",
      strength: signals.confidence,
    });
  }

  // 6. Zeitdruck dominiert das Verhalten
  if (signals.timePressure >= 0.7) {
    patterns.push({
      key: "time_pressure_dominant",
      observation: "Antwortqualität sinkt unter Zeitdruck.",
      cause: "Zeitdruck-Signal liegt deutlich über Belastungsschwelle.",
      tone: "watch",
      strength: signals.timePressure,
    });
  }

  return patterns
    .sort((a, b) => {
      const order: Record<RiskTone, number> = { critical: 0, watch: 1, stable: 2 };
      return order[a.tone] - order[b.tone] || b.strength - a.strength;
    })
    .slice(0, 4);
}

/** Examiner-Lens — was ein Prüfer aus den Mustern lesen würde. */
export function deriveExaminerInterpretation(
  patterns: BehavioralPattern[],
  risks: Record<RiskKey, RiskState>,
): ExaminerInterpretation[] {
  const out: ExaminerInterpretation[] = [];

  if (patterns.some((p) => p.key === "transfer_collapses_under_pressure")) {
    out.push({
      text: "Die Antwort bleibt fachlich korrekt, verliert unter Zeitdruck aber an Struktur.",
      tone: "watch",
    });
  }
  if (patterns.some((p) => p.key === "structure_breaks_on_followups")) {
    out.push({
      text: "Bei Rückfragen kippt die Argumentation in Aufzählung — Begründungsebene fehlt.",
      tone: "critical",
    });
  }
  if (patterns.some((p) => p.key === "practice_lags_behind_facts")) {
    out.push({
      text: "Praxisbezug wird sicher erklärt, solange keine Transferleistung verlangt wird.",
      tone: "watch",
    });
  }
  if (patterns.some((p) => p.key === "oral_stable_written_volatile")) {
    out.push({
      text: "Im Dialog belastbar, schriftlich unter Zeitdruck noch nicht stabil.",
      tone: "watch",
    });
  }
  if (patterns.some((p) => p.key === "confidence_stabilizing")) {
    out.push({
      text: "Wahlsicherheit stabilisiert — Reaktionsqualität verbessert sich konsistent.",
      tone: "stable",
    });
  }

  // Fallback: wenn Memory leer ist, mindestens die top-risk-Lens spiegeln
  if (out.length === 0) {
    const order: Record<RiskTone, number> = { critical: 0, watch: 1, stable: 2 };
    const top = Object.values(risks).sort((a, b) => order[a.tone] - order[b.tone])[0];
    if (top) out.push({ text: top.label, tone: top.tone });
  }

  return out.slice(0, 3);
}

/** Eine einzige strategische Priorität ableiten — niemals ein Menü. */
export function deriveStrategicPriority(
  patterns: BehavioralPattern[],
  risks: Record<RiskKey, RiskState>,
): StrategicPriority {
  const dominant = patterns[0];
  if (dominant?.key === "transfer_collapses_under_pressure") {
    return {
      focus: "Transferargumentation unter Belastung stabilisieren",
      reason: "Zeitdruck verstärkt Transferprobleme — größter Hebel auf Prüfungsreife.",
      expectedImpact: "+4 Pkt Prüfungsreife",
      tone: "critical",
    };
  }
  if (dominant?.key === "structure_breaks_on_followups") {
    return {
      focus: "Antwortstruktur bei Rückfragen festigen",
      reason: "Folgefragen brechen die Argumentationsebene — Struktur muss tragen.",
      expectedImpact: "+3 Pkt mündliche Belastbarkeit",
      tone: "critical",
    };
  }
  if (dominant?.key === "practice_lags_behind_facts") {
    return {
      focus: "Praxisbezug auf Transferniveau bringen",
      reason: "Fachliche Korrektheit liegt vor — Praxisübertragung noch fragil.",
      expectedImpact: "+2 Pkt Praxisbezug",
      tone: "watch",
    };
  }
  if (dominant?.key === "oral_stable_written_volatile") {
    return {
      focus: "Schriftliche Struktur unter Zeit stabilisieren",
      reason: "Mündliche Stärke wird unter schriftlichem Zeitdruck nicht abgerufen.",
      expectedImpact: "+3 Pkt schriftliche Stabilität",
      tone: "watch",
    };
  }
  // Fallback: schlimmstes Risiko
  const order: Record<RiskTone, number> = { critical: 0, watch: 1, stable: 2 };
  const top = Object.values(risks).sort((a, b) => order[a.tone] - order[b.tone])[0];
  return {
    focus: top?.label ?? "Prüfungszustand beobachten",
    reason: "Strategisch priorisiert nach aktueller Risiko-Gewichtung.",
    expectedImpact: "+2 Pkt Prüfungsreife",
    tone: top?.tone ?? "watch",
  };
}

/* ----------------------- Recalc-Intelligence ----------------------- */

/** Recalc nur bei echtem Musterwechsel — kein kosmetisches Rauschen. */
export function shouldRecalc(
  prev: BehavioralPattern[],
  next: BehavioralPattern[],
  signalsDelta: number,
): boolean {
  if (signalsDelta >= 0.25) return true;
  if (prev.length !== next.length) return true;
  const prevKeys = prev.map((p) => p.key).sort().join("|");
  const nextKeys = next.map((p) => p.key).sort().join("|");
  if (prevKeys !== nextKeys) return true;
  // Strength-Shift > 30% im Top-Muster → echte Verschiebung
  if (
    prev[0] &&
    next[0] &&
    prev[0].key === next[0].key &&
    Math.abs(prev[0].strength - next[0].strength) > 0.3
  ) {
    return true;
  }
  return false;
}

/* ------------------------------ Hook ------------------------------ */

export interface ExamPsychologyView {
  patterns: BehavioralPattern[];
  examiner: ExaminerInterpretation[];
  priority: StrategicPriority;
  signals: BehavioralSignals;
  readiness: number;
}

/**
 * Lesehook — alle Surfaces dürfen dasselbe psychologische Bewusstsein lesen.
 * Schreiboperationen weiterhin über useSystemConsciousness().recordSignal etc.
 */
export function useExamPsychology(): ExamPsychologyView {
  const { risks, signals, readiness } = useSystemConsciousness();
  return useMemo(() => {
    const patterns = derivePatterns(risks, signals);
    const examiner = deriveExaminerInterpretation(patterns, risks);
    const priority = deriveStrategicPriority(patterns, risks);
    return { patterns, examiner, priority, signals, readiness };
  }, [risks, signals, readiness]);
}
