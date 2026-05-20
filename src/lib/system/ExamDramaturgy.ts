/**
 * Phase 6.1 — Adaptive Prüfungsdramaturgie
 *
 * Pures Derivations-Modul (kein State, keine Side-Effects).
 * SSOT für:
 *   - dramaturgische Prüfungsphase (Orientierung … Bewertungsruhe)
 *   - adaptive Interventionen (Rückfragen, Transferkomplexität, Zeitfenster)
 *   - Spannungskurve (kontrollierte Intensität, niemals Game-Difficulty)
 *   - deliberative Ruhephasen
 *   - dramaturgische Recalc-Messages
 *
 * Wichtig: Eskalation wirkt prüferisch, nicht algorithmisch. Keine Bestrafungs-
 * logik, keine Panik-Mechaniken. Alle Surfaces (Oral, Exam-Trainer, MiniCheck,
 * Tutor, Lernpfad, Kompetenz) lesen aus DIESEM Modul — niemand hält eigene
 * dramaturgische Wahrheit.
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

/* ------------------------------ Phasen ------------------------------ */

export type DramaturgyPhase =
  | "orientation"        // 1. Orientierung
  | "stability_check"    // 2. Stabilitätsprüfung
  | "load_increase"      // 3. Belastungsanstieg
  | "uncertainty_probe"  // 4. Unsicherheitsprüfung
  | "transfer_stress"    // 5. Transferstress
  | "consolidation"      // 6. Konsolidierung
  | "assessment_calm";   // 7. Bewertungsruhe

export interface PhaseDescriptor {
  phase: DramaturgyPhase;
  /** Ruhige, prüferische Beschreibung (UI-tauglich, niemals dramatisch). */
  label: string;
  /** Examiner-Sicht — was in dieser Phase beobachtet wird. */
  intent: string;
  tone: RiskTone;
}

const PHASE_TABLE: Record<DramaturgyPhase, Omit<PhaseDescriptor, "phase">> = {
  orientation:       { label: "Orientierung",        intent: "Antwortverhalten kalibrieren — keine Bewertung.",        tone: "stable"   },
  stability_check:   { label: "Stabilitätsprüfung",  intent: "Grundstabilität unter normalen Bedingungen beobachten.", tone: "stable"   },
  load_increase:     { label: "Belastungsanstieg",   intent: "Antwortqualität unter wachsender Belastung prüfen.",     tone: "watch"    },
  uncertainty_probe: { label: "Unsicherheitsprüfung",intent: "Reaktion auf mehrdeutige Bewertungsfragen beobachten.",  tone: "watch"    },
  transfer_stress:   { label: "Transferstress",      intent: "Transferargumentation unter Zeitdruck prüfen.",          tone: "critical" },
  consolidation:     { label: "Konsolidierung",      intent: "Strukturwiederherstellung nach Belastung beobachten.",   tone: "stable"   },
  assessment_calm:   { label: "Bewertungsruhe",      intent: "Deliberative Bewertung — kein neuer Input.",             tone: "stable"   },
};

/* ------------------------------ Interventionen ------------------------------ */

export type InterventionKey =
  | "deepen_followup"           // zusätzliche Rückfrage
  | "raise_transfer_complexity" // höhere Transferkomplexität
  | "tighten_time_window"       // engeres Antwortfenster
  | "add_justification_demand"  // zusätzliche Begründungspflicht
  | "ambiguous_practice_case"   // bewusst unklarer Praxisfall
  | "structural_probe"          // strukturkritische Aufgabe
  | "deliberative_pause";       // bewusste Ruhephase

export interface Intervention {
  key: InterventionKey;
  /** Diagnostisch — wie ein Prüfer eine Intervention beschreiben würde. */
  rationale: string;
  /** Konkrete Folgefrage / Stelle, an der die Intervention sichtbar wird. */
  prompt?: string;
  tone: RiskTone;
  /** 0..1 — wie deutlich die Intervention signalisiert wird. */
  intensity: number;
}

/** Ruhige Rückfragen-Bank — niemals aggressiv, niemals quizhaft. */
const FOLLOWUP_BANK: string[] = [
  "Wie würden Sie das konkret begründen?",
  "Ein Kunde widerspricht Ihrer Einschätzung — wie reagieren Sie?",
  "Welche Konsequenz hätte diese Entscheidung in der Praxis?",
  "Warum wäre diese Lösung riskant?",
  "Wie ändert sich Ihre Antwort, wenn die Bewertungsgrundlage strittig ist?",
];

