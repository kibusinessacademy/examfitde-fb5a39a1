/**
 * P-Completion 2 — Golden tests for the Mastery Recovery Engine.
 * Pure, deterministic.
 */
import { describe, it, expect } from "vitest";
import { buildRecoveryPlan } from "@/lib/recovery/engine";
import { buildKnowledgeGraph } from "@/lib/semantic/KnowledgeGraph";
import type { KnowledgeGraphSnapshot } from "@/lib/semantic/types";
import type { BehavioralSignals } from "@/lib/system/SystemConsciousness";

const snap: KnowledgeGraphSnapshot = {
  snapshot_at: "2026-05-25T00:00:00.000Z",
  entities: [
    { id: "k-high", kind: "kompetenz", key: "buchungssaetze", name: "Buchungssätze", difficulty: 5,
      meta: { cluster_typische_pruefungsfalle: true } },
    { id: "k-mid",  kind: "kompetenz", key: "kalkulation", name: "Angebotskalkulation", difficulty: 4 },
    { id: "k-low",  kind: "kompetenz", key: "netzwerk", name: "Netzwerktechnik", difficulty: 2 },
  ],
  edges: [],
};
const graph = buildKnowledgeGraph(snap);

const baseSignals: BehavioralSignals = {
  timePressure: 0.4,
  hesitation: 0.3,
  structureStability: 0.6,
  confidence: 0.6,
  updatedAt: 0,
};

describe("buildRecoveryPlan", () => {
  it("returns empty plan when no weak Kompetenzen", () => {
    const plan = buildRecoveryPlan({ graph, weakKompetenzIds: [], signals: baseSignals });
    expect(plan.recommendations).toEqual([]);
    expect(plan.total_target_delta).toBe(0);
  });

  it("ranks high severity first, deterministic tiebreak", () => {
    const plan = buildRecoveryPlan({
      graph,
      weakKompetenzIds: ["k-low", "k-mid", "k-high"],
      signals: baseSignals,
    });
    expect(plan.recommendations.map((r) => r.competency_key)).toEqual([
      "buchungssaetze",  // high (difficulty 5)
      "kalkulation",     // medium (difficulty 4)
      "netzwerk",        // low
    ]);
    expect(plan.recommendations[0].severity).toBe("high");
  });

  it("includes exam_trap_training action when Kompetenz has cluster_typische_pruefungsfalle", () => {
    const plan = buildRecoveryPlan({
      graph,
      weakKompetenzIds: ["k-high"],
      signals: baseSignals,
    });
    const types = plan.recommendations[0].actions.map((a) => a.path_type);
    expect(types).toContain("exam_trap_training");
    expect(types).toContain("explain_again");
    expect(types).toContain("practice_drill");
  });

  it("prepends confidence_recovery when signals collapsed", () => {
    const collapsed: BehavioralSignals = { ...baseSignals, confidence: 0.25, hesitation: 0.7 };
    const plan = buildRecoveryPlan({
      graph,
      weakKompetenzIds: ["k-mid"],
      signals: collapsed,
    });
    expect(plan.recommendations[0].actions[0].path_type).toBe("confidence_recovery");
  });

  it("escalates severity with critical aggregate tone", () => {
    const plan = buildRecoveryPlan({
      graph,
      weakKompetenzIds: ["k-low"],
      signals: baseSignals,
      aggregateTone: "critical",
    });
    expect(plan.recommendations[0].severity).toBe("high");
    expect(plan.recommendations[0].retry_after_hours).toBe(6);
  });

  it("is stable across calls (same input → same output)", () => {
    const a = buildRecoveryPlan({ graph, weakKompetenzIds: ["k-high", "k-mid"], signals: baseSignals });
    const b = buildRecoveryPlan({ graph, weakKompetenzIds: ["k-high", "k-mid"], signals: baseSignals });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("respects limit", () => {
    const plan = buildRecoveryPlan({
      graph,
      weakKompetenzIds: ["k-low", "k-mid", "k-high"],
      signals: baseSignals,
      limit: 1,
    });
    expect(plan.recommendations).toHaveLength(1);
  });

  it("derives plain-language reflection deterministically", () => {
    const plan = buildRecoveryPlan({
      graph,
      weakKompetenzIds: ["k-high"],
      signals: baseSignals,
      aggregateTone: "critical",
    });
    expect(plan.reflection.toLowerCase()).toContain("kritisch");
  });
});
