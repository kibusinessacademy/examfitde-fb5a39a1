import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

/**
 * Phase 5.8 — Cross-Surface System Consciousness.
 *
 * SSOT für Prüfungszustand, Risiko-Sprache, System-Memory und Recalc-Events.
 * Alle Surfaces (/app/start, /app/oral, /app/lernpfad, /app/tutor, /app/kompetenz,
 * /app/minicheck, /app/exam-trainer, /pruefungsreife-ergebnis) lesen aus DIESEM
 * Bewusstsein — niemand hält eigene Wahrheit.
 *
 * Persistenz: localStorage (ef_sysconsciousness_v1). Keine Businesslogik im UI,
 * keine AI-Calls — nur kohärenter Zustands-Layer.
 */

export type RiskTone = "critical" | "watch" | "stable";

/** Globale Risiko-Sprache. Wortlaut ist Teil der Produktidentität. */
export type RiskKey =
  | "transfer_argumentation"
  | "schriftliche_stabilitaet"
  | "rueckfragen_wahrscheinlich"
  | "zeitdruck_relevant"
  | "praxisbezug"
  | "muendliche_stabilitaet"
  | "lf5_bewertung"
  | "antwortstruktur";

export interface RiskState {
  key: RiskKey;
  label: string; // diagnostische Sprache, niemals Quiz-/LMS-Sprache
  tone: RiskTone;
  since: number; // ms epoch
}

export interface MemoryEntry {
  id: string;
  ts: number;
  text: string;
  source: "Oral-Simulation" | "Prüfungsreife-Analyse" | "Lernpfad · Recalc" | "Exam-Trainer" | "MiniCheck" | "Tutor";
  tone: RiskTone | "neutral";
}

export interface RecalcEvent {
  id: string;
  ts: number;
  message: string; // erlaubt: "Strategie angepasst", "Prüfungszustand aktualisiert", …
}

interface SystemConsciousnessState {
  readiness: number; // 0..100 — globale Prüfungsreife
  risks: Record<RiskKey, RiskState>;
  memory: MemoryEntry[]; // jüngste zuerst, cap 20
  lastRecalc: RecalcEvent | null;
  signals: BehavioralSignals; // Phase 6 — Verhaltens-Signale unter Prüfungsbedingungen
}

/** Phase 6 — Verhaltens-Signale (0..1), exponentiell gewichtet. */
export interface BehavioralSignals {
  timePressure: number;        // wie stark der Nutzer unter Zeit gerät
  hesitation: number;          // Zögern bei Antwortwahl
  structureStability: number;  // wie stabil Antwortstruktur unter Belastung bleibt
  confidence: number;          // Ausdruck-/Wahlsicherheit
  updatedAt: number;
}

export type SignalKey = Exclude<keyof BehavioralSignals, "updatedAt">;

interface SystemConsciousnessApi extends SystemConsciousnessState {
  setReadiness: (n: number) => void;
  updateRisk: (key: RiskKey, partial: Partial<Pick<RiskState, "label" | "tone">>) => void;
  remember: (text: string, source: MemoryEntry["source"], tone?: MemoryEntry["tone"]) => void;
  recalc: (message: string) => void;
  topRisks: (n?: number) => RiskState[];
  /** Phase 6 — Verhaltens-Signale aufzeichnen (exponentielle Glättung). */
  recordSignal: (key: SignalKey, value: number, weight?: number) => void;
}

const DEFAULT_SIGNALS: BehavioralSignals = {
  timePressure: 0.35,
  hesitation: 0.3,
  structureStability: 0.6,
  confidence: 0.55,
  updatedAt: Date.now(),
};

const DEFAULT_RISKS: Record<RiskKey, RiskState> = {
  transfer_argumentation: { key: "transfer_argumentation", label: "Transferargumentation instabil", tone: "critical", since: Date.now() - 8 * 86400000 },
  schriftliche_stabilitaet: { key: "schriftliche_stabilitaet", label: "Schriftlich unter Zeitdruck unsicher", tone: "watch", since: Date.now() - 5 * 86400000 },
  rueckfragen_wahrscheinlich: { key: "rueckfragen_wahrscheinlich", label: "Rückfragen wahrscheinlich", tone: "watch", since: Date.now() - 3 * 86400000 },
  zeitdruck_relevant: { key: "zeitdruck_relevant", label: "Zeitdruck-Risiko relevant", tone: "watch", since: Date.now() - 4 * 86400000 },
  praxisbezug: { key: "praxisbezug", label: "Praxisbezug stabilisiert", tone: "stable", since: Date.now() - 2 * 86400000 },
  muendliche_stabilitaet: { key: "muendliche_stabilitaet", label: "Mündliche Stabilität höher als schriftlich", tone: "stable", since: Date.now() - 6 * 86400000 },
  lf5_bewertung: { key: "lf5_bewertung", label: "LF5 verursacht weiterhin Punktverluste", tone: "critical", since: Date.now() - 9 * 86400000 },
  antwortstruktur: { key: "antwortstruktur", label: "Antwortstruktur zuletzt stabiler", tone: "stable", since: Date.now() - 1 * 86400000 },
};

const DEFAULT_MEMORY: MemoryEntry[] = [
  { id: "m-1", ts: Date.now() - 86400000, text: "Transferargumentation seit 8 Tagen instabil", source: "Tutor", tone: "critical" },
  { id: "m-2", ts: Date.now() - 2 * 86400000, text: "Mündliche Stabilität zuletzt verbessert", source: "Oral-Simulation", tone: "stable" },
  { id: "m-3", ts: Date.now() - 3 * 86400000, text: "Zeitdruck verändert Antwortstruktur signifikant", source: "Exam-Trainer", tone: "watch" },
];