export function pickFollowup(seed = Date.now()): string {
  return FOLLOWUP_BANK[Math.abs(seed) % FOLLOWUP_BANK.length];
}

/* ------------------------------ Spannungskurve ------------------------------ */

export interface TensionCurve {
  /** 0..1 — aktuelle dramaturgische Spannung (kontrolliert). */
  level: number;
  /** Rhythmus-Hinweis für UI (Motion, Hintergrund-Aura, Pausen). */
  rhythm: "low" | "rising" | "peak" | "release";
}

/* ------------------------------ Derivation ------------------------------ */

function r(risks: Record<RiskKey, RiskState>, k: RiskKey): RiskState | undefined {
  return risks[k];
}

/**
 * Leitet die aktuelle dramaturgische Phase aus Signals + Risks ab.
 * Reine Funktion — verändert keinen State.
 *
 * @param elapsedRatio 0..1 — Fortschritt innerhalb der aktuellen Surface-Session.
 */
export function derivePhase(
  signals: BehavioralSignals,
  risks: Record<RiskKey, RiskState>,
  elapsedRatio = 0,
): PhaseDescriptor {
  // Abschluss: niemals neuen Stress aufbauen, wenn Surface kurz vor Ende ist.
  if (elapsedRatio >= 0.9) {
    return { phase: "assessment_calm", ...PHASE_TABLE.assessment_calm };
  }

  const transfer = r(risks, "transfer_argumentation");
  const struktur = r(risks, "antwortstruktur");
  const rueckfragen = r(risks, "rueckfragen_wahrscheinlich");

  const transferCritical = transfer?.tone === "critical";
  const structureBreaking = signals.structureStability < 0.45 || struktur?.tone === "critical";
  const highPressure = signals.timePressure >= 0.65;
  const highHesitation = signals.hesitation >= 0.55;
  const stableConfidence = signals.confidence >= 0.65 && signals.hesitation <= 0.35;

  // Transferstress — höchste Eskalationsstufe, nur bei realer Korrelation
  if (transferCritical && highPressure) {
    return { phase: "transfer_stress", ...PHASE_TABLE.transfer_stress };
  }
  // Unsicherheitsprüfung — Rückfragen-Risiko + Zögern
  if (rueckfragen && rueckfragen.tone !== "stable" && highHesitation) {
    return { phase: "uncertainty_probe", ...PHASE_TABLE.uncertainty_probe };
  }
  // Belastungsanstieg — Strukturbruch ODER hoher Druck
  if (structureBreaking || highPressure) {
    return { phase: "load_increase", ...PHASE_TABLE.load_increase };
  }
  // Konsolidierung — Confidence stabilisiert nach Belastung
  if (stableConfidence && elapsedRatio > 0.4) {
    return { phase: "consolidation", ...PHASE_TABLE.consolidation };
  }
  // Stabilitätsprüfung — Anfang nach Orientierung
  if (elapsedRatio > 0.15) {
    return { phase: "stability_check", ...PHASE_TABLE.stability_check };
  }
  return { phase: "orientation", ...PHASE_TABLE.orientation };
}

/**
 * Schlägt adaptive Interventionen vor.
 * Maximal 2 gleichzeitig — niemals Eskalations-Stapel.
 */
