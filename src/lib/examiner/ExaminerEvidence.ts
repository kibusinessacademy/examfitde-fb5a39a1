/**
 * Phase 7.7 — Examiner Evidence & Traceability (SSOT)
 *
 * Pure deterministic resolvers. Jede prüferische Aussage in der
 * Plattform MUSS auf einer Evidence-Kette aus diesem Modul beruhen.
 * Keine Heuristik, keine Stimmung, keine Motivation — nur belegbare
 * Beobachtung mit Confidence, Severity und Quellenattribution.
 */
import type {
  RiskKey,
  RiskState,
  RiskTone,
  MemoryEntry,
  BehavioralSignals,
} from "@/lib/system/SystemConsciousness";

export type EvidenceSourceType =
  | "minicheck"
  | "oral_session"
  | "exam_session"
  | "tutor_signal"
  | "learning_progress"
  | "behavioral_signal"
  | "longitudinal_memory";

export type EvidenceSeverity = "low" | "medium" | "high" | "critical";

export interface ExaminerEvidence {
  /** Stable, deterministic id derived from inputs. */
  id: string;
  competency_id: string | null;
  source_type: EvidenceSourceType;
  source_id: string;
  /** 0..1 — how strongly this datum supports the claim. */
  evidence_strength: number;
  detected_pattern: string;
  /** Plain-language sachlicher Befund. Keine Motivation. */
  observation: string;
  /** Wie relevant für die Prüfungssituation. */
  exam_relevance: "kern" | "rand" | "kontext";
  /** 0..1 — Modell-Confidence über das einzelne Evidence-Item. */
  confidence: number;
  severity: EvidenceSeverity;
  detected_at: number;
}

export interface EvidenceChain {
  /** Aussage, die belegt wird — z. B. Verdict-Headline oder Risk-Label. */
  claim: string;
  /** Höchstens 3 Hauptursachen. */
  evidence: ExaminerEvidence[];
  /** Aggregierte Confidence 0..1. */
  confidence: number;
  /** Aggregierte Severity. */
  severity: EvidenceSeverity;
  tone: RiskTone;
}

const SEV_ORDER: EvidenceSeverity[] = ["low", "medium", "high", "critical"];

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function hashId(parts: Array<string | number>): string {
  // Deterministic short hash (FNV-1a) so identical inputs produce identical ids.
  let h = 2166136261;
  const s = parts.join("|");
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `ev_${(h >>> 0).toString(36)}`;
}

function severityFromTone(tone: RiskTone, strength: number): EvidenceSeverity {
  if (tone === "critical") return strength >= 0.75 ? "critical" : "high";
  if (tone === "watch") return strength >= 0.6 ? "high" : "medium";
  return strength >= 0.6 ? "medium" : "low";
}

function aggregateSeverity(items: ExaminerEvidence[]): EvidenceSeverity {
  let max = 0;
  for (const e of items) {
    const idx = SEV_ORDER.indexOf(e.severity);
    if (idx > max) max = idx;
  }
  return SEV_ORDER[max] ?? "low";
}

function aggregateConfidence(items: ExaminerEvidence[]): number {
  if (items.length === 0) return 0;
  // Geometric-mean-ish — multiple weak signals do not fake high confidence.
  const product = items.reduce((acc, e) => acc * Math.max(0.05, e.confidence), 1);
  return clamp01(Math.pow(product, 1 / items.length));
}

function toneFromSeverity(sev: EvidenceSeverity): RiskTone {
  if (sev === "critical" || sev === "high") return "critical";
  if (sev === "medium") return "watch";
  return "stable";
}

/* ------------------------------------------------------------------ */
/* Resolvers                                                          */
/* ------------------------------------------------------------------ */

export function deriveRiskEvidence(risk: RiskState, memory: MemoryEntry[]): ExaminerEvidence[] {
  const evidence: ExaminerEvidence[] = [];
  const ageDays = Math.max(1, Math.floor((Date.now() - risk.since) / 86400000));
  const strength = clamp01(0.4 + (ageDays >= 7 ? 0.3 : ageDays * 0.04) + (risk.tone === "critical" ? 0.3 : 0));

  evidence.push({
    id: hashId([risk.key, "risk-state", risk.tone, ageDays]),
    competency_id: null,
    source_type: "behavioral_signal",
    source_id: risk.key,
    evidence_strength: strength,
    detected_pattern: risk.key,
    observation: `${risk.label} seit ${ageDays} Tagen beobachtet.`,
    exam_relevance: risk.tone === "critical" ? "kern" : "kontext",
    confidence: clamp01(0.55 + (ageDays >= 5 ? 0.2 : 0)),
    severity: severityFromTone(risk.tone, strength),
    detected_at: risk.since,
  });

  const token = risk.label.split(" ")[0].toLowerCase();
  const related = memory.filter((m) => m.text.toLowerCase().includes(token)).slice(0, 2);
  for (const m of related) {
    evidence.push({
      id: hashId([risk.key, "mem", m.id]),
      competency_id: null,
      source_type: "longitudinal_memory",
      source_id: m.id,
      evidence_strength: m.tone === "critical" ? 0.8 : m.tone === "neutral" ? 0.4 : 0.6,
      detected_pattern: `${risk.key}__memory`,
      observation: m.text,
      exam_relevance: m.tone === "critical" ? "kern" : "kontext",
      confidence: 0.6,
      severity: severityFromTone(m.tone === "neutral" ? "watch" : m.tone, 0.6),
      detected_at: m.ts,
    });
  }
  return evidence.slice(0, 3);
}

