/**
 * Phase 7.8 — Longitudinal Examiner Judgement
 *
 * Pure deterministic extensions über `ExaminerMemory`. Bewertet Entwicklung
 * über Zeit: wiederkehrende Schwächen, Recovery-Monotonie, Stabilität.
 * Keine sprunghafte Readiness — Verbesserung wird gedämpft, Wiederkehr
 * wird verstärkt.
 */
import type {
  RiskKey,
  RiskState,
  MemoryEntry,
  RiskTone,
} from "@/lib/system/SystemConsciousness";

export interface ReadinessTrendPoint {
  ts: number;
  /** 0..100 — geglättete Reife. */
  smoothed: number;
}

export interface ReadinessTrend {
  series: ReadinessTrendPoint[];
  /** Punkte/Tag, gedeckelt. */
  dailyDelta: number;
  direction: "stabilisierend" | "regredierend" | "uneinheitlich" | "neu";
}

export interface StabilitySignal {
  index: number; // 0..100
  volatility: number; // 0..1
  reading: "stabil" | "fragil" | "instabil";
}

export interface RecurringWeakness {
  riskKey: RiskKey;
  occurrences: number;
  weight: number; // ≥1 — Wiederkehrer werden verstärkt
  lastSeen: number;
  reading: string;
}

export interface ExamConsistency {
  /** 0..1 — wie konsistent die Performance über Sessions ist. */
  index: number;
  reading: "konsistent" | "schwankend" | "noch_zu_wenig_daten";
  observedSessions: number;
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const clamp01 = (n: number) => clamp(n, 0, 1);

function tonePoints(tone: RiskTone | "neutral"): number {
  if (tone === "critical") return 35;
  if (tone === "watch") return 60;
  if (tone === "stable") return 85;
  return 70;
}

export function deriveReadinessTrend(memory: MemoryEntry[], currentReadiness: number): ReadinessTrend {
  if (memory.length === 0) {
    return {
      series: [{ ts: Date.now(), smoothed: currentReadiness }],
      dailyDelta: 0,
      direction: "neu",
    };
  }
  // chronologisch (alt → neu)
  const chrono = [...memory].sort((a, b) => a.ts - b.ts);
  const series: ReadinessTrendPoint[] = [];
  let smoothed = tonePoints(chrono[0].tone);
  for (const m of chrono) {
    // EMA — Verbesserung dämpft, Verschlechterung wirkt stärker (asymmetric).
    const target = tonePoints(m.tone);
    const alpha = target < smoothed ? 0.45 : 0.2;
    smoothed = smoothed + (target - smoothed) * alpha;
    series.push({ ts: m.ts, smoothed: Math.round(smoothed) });
  }
  const first = series[0];
  const last = series[series.length - 1];
  const days = Math.max(1, (last.ts - first.ts) / 86400000);
  const dailyDelta = clamp((last.smoothed - first.smoothed) / days, -3, 3);
  const direction: ReadinessTrend["direction"] =
    series.length < 3 ? "neu" :
    dailyDelta >= 0.4 ? "stabilisierend" :
    dailyDelta <= -0.4 ? "regredierend" :
    "uneinheitlich";
  return { series, dailyDelta: Number(dailyDelta.toFixed(2)), direction };
}

export function deriveStabilitySignal(memory: MemoryEntry[]): StabilitySignal {
  if (memory.length < 3) {
    return { index: 50, volatility: 0.5, reading: "fragil" };
  }
  const points = memory.slice(0, 12).map((m) => tonePoints(m.tone));
  const mean = points.reduce((a, b) => a + b, 0) / points.length;
  const variance = points.reduce((a, b) => a + (b - mean) ** 2, 0) / points.length;
  const sd = Math.sqrt(variance);
  const volatility = clamp01(sd / 35);
  const index = Math.round(clamp(mean - volatility * 25, 0, 100));
  const reading: StabilitySignal["reading"] =
    volatility <= 0.25 ? "stabil" :
    volatility <= 0.5 ? "fragil" :
    "instabil";
  return { index, volatility: Number(volatility.toFixed(2)), reading };
}

export function deriveRecurringWeaknesses(
  risks: Record<RiskKey, RiskState>,
  memory: MemoryEntry[],
): RecurringWeakness[] {
  const out: RecurringWeakness[] = [];
  for (const risk of Object.values(risks)) {
    if (risk.tone === "stable") continue;
    const token = risk.label.split(" ")[0].toLowerCase();
    const hits = memory.filter((m) => m.text.toLowerCase().includes(token));
    const occurrences = hits.length;
    if (occurrences < 2) continue;
    const weight = clamp(1 + Math.log2(occurrences), 1, 3);
    out.push({
      riskKey: risk.key,
      occurrences,
      weight: Number(weight.toFixed(2)),
      lastSeen: hits[0]?.ts ?? risk.since,
      reading: `${risk.label} kehrt wiederholt zurück (${occurrences}x) — verstärkt gewichtet.`,
    });
  }
  return out.sort((a, b) => b.weight - a.weight).slice(0, 4);
}

export function deriveExamConsistency(memory: MemoryEntry[]): ExamConsistency {
  const exams = memory.filter((m) => m.source === "Exam-Trainer" || m.source === "Oral-Simulation");
  if (exams.length < 3) {
    return { index: 0.5, reading: "noch_zu_wenig_daten", observedSessions: exams.length };
  }
  const points = exams.map((m) => tonePoints(m.tone));
  const mean = points.reduce((a, b) => a + b, 0) / points.length;
  const variance = points.reduce((a, b) => a + (b - mean) ** 2, 0) / points.length;
  const sd = Math.sqrt(variance);
  const index = clamp01(1 - sd / 35);
  const reading: ExamConsistency["reading"] =
    index >= 0.7 ? "konsistent" :
    index >= 0.4 ? "schwankend" :
    "schwankend";
  return { index: Number(index.toFixed(2)), reading, observedSessions: exams.length };
}