const DEFAULT_STATE: SystemConsciousnessState = {
  readiness: 68,
  risks: DEFAULT_RISKS,
  memory: DEFAULT_MEMORY,
  lastRecalc: null,
  signals: DEFAULT_SIGNALS,
};

const STORAGE_KEY = "ef_sysconsciousness_v1";

function hydrate(): SystemConsciousnessState {
  if (typeof window === "undefined") return DEFAULT_STATE;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_STATE;
    const parsed = JSON.parse(raw) as Partial<SystemConsciousnessState>;
    return {
      readiness: typeof parsed.readiness === "number" ? parsed.readiness : DEFAULT_STATE.readiness,
      risks: { ...DEFAULT_STATE.risks, ...(parsed.risks ?? {}) },
      memory: Array.isArray(parsed.memory) && parsed.memory.length > 0 ? parsed.memory.slice(0, 20) : DEFAULT_STATE.memory,
      lastRecalc: parsed.lastRecalc ?? null,
      signals: { ...DEFAULT_SIGNALS, ...(parsed.signals ?? {}) },
    };
  } catch {
    return DEFAULT_STATE;
  }
}

const Ctx = createContext<SystemConsciousnessApi | null>(null);

export function SystemConsciousnessProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SystemConsciousnessState>(() => hydrate());
  const saveTimer = useRef<number | null>(null);

  // Persistenz (debounced, SSR-safe)
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      } catch {
        /* quota / private mode — silent */
      }
    }, 250);
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    };
  }, [state]);

  // Cross-Tab Sync — EIN Bewusstsein, auch über Tabs hinweg
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY || !e.newValue) return;
      try {
        setState(JSON.parse(e.newValue));
      } catch {
        /* noop */
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const setReadiness = useCallback((n: number) => {
    setState((s) => ({ ...s, readiness: Math.max(0, Math.min(100, Math.round(n))) }));
  }, []);

  const updateRisk = useCallback<SystemConsciousnessApi["updateRisk"]>((key, partial) => {
    setState((s) => {
      const prev = s.risks[key];
      if (!prev) return s;
      const next: RiskState = {
        ...prev,
        ...partial,
        // 'since' nur erneuern, wenn sich der tone ändert — Stabilitätsdauer als Wahrheit
        since: partial.tone && partial.tone !== prev.tone ? Date.now() : prev.since,
      };
      return { ...s, risks: { ...s.risks, [key]: next } };
    });
  }, []);

  const remember = useCallback<SystemConsciousnessApi["remember"]>((text, source, tone = "neutral") => {
    setState((s) => {
      const entry: MemoryEntry = {
        id: `m-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        ts: Date.now(),
        text,
        source,
        tone,
      };
      return { ...s, memory: [entry, ...s.memory].slice(0, 20) };
    });
  }, []);

  const recalc = useCallback<SystemConsciousnessApi["recalc"]>((message) => {
    const evt: RecalcEvent = { id: `r-${Date.now()}`, ts: Date.now(), message };
    setState((s) => ({ ...s, lastRecalc: evt }));
  }, []);

  const topRisks = useCallback<SystemConsciousnessApi["topRisks"]>(
    (n = 3) => {
      const order: Record<RiskTone, number> = { critical: 0, watch: 1, stable: 2 };
      return Object.values(state.risks)
        .slice()
        .sort((a, b) => order[a.tone] - order[b.tone] || a.since - b.since)
        .slice(0, n);
    },
    [state.risks],
  );

  // Phase 6 — Behavioral Signal Recording mit exponentieller Glättung.
  // weight=0.3 = ruhig (Default), höhere weights = schnellere Reaktion.
  const recordSignal = useCallback<SystemConsciousnessApi["recordSignal"]>((key, value, weight = 0.3) => {
    const v = Math.max(0, Math.min(1, value));
    const w = Math.max(0, Math.min(1, weight));
    setState((s) => {
      const prev = s.signals[key];
      const blended = prev * (1 - w) + v * w;
      return {
        ...s,
        signals: { ...s.signals, [key]: Number(blended.toFixed(3)), updatedAt: Date.now() },
      };
    });
  }, []);

  const api = useMemo<SystemConsciousnessApi>(
    () => ({ ...state, setReadiness, updateRisk, remember, recalc, topRisks, recordSignal }),
    [state, setReadiness, updateRisk, remember, recalc, topRisks, recordSignal],
  );

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useSystemConsciousness(): SystemConsciousnessApi {
  const ctx = useContext(Ctx);
  if (!ctx) {
    // Safe-Fallback: read-only Default — verhindert Crash, falls Provider fehlt.
    return {
      ...DEFAULT_STATE,
      setReadiness: () => {},
      updateRisk: () => {},
      remember: () => {},
      recalc: () => {},
      topRisks: (n = 3) => Object.values(DEFAULT_STATE.risks).slice(0, n),
    };
  }
  return ctx;
}

/** Token-Helper — EIN Risiko-Look für alle Surfaces. */
export function riskToneClasses(tone: RiskTone): string {
  if (tone === "critical") return "border-destructive/30 bg-destructive/5 text-destructive";
  if (tone === "watch") return "border-primary/30 bg-primary/5 text-primary";
  return "border-emerald-400/30 bg-emerald-400/5 text-emerald-500 dark:text-emerald-300";
}

export function readinessLabel(r: number): string {
  if (r >= 85) return "Prüfungsreife belastbar";
  if (r >= 70) return "Prüfungsreife stabilisiert";
  if (r >= 55) return "Prüfungsreife beobachtet";
  return "Prüfungsreife unter Risiko";
}

export function daysSince(ts: number): number {
  return Math.max(0, Math.floor((Date.now() - ts) / 86400000));
}
