/**
 * Phase 7.x — Humanized Examiner Consciousness
 *
 * Pures Derivations-Modul. Verdichtet die bereits vorhandenen prüferischen
 * Wahrnehmungen (Risks, Patterns, Memory, Fatigue, Recovery, Forecast) zu:
 *
 *   - einer adaptiven Prüfungsbiographie (interpretierte Entwicklung)
 *   - einem strategischen Prüfungsidentitäts-Profil (kein Label, eine Einschätzung)
 *   - deliberativ gewichteten Prüfersätzen (menschlich plausibel, nicht algorithmisch)
 *
 * Niemals: Coach-Sprache, Empathie, Motivation, Gamification. Immer:
 * ruhig, beobachtend, prüferisch, longitudinal.
 */
import { useMemo } from "react";
import {
  useSystemConsciousness,
  type BehavioralSignals,
  type MemoryEntry,
  type RiskKey,
  type RiskState,
  type RiskTone,
} from "./SystemConsciousness";
import { derivePatterns, type BehavioralPattern } from "./ExamPsychology";
import { deriveExaminerMemory, type ExaminerMemoryView } from "./ExaminerMemory";
import { useCognitiveFatigue, type FatigueState } from "./CognitiveFatigue";
import { useRecoveryLogic, type RecoveryState } from "./RecoveryLogic";
import { usePredictiveReadiness, type PredictiveReadinessView } from "./PredictiveReadiness";

/* ----------------------------- Profil ----------------------------- */

export type ExaminerProfileKey =
  | "stabil_unter_belastung"
  | "transferinstabil"
  | "struktursicher"
  | "rueckfragenanfaellig"
  | "praxisstark"
  | "zeitdruckkritisch"
  | "argumentativ_volatil"
  | "muendlich_stabil_schriftlich_instabil"
  | "beobachtungsphase";

export interface ExaminerStrategicProfile {
  key: ExaminerProfileKey;
  /** Prüferische Einschätzung, kein Typenlabel. */
  reading: string;
  /** Welche Belastungsachse den Profilschwerpunkt erzeugt. */
  axis: "transfer" | "struktur" | "praxis" | "zeit" | "rueckfragen" | "mündlich-schriftlich" | "belastung" | "beobachtung";
  tone: RiskTone;
  /** 0..1 — wie deutlich das Profil aktuell sichtbar ist. */
  confidence: number;
}

function r(risks: Record<RiskKey, RiskState>, k: RiskKey) {
  return risks[k];
}

export function deriveStrategicProfile(
  risks: Record<RiskKey, RiskState>,
  signals: BehavioralSignals,
  patterns: BehavioralPattern[],
): ExaminerStrategicProfile {
  const top = patterns[0];
  const transfer = r(risks, "transfer_argumentation");
  const struktur = r(risks, "antwortstruktur");
  const rueckfragen = r(risks, "rueckfragen_wahrscheinlich");
  const oral = r(risks, "muendliche_stabilitaet");
  const schriftlich = r(risks, "schriftliche_stabilitaet");
  const praxis = r(risks, "praxisbezug");

  if (top?.key === "transfer_collapses_under_pressure" || transfer?.tone === "critical") {
    return {
      key: "transferinstabil",
      reading: "Transferargumentation destabilisiert die Antwortqualität unter Belastung.",
      axis: "transfer",
      tone: "critical",
      confidence: Math.min(1, 0.55 + signals.timePressure * 0.3),
    };
  }
  if (top?.key === "structure_breaks_on_followups" || rueckfragen?.tone === "critical") {
    return {
      key: "rueckfragenanfaellig",
      reading: "Struktur bleibt nur stabil, solange keine Rückfragen folgen.",
      axis: "rueckfragen",
      tone: "critical",
      confidence: 0.7,
    };
  }
  if (top?.key === "oral_stable_written_volatile" || (oral?.tone === "stable" && schriftlich && schriftlich.tone !== "stable")) {
    return {
      key: "muendlich_stabil_schriftlich_instabil",
      reading: "Mündliche Belastbarkeit trägt — schriftliche Stabilität folgt verzögert.",
      axis: "mündlich-schriftlich",
      tone: schriftlich?.tone ?? "watch",
      confidence: 0.65,
    };
  }
  if (top?.key === "time_pressure_dominant" || signals.timePressure >= 0.7) {
    return {
      key: "zeitdruckkritisch",
      reading: "Zeitdruck dominiert die Antwortdynamik stärker als der Inhalt.",
      axis: "zeit",
      tone: "watch",
      confidence: signals.timePressure,
    };
  }
  if (praxis?.tone === "stable" && transfer?.tone !== "stable") {
    return {
      key: "praxisstark",
      reading: "Praxisbezug trägt — Transferebene noch nicht konsistent abrufbar.",
      axis: "praxis",
      tone: "watch",
      confidence: 0.55,
    };
  }
  if (struktur?.tone === "stable" && signals.structureStability >= 0.65) {
    return {
      key: "struktursicher",
      reading: "Antwortstruktur bleibt auch unter Rückfragen lesbar.",
      axis: "struktur",
      tone: "stable",
      confidence: signals.structureStability,
    };
  }
  if (signals.structureStability >= 0.6 && signals.confidence >= 0.6 && signals.timePressure < 0.6) {
    return {
      key: "stabil_unter_belastung",
      reading: "Antwortqualität bleibt unter wachsender Belastung konsistent.",
      axis: "belastung",
      tone: "stable",
      confidence: 0.6,
    };
  }
  return {
    key: "beobachtungsphase",
    reading: "Verhalten noch nicht ausreichend stabil interpretierbar — weiter beobachten.",
    axis: "beobachtung",
    tone: "watch",
    confidence: 0.4,
  };
}