export function deriveTopRiskEvidence(
  risks: Record<RiskKey, RiskState>,
  memory: MemoryEntry[],
  limit = 3,
): EvidenceChain[] {
  const sorted = Object.values(risks).sort((a, b) => {
    const order = { critical: 0, watch: 1, stable: 2 } as const;
    return order[a.tone] - order[b.tone];
  });
  return sorted.slice(0, limit).map((risk) => {
    const evidence = deriveRiskEvidence(risk, memory);
    return {
      claim: risk.label,
      evidence,
      confidence: aggregateConfidence(evidence),
      severity: aggregateSeverity(evidence),
      tone: risk.tone,
    };
  });
}

export function deriveWeaknessEvidence(
  risks: Record<RiskKey, RiskState>,
  memory: MemoryEntry[],
): EvidenceChain[] {
  return deriveTopRiskEvidence(risks, memory, 5).filter((c) => c.tone !== "stable");
}

export function deriveReadinessEvidence(args: {
  readiness: number;
  risks: Record<RiskKey, RiskState>;
  signals: BehavioralSignals;
  memory: MemoryEntry[];
}): EvidenceChain {
  const { readiness, risks, signals, memory } = args;
  const all = Object.values(risks);
  const critical = all.filter((r) => r.tone === "critical");
  const stable = all.filter((r) => r.tone === "stable");
  const evidence: ExaminerEvidence[] = [];

  evidence.push({
    id: hashId(["readiness", Math.round(readiness)]),
    competency_id: null,
    source_type: "learning_progress",
    source_id: "global_readiness",
    evidence_strength: clamp01(readiness / 100),
    detected_pattern: "readiness_score",
    observation: `Globale Prüfungsreife liegt bei ${Math.round(readiness)} von 100.`,
    exam_relevance: "kern",
    confidence: 0.7,
    severity: readiness >= 75 ? "low" : readiness >= 55 ? "medium" : "high",
    detected_at: Date.now(),
  });

  if (critical.length > 0) {
    evidence.push({
      id: hashId(["readiness_blockers", critical.map((r) => r.key).join(",")]),
      competency_id: null,
      source_type: "behavioral_signal",
      source_id: critical.map((r) => r.key).join(","),
      evidence_strength: clamp01(0.5 + critical.length * 0.15),
      detected_pattern: "critical_risk_block",
      observation: `${critical.length} kritische Risikomuster blockieren Prüfungsreife.`,
      exam_relevance: "kern",
      confidence: 0.75,
      severity: "critical",
      detected_at: Math.min(...critical.map((r) => r.since)),
    });
  }

  const volatility = Math.abs(signals.timePressure - signals.structureStability);
  if (volatility >= 0.4) {
    evidence.push({
      id: hashId(["volatility", Math.round(volatility * 100)]),
      competency_id: null,
      source_type: "behavioral_signal",
      source_id: "signals.volatility",
      evidence_strength: clamp01(volatility),
      detected_pattern: "signal_volatility",
      observation: `Antwortverhalten ist unter Belastung instabil (Volatilität ${(volatility * 100).toFixed(0)}%).`,
      exam_relevance: "kontext",
      confidence: 0.6,
      severity: volatility >= 0.6 ? "high" : "medium",
      detected_at: signals.updatedAt,
    });
  }

  const limited = evidence.slice(0, 3);
  const sev = aggregateSeverity(limited);
  return {
    claim: `Prüfungsreife ${Math.round(readiness)}/100 — ${stable.length} stabile, ${critical.length} kritische Achsen.`,
    evidence: limited,
    confidence: aggregateConfidence(limited),
    severity: sev,
    tone: toneFromSeverity(sev),
  };
}

export function deriveVerdictEvidence(args: {
  verdictHeadline: string;
  verdictDetail: string;
  risks: Record<RiskKey, RiskState>;
  memory: MemoryEntry[];
  readiness: number;
  signals: BehavioralSignals;
}): EvidenceChain {
  const top = deriveTopRiskEvidence(args.risks, args.memory, 2);
  const readiness = deriveReadinessEvidence({
    readiness: args.readiness,
    risks: args.risks,
    signals: args.signals,
    memory: args.memory,
  });
  const merged: ExaminerEvidence[] = [...readiness.evidence, ...top.flatMap((c) => c.evidence)].slice(0, 3);
  const sev = aggregateSeverity(merged);
  return {
    claim: `${args.verdictHeadline} — ${args.verdictDetail}`,
    evidence: merged,
    confidence: aggregateConfidence(merged),
    severity: sev,
    tone: toneFromSeverity(sev),
  };
}

/* ------------------------------------------------------------------ */
/* Contract assertions                                                */
/* ------------------------------------------------------------------ */

export interface EvidenceContractReport {
  ok: boolean;
  violations: string[];
}

/** Verdict ohne Evidence ist verboten. Mehr als 3 Hauptursachen ist verboten. */
export function assertVerdictEvidenceContract(chain: EvidenceChain): EvidenceContractReport {
  const violations: string[] = [];
  if (chain.evidence.length === 0) violations.push("verdict_without_evidence");
  if (chain.evidence.length > 3) violations.push("verdict_with_too_many_causes");
  if (chain.confidence <= 0) violations.push("verdict_with_zero_confidence");
  if (chain.evidence.some((e) => e.confidence > 0.99)) violations.push("evidence_fake_precision");
  return { ok: violations.length === 0, violations };
}