export function deriveInterventions(
  phase: DramaturgyPhase,
  signals: BehavioralSignals,
  patterns: BehavioralPattern[],
): Intervention[] {
  const out: Intervention[] = [];
  const has = (k: BehavioralPattern["key"]) => patterns.some((p) => p.key === k);

  if (phase === "transfer_stress" || has("transfer_collapses_under_pressure")) {
    out.push({
      key: "raise_transfer_complexity",
      rationale: "Transferargumentation gezielt unter Belastung beobachten.",
      tone: "critical",
      intensity: Math.min(1, signals.timePressure + 0.2),
    });
  }
  if (phase === "uncertainty_probe" || has("structure_breaks_on_followups")) {
    out.push({
      key: "deepen_followup",
      rationale: "Antwortstruktur unter Rückfragen prüfen.",
      prompt: pickFollowup(),
      tone: "watch",
      intensity: 1 - signals.structureStability,
    });
  }
  if (phase === "load_increase" && signals.timePressure < 0.7) {
    out.push({
      key: "tighten_time_window",
      rationale: "Antwortfenster behutsam verengen — Belastung kalibrieren.",
      tone: "watch",
      intensity: 0.5,
    });
  }
  if (has("practice_lags_behind_facts")) {
    out.push({
      key: "ambiguous_practice_case",
      rationale: "Praxisbezug an mehrdeutigem Fall prüfen.",
      tone: "watch",
      intensity: 0.55,
    });
  }
  if (phase === "consolidation" || phase === "assessment_calm") {
    out.push({
      key: "deliberative_pause",
      rationale: "Bewertungsruhe — keine neue Belastung, deliberative Phase.",
      tone: "stable",
      intensity: 0.2,
    });
  }
  // Cap & sort: critical zuerst, max 2 gleichzeitig
  const order: Record<RiskTone, number> = { critical: 0, watch: 1, stable: 2 };
  return out.sort((a, b) => order[a.tone] - order[b.tone] || b.intensity - a.intensity).slice(0, 2);
}

export function deriveTension(
  phase: DramaturgyPhase,
  signals: BehavioralSignals,
): TensionCurve {
  const base =
    phase === "transfer_stress" ? 0.9 :
    phase === "uncertainty_probe" ? 0.75 :
    phase === "load_increase" ? 0.6 :
    phase === "consolidation" ? 0.35 :
    phase === "assessment_calm" ? 0.2 :
    phase === "stability_check" ? 0.45 :
    0.3;
  const level = Math.min(1, base * 0.7 + signals.timePressure * 0.3);
  const rhythm: TensionCurve["rhythm"] =
    phase === "assessment_calm" || phase === "consolidation" ? "release" :
    phase === "transfer_stress" ? "peak" :
    phase === "load_increase" || phase === "uncertainty_probe" ? "rising" :
    "low";
  return { level: Number(level.toFixed(2)), rhythm };
}

/** Dramaturgische Recalc-Message — niemals algorithmisches Vokabular. */
export function dramaturgyRecalcMessage(phase: DramaturgyPhase): string {
  switch (phase) {
    case "transfer_stress":   return "Transferreaktion unter Druck analysiert";
    case "uncertainty_probe": return "Rückfragen-Risiko neu bewertet";
    case "load_increase":     return "Belastungsstabilität neu bewertet";
    case "consolidation":     return "Strukturwiederherstellung beobachtet";
    case "assessment_calm":   return "Prüfungsstrategie angepasst";
    case "stability_check":   return "Grundstabilität beobachtet";
    default:                  return "Prüfungszustand aktualisiert";
  }
}

/** Recalc-Trigger: NUR bei echter dramaturgischer Verschiebung. */
export function shouldRecalcDramaturgy(prev: DramaturgyPhase | null, next: DramaturgyPhase): boolean {
  if (prev === null) return false;
  if (prev === next) return false;
  // Bewertungsruhe → niemals Recalc-Rauschen erzeugen
  if (next === "assessment_calm") return false;
  return true;
}

/* ------------------------------ Hook ------------------------------ */

export interface ExamDramaturgyView {
  phase: PhaseDescriptor;
  interventions: Intervention[];
  tension: TensionCurve;
  recalcMessage: string;
}

/**
 * Lesehook — alle Surfaces dürfen dieselbe Dramaturgie lesen.
 * Schreiboperationen weiterhin über useSystemConsciousness().
 */
export function useExamDramaturgy(elapsedRatio = 0): ExamDramaturgyView {
  const { signals, risks } = useSystemConsciousness();
  return useMemo(() => {
    const patterns = derivePatterns(risks, signals);
    const phase = derivePhase(signals, risks, elapsedRatio);
    const interventions = deriveInterventions(phase.phase, signals, patterns);
    const tension = deriveTension(phase.phase, signals);
    const recalcMessage = dramaturgyRecalcMessage(phase.phase);
    return { phase, interventions, tension, recalcMessage };
  }, [signals, risks, elapsedRatio]);
}