/* ----------------------------- Biographie ----------------------------- */

export type BiographyTrend = "stabilisierend" | "verfestigt" | "uneinheitlich" | "neu";

export interface BiographyChapter {
  /** Verdichteter prüferischer Satz — Entwicklung, nicht Ereignis. */
  narrative: string;
  /** Welche Achse das Kapitel betrifft. */
  axis: ExaminerStrategicProfile["axis"];
  trend: BiographyTrend;
  tone: RiskTone;
  /** Wie lange dieses Muster beobachtet wird (Tage). */
  ageDays: number;
}

function chapterFor(
  risk: RiskState,
  memory: MemoryEntry[],
  axis: ExaminerStrategicProfile["axis"],
): BiographyChapter {
  const ageDays = Math.max(1, Math.floor((Date.now() - risk.since) / 86400000));
  const related = memory.filter((m) =>
    m.text.toLowerCase().includes(risk.label.split(" ")[0].toLowerCase()),
  );
  const stableRatio = related.length
    ? related.filter((m) => m.tone === "stable").length / related.length
    : 0;
  const criticalRatio = related.length
    ? related.filter((m) => m.tone === "critical").length / related.length
    : 0;

  let trend: BiographyTrend;
  if (related.length === 0) trend = "neu";
  else if (stableRatio >= 0.6) trend = "stabilisierend";
  else if (criticalRatio >= 0.6) trend = "verfestigt";
  else trend = "uneinheitlich";

  const head = risk.label.replace(/\s+(instabil|unsicher|relevant|stabilisiert|wahrscheinlich).*$/i, "");
  const narrative =
    trend === "stabilisierend"
      ? `${head} stabilisiert sich erstmals konsistent über ${ageDays} Tage.`
      : trend === "verfestigt"
      ? `${head} bleibt seit ${ageDays} Tagen ein wiederkehrendes Belastungsmuster.`
      : trend === "uneinheitlich"
      ? `${head} schwankt seit ${ageDays} Tagen ohne klaren Trend.`
      : `${head} ist neu beobachtet — Vergleichsbasis bildet sich gerade.`;

  return { narrative, axis, trend, tone: risk.tone, ageDays };
}

export function deriveExaminerBiography(
  risks: Record<RiskKey, RiskState>,
  memory: MemoryEntry[],
): BiographyChapter[] {
  const axisMap: Partial<Record<RiskKey, ExaminerStrategicProfile["axis"]>> = {
    transfer_argumentation: "transfer",
    antwortstruktur: "struktur",
    rueckfragen_wahrscheinlich: "rueckfragen",
    zeitdruck_relevant: "zeit",
    praxisbezug: "praxis",
    muendliche_stabilitaet: "mündlich-schriftlich",
    schriftliche_stabilitaet: "mündlich-schriftlich",
    lf5_bewertung: "belastung",
  };

  const order: Record<RiskTone, number> = { critical: 0, watch: 1, stable: 2 };
  const sorted = Object.values(risks).sort((a, b) => order[a.tone] - order[b.tone]);

  // pro Achse maximal ein Kapitel — verdichtet, nicht aufzählend
  const seenAxis = new Set<string>();
  const chapters: BiographyChapter[] = [];
  for (const risk of sorted) {
    const axis = axisMap[risk.key] ?? "belastung";
    if (seenAxis.has(axis)) continue;
    seenAxis.add(axis);
    chapters.push(chapterFor(risk, memory, axis));
    if (chapters.length >= 4) break;
  }
  return chapters;
}

