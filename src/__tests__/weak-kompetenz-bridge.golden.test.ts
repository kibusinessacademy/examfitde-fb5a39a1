/**
 * P-Completion 1 — Golden tests for the Weak-Kompetenz Bridge.
 * Pure, deterministic.
 */
import { describe, it, expect } from "vitest";
import { resolveWeakKompetenzIds } from "@/lib/recommendations/weak-kompetenz-bridge";
import { buildKnowledgeGraph } from "@/lib/semantic/KnowledgeGraph";
import type { KnowledgeGraphSnapshot } from "@/lib/semantic/types";
import type { RiskState } from "@/lib/system/SystemConsciousness";

const snap: KnowledgeGraphSnapshot = {
  snapshot_at: "2026-05-25T00:00:00.000Z",
  entities: [
    { id: "k-lf5", kind: "kompetenz", key: "lf5", name: "Lernfeld 5 Bewertung", difficulty: 4 },
    { id: "k-transfer", kind: "kompetenz", key: "transfer-argumentation", name: "Transferargumentation", difficulty: 5,
      meta: { linked_risk_keys: "transfer_argumentation" } },
    { id: "k-praxis", kind: "kompetenz", key: "praxis", name: "Praxisbezug", difficulty: 2 },
    { id: "k-unrelated", kind: "kompetenz", key: "wirtschaftsordnung", name: "Wirtschaftsordnung" },
  ],
  edges: [],
};

const graph = buildKnowledgeGraph(snap);

const risks = (overrides: Partial<Record<string, RiskState["tone"]>> = {}): RiskState[] => {
  const base: Record<string, RiskState["tone"]> = {
    lf5_bewertung: "critical",
    transfer_argumentation: "critical",
    praxisbezug: "stable",
    antwortstruktur: "stable",
    ...overrides,
  };
  return Object.entries(base).map(([key, tone]) => ({
    key: key as RiskState["key"],
    label: key,
    tone,
    since: 0,
  }));
};

describe("resolveWeakKompetenzIds", () => {
  it("returns critical-matching Kompetenz IDs deterministically (highest score first)", () => {
    const ids = resolveWeakKompetenzIds({ graph, risks: risks() });
    // k-transfer scores highest: linked_risk_keys exact (+3) × critical (×2) = 6
    // k-lf5: riskKey.startsWith(key) (+2) × critical (×2) = 4
    expect(ids).toEqual(["k-transfer", "k-lf5"]);
  });

  it("ignores stable risks", () => {
    const ids = resolveWeakKompetenzIds({ graph, risks: risks() });
    expect(ids).not.toContain("k-praxis");
  });

  it("returns empty when no active risks", () => {
    const allStable = risks({ lf5_bewertung: "stable", transfer_argumentation: "stable" });
    expect(resolveWeakKompetenzIds({ graph, risks: allStable })).toEqual([]);
  });

  it("respects limit", () => {
    const ids = resolveWeakKompetenzIds({ graph, risks: risks(), limit: 1 });
    expect(ids).toHaveLength(1);
    expect(ids[0]).toBe("k-transfer");
  });

  it("is stable across calls (same input → same output)", () => {
    const a = resolveWeakKompetenzIds({ graph, risks: risks() });
    const b = resolveWeakKompetenzIds({ graph, risks: risks() });
    expect(a).toEqual(b);
  });
});
