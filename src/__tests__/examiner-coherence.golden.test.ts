/**
 * Phase 7.1 — Golden-State Snapshot Tests
 *
 * Verifiziert die zentrale Produktwahrheit:
 * Gleicher Prüfungszustand → gleiche prüferische Interpretation,
 * unabhängig davon, welche Surface den Snapshot zieht.
 *
 * Die Tests rendern KEINE Surfaces — sie prüfen die SSOT-Derivation
 * direkt. Wenn diese kohärent ist, sind alle Surfaces es per Konstruktion.
 */
import { describe, it, expect } from "vitest";
import {
  deriveExaminerMemory,
} from "@/lib/system/ExaminerMemory";
import { derivePredictiveReadiness } from "@/lib/system/PredictiveReadiness";
import { deriveTransferComplexity } from "@/lib/system/TransferComplexity";
import {
  assertSnapshotCoherence,
  assertCrossSurfaceCoherence,
} from "@/lib/system/ExaminerCoherenceGuard";
import { FORBIDDEN_EXAMINER_TOKENS } from "@/lib/system/ExaminerLexicon";
import type {
  BehavioralSignals,
  RiskKey,
  RiskState,
  MemoryEntry,
} from "@/lib/system/SystemConsciousness";
import type { ExaminationConsciousness } from "@/lib/system/ExaminationConsciousness";

const T0 = 1_700_000_000_000;

function makeRisks(overrides: Partial<Record<RiskKey, RiskState["tone"]>> = {}): Record<RiskKey, RiskState> {
  const keys: RiskKey[] = [
    "transfer_argumentation",
    "schriftliche_stabilitaet",
    "rueckfragen_wahrscheinlich",
    "zeitdruck_relevant",
    "praxisbezug",
    "muendliche_stabilitaet",
    "lf5_bewertung",
    "antwortstruktur",
  ];
  const out = {} as Record<RiskKey, RiskState>;
  for (const k of keys) {
    out[k] = { key: k, label: k, tone: overrides[k] ?? "watch", since: T0 - 7 * 86400000 };
  }
  return out;
}

const SIGNALS_CALM: BehavioralSignals = {
  timePressure: 0.3,
  hesitation: 0.25,
  structureStability: 0.75,
  confidence: 0.7,
  updatedAt: T0,
};

const SIGNALS_STRESS: BehavioralSignals = {
  timePressure: 0.85,
  hesitation: 0.7,
  structureStability: 0.3,
  confidence: 0.35,
  updatedAt: T0,
};

const MEMORY_EMPTY: MemoryEntry[] = [];

describe("Phase 7.1 — Examiner Lexicon governance", () => {
  it("forbids gamification / quiz language in SSOT outputs", () => {
    const risks = makeRisks({ transfer_argumentation: "critical" });
    const view = deriveTransferComplexity(risks, SIGNALS_STRESS);
    const text = `${view.level} ${view.diagnoses} ${view.rationale}`;
    for (const token of FORBIDDEN_EXAMINER_TOKENS) {
      expect(text).not.toContain(token);
    }
  });

  it("examiner-memory summary stays prüferisch", () => {
    const view = deriveExaminerMemory(makeRisks(), MEMORY_EMPTY);
    for (const token of FORBIDDEN_EXAMINER_TOKENS) {
      expect(view.longitudinalSummary).not.toContain(token);
    }
  });
});

describe("Phase 7.1 — Predictive readiness determinism", () => {
  it("same input → same projection", () => {
    const risks = makeRisks({ transfer_argumentation: "critical" });
    const a = derivePredictiveReadiness(risks, SIGNALS_CALM, 72, 55);
    const b = derivePredictiveReadiness(risks, SIGNALS_CALM, 72, 55);
    expect(a).toEqual(b);
  });

  it("stress drives delta downward vs calm baseline", () => {
    const risks = makeRisks({ transfer_argumentation: "critical", antwortstruktur: "critical" });
    const calm = derivePredictiveReadiness(risks, SIGNALS_CALM, 70, 60);
    const stress = derivePredictiveReadiness(risks, SIGNALS_STRESS, 70, 30);
    expect(stress.dailyDelta).toBeLessThanOrEqual(calm.dailyDelta);
    expect(stress.confidence).toBeLessThanOrEqual(calm.confidence);
  });
});

describe("Phase 7.1 — Cross-surface coherence", () => {
  function fakeSnapshot(toneOverrides: Partial<Record<RiskKey, RiskState["tone"]>>): ExaminationConsciousness {
    // Minimaler Snapshot, der die Guard-Invarianten exerciert.
    const risks = makeRisks(toneOverrides);
    const top = Object.values(risks).slice(0, 3);
    return {
      readiness: 72,
      topRisks: top,
      psychology: {
        patterns: [],
        interpretations: [],
        priority: { focus: "Stabilität sichern", reason: "Baseline", tone: "watch" },
      } as any,
      examinerMemory: deriveExaminerMemory(risks, MEMORY_EMPTY),
      personality: { key: "analytical_cool", label: "Analytisch-kühl", intent: "x", followupTone: "kritisch", tone: "watch", intensity: 0.5 },
      transfer: deriveTransferComplexity(risks, SIGNALS_CALM),
      dramaturgy: { phase: "orientation" } as any,
      fatigue: { level: "moderat", drivers: [] } as any,
      recovery: { index: 55, reflection: "" } as any,
      simulation: { beats: [{ position: 1, kind: "warmup", label: "x", intent: "x", tension: 0.2, tone: "watch", targets: [] }] } as any,
      forecast: derivePredictiveReadiness(risks, SIGNALS_CALM, 72, 55),
      efficacy: { stabilityIndex: 55, reflections: [], nextLikely: "" } as any,
      biography: {} as any,
      verdict: { headline: "Stabilität sichern", detail: "Baseline", tone: "watch" },
    };
  }

  it("two surfaces reading the same state produce identical verdict", () => {
    const a = fakeSnapshot({ transfer_argumentation: "watch" });
    const b = fakeSnapshot({ transfer_argumentation: "watch" });
    const report = assertCrossSurfaceCoherence(a, b);
    expect(report.ok).toBe(true);
    expect(report.violations).toEqual([]);
  });

  it("detects internal contradictions (stable verdict + critical top-risk)", () => {
    const snap = fakeSnapshot({ transfer_argumentation: "critical" });
    snap.verdict = { headline: "Alles stabil", detail: "x", tone: "stable" };
    const report = assertSnapshotCoherence(snap);
    expect(report.ok).toBe(false);
    expect(report.violations).toContain("verdict_tone_contradicts_top_risks");
  });

  it("flags forbidden tokens in verdict copy", () => {
    const snap = fakeSnapshot({});
    snap.verdict = { headline: "Quiz starten", detail: "x", tone: "watch" };
    const report = assertSnapshotCoherence(snap);
    expect(report.ok).toBe(false);
    expect(report.violations.some((v) => v.startsWith("forbidden_token_in_verdict"))).toBe(true);
  });
});