/* --------------------- Deliberative Prüferstimme --------------------- */

export interface DeliberativeStatement {
  /** Ein einzelner, gewichteter Prüfersatz. */
  text: string;
  tone: RiskTone;
  /** 0..1 — interne Gewichtung, wie stark der Prüfer diese Aussage trägt. */
  weight: number;
}

export interface ExaminerVoice {
  /** Die deliberativen Sätze, sortiert nach Gewicht. */
  statements: DeliberativeStatement[];
  /** Ein einziger, ruhig formulierter Schlusssatz — Schlussfolgerung, kein Coaching. */
  closing: string;
}

function pushStatement(out: DeliberativeStatement[], s: DeliberativeStatement) {
  if (!out.find((x) => x.text === s.text)) out.push(s);
}

export function deriveDeliberativeVoice(args: {
  patterns: BehavioralPattern[];
  fatigue: FatigueState;
  recovery: RecoveryState;
  profile: ExaminerStrategicProfile;
  forecast: PredictiveReadinessView;
}): ExaminerVoice {
  const { patterns, fatigue, recovery, profile, forecast } = args;
  const out: DeliberativeStatement[] = [];

  // Belastungsgewichtung dominiert Fachlichkeit
  if (fatigue.level === "hoch" || fatigue.level === "kritisch") {
    pushStatement(out, {
      text: "Die Fachlichkeit bleibt stabil, aber die Belastbarkeit sinkt.",
      tone: "critical",
      weight: 0.95,
    });
  }

  // Struktur unter Rückfragen
  if (patterns.some((p) => p.key === "structure_breaks_on_followups")) {
    pushStatement(out, {
      text: "Die Struktur wirkt nur unter geringer Belastung konsistent.",
      tone: "critical",
      weight: 0.85,
    });
  }

  // Transferreaktionen
  if (patterns.some((p) => p.key === "transfer_collapses_under_pressure")) {
    pushStatement(out, {
      text: "Transferreaktionen destabilisieren die Argumentation deutlich.",
      tone: "critical",
      weight: 0.9,
    });
  }

  // Praxis trägt — Rückfragen kippen sie
  if (patterns.some((p) => p.key === "practice_lags_behind_facts")) {
    pushStatement(out, {
      text: "Der Praxisbezug bleibt belastbar, solange keine Rückfragen folgen.",
      tone: "watch",
      weight: 0.65,
    });
  }

  // Mündlich/schriftlich
  if (patterns.some((p) => p.key === "oral_stable_written_volatile")) {
    pushStatement(out, {
      text: "Mündliche Belastbarkeit stabilisiert sich schneller als schriftliche.",
      tone: "watch",
      weight: 0.6,
    });
  }

  // Stabilisierung
  if (recovery.index >= 60 && forecast.dailyDelta > 0.3) {
    pushStatement(out, {
      text: "Die Belastungsstabilität verbessert sich erstmals konsistent.",
      tone: "stable",
      weight: 0.7,
    });
  }

  // Fallback: Profilaussage
  if (out.length === 0) {
    pushStatement(out, { text: profile.reading, tone: profile.tone, weight: 0.5 });
  }

  out.sort((a, b) => b.weight - a.weight);

  const closing =
    profile.tone === "critical"
      ? "Die Einschätzung trägt, solange das aktuelle Belastungsmuster bestehen bleibt."
      : profile.tone === "stable"
      ? "Die Einschätzung trägt — die Entwicklung verdichtet sich konsistent."
      : "Die Einschätzung bleibt unter Beobachtung, das Muster ist noch nicht abgeschlossen.";

  return { statements: out.slice(0, 4), closing };
}

/* ------------------------------ Hook ------------------------------ */

export interface ExaminerBiographyView {
  profile: ExaminerStrategicProfile;
  chapters: BiographyChapter[];
  voice: ExaminerVoice;
  memory: ExaminerMemoryView;
}

export function useExaminerBiography(): ExaminerBiographyView {
  const { risks, signals, memory } = useSystemConsciousness();
  const fatigue = useCognitiveFatigue();
  const recovery = useRecoveryLogic();
  const forecast = usePredictiveReadiness();

  return useMemo<ExaminerBiographyView>(() => {
    const patterns = derivePatterns(risks, signals);
    const profile = deriveStrategicProfile(risks, signals, patterns);
    const chapters = deriveExaminerBiography(risks, memory);
    const voice = deriveDeliberativeVoice({ patterns, fatigue, recovery, profile, forecast });
    const memoryView = deriveExaminerMemory(risks, memory);
    return { profile, chapters, voice, memory: memoryView };
  }, [risks, signals, memory, fatigue, recovery, forecast]);
}
