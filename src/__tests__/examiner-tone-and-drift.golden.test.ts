/**
 * Phase 8.0 / 8.2 — Tone enforcement & decision drift detection.
 */
import { describe, it, expect } from "vitest";
import { assertExaminerTone, assertExaminerToneBatch } from "@/lib/examiner/ExaminerToneGuard";
import {
  buildDecisionRecord,
  assertDecisionReplay,
  detectContradictions,
  ExaminerDecisionTimeline,
} from "@/lib/examiner/ExaminerDecisionLog";
import { deriveDeliberation } from "@/lib/examiner/ExaminerDeliberation";
import { deriveVerdictEvidence, deriveTopRiskEvidence } from "@/lib/examiner/ExaminerEvidence";
import type { RiskKey, RiskState, BehavioralSignals } from "@/lib/system/SystemConsciousness";

describe("Tone enforcement", () => {
  it("flags hype tokens", () => {
    const r = assertExaminerTone("Mega Leistung, du schaffst das!");
    expect(r.ok).toBe(false);
    expect(r.violations.some((v) => v.kind === "hype")).toBe(true);
  });

  it("flags exaggeration", () => {
    const r = assertExaminerTone("Du bist absolut sicher und todsicher fehlerfrei.");
    expect(r.ok).toBe(false);
    expect(r.violations.some((v) => v.kind === "exaggeration")).toBe(true);
  });

  it("accepts sober examiner copy", () => {
    const r = assertExaminerToneBatch([
      "Transfer-Argumentation bleibt unter Belastung instabil.",
      "Prüfungsanmeldung derzeit nicht empfohlen.",
    ]);
    expect(r.ok).toBe(true);
  });
});

describe("Decision replay & drift", () => {
  const NOW = 1_700_000_000_000;
  const risks: Record<RiskKey, RiskState> = {
    transfer_argumentation: { key: "transfer_argumentation", label: "Transfer-Argumentation", tone: "critical", since: NOW - 5 * 86400000 },
    schriftliche_stabilitaet: { key: "schriftliche_stabilitaet", label: "Schriftliche Stabilität", tone: "watch", since: NOW - 3 * 86400000 },
    rueckfragen_wahrscheinlich: { key: "rueckfragen_wahrscheinlich", label: "Rückfragen wahrscheinlich", tone: "stable", since: NOW - 3 * 86400000 },
    zeitdruck_relevant: { key: "zeitdruck_relevant", label: "Zeitdruck relevant", tone: "stable", since: NOW - 3 * 86400000 },
    praxisbezug: { key: "praxisbezug", label: "Praxisbezug", tone: "stable", since: NOW - 3 * 86400000 },
    muendliche_stabilitaet: { key: "muendliche_stabilitaet", label: "Mündliche Stabilität", tone: "stable", since: NOW - 3 * 86400000 },
    lf5_bewertung: { key: "lf5_bewertung", label: "LF5 Bewertung", tone: "stable", since: NOW - 3 * 86400000 },
    antwortstruktur: { key: "antwortstruktur", label: "Antwortstruktur", tone: "stable", since: NOW - 3 * 86400000 },
  };
  const signals: BehavioralSignals = {
    timePressure: 0.6, hesitation: 0.5, structureStability: 0.4, confidence: 0.5, updatedAt: NOW,
  };

  function build() {
    const verdictEvidence = deriveVerdictEvidence({
      verdictHeadline: "Transfer kollabiert unter Druck",
      verdictDetail: "Argumentation verliert Struktur.",
      risks, memory: [], readiness: 62, signals,
    });
    const d = deriveDeliberation({
      readiness: 62, risks, signals,
      verdictEvidence,
      topRiskEvidence: deriveTopRiskEvidence(risks, [], 3),
      stability: { index: 50, volatility: 0.3, reading: "fragil" },
      recurring: [],
      consistency: { index: 0.5, reading: "schwankend", observedSessions: 3 },
    });
    return buildDecisionRecord({
      readiness: 62,
      verdict: { headline: "Transfer kollabiert unter Druck", tone: "critical" },
      deliberation: d,
      verdictEvidence,
      ts: NOW,
    });
  }

  it("identical input → identical decision id (replay)", () => {
    const a = build();
    const b = build();
    expect(assertDecisionReplay(a, b).ok).toBe(true);
  });

  it("contradiction detection catches ready_for_exam + blocking_risks", () => {
    const rec = build();
    const evil = { ...rec, readiness_state: "ready_for_exam" as const, blocking_risks: ["transfer_argumentation"] };
    const verdictEvidence = deriveVerdictEvidence({
      verdictHeadline: "x", verdictDetail: "y", risks, memory: [], readiness: 62, signals,
    });
    const r = detectContradictions(evil, verdictEvidence);
    expect(r.ok).toBe(false);
    expect(r.violations).toContain("ready_state_with_blocking_risks");
  });

  it("timeline is idempotent for consecutive identical decisions", () => {
    const tl = new ExaminerDecisionTimeline();
    const rec = build();
    tl.append(rec);
    tl.append(rec);
    tl.append(rec);
    expect(tl.all().length).toBe(1);
  });
});
