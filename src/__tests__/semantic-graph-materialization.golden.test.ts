/**
 * P5 golden tests — materializer output shape + orphan-free guarantees.
 *
 * Validates the pure builder used by the edge function (re-implemented in
 * the test to keep DB out of the loop). Mirrors the production logic.
 */
import { describe, it, expect } from "vitest";
import { buildKnowledgeGraph } from "@/lib/semantic";
import { pillarSitemapEntries } from "@/lib/semantic/pillarSitemap";

// Mini fixture: 1 beruf, 2 lernfelder, 3 kompetenzen — 5 edges, 0 orphans.
const snap = {
  snapshot_at: "2026-05-20T00:00:00.000Z",
  entities: [
    { id: "beruf:b1", kind: "beruf", key: "fachinformatiker", name: "Fachinformatiker" },
    { id: "lernfeld:l1", kind: "lernfeld", key: "fachinformatiker--lf01", name: "LF1", beruf_id: "beruf:b1" },
    { id: "lernfeld:l2", kind: "lernfeld", key: "fachinformatiker--lf02", name: "LF2", beruf_id: "beruf:b1" },
    { id: "kompetenz:k1", kind: "kompetenz", key: "l1--k1", name: "K1" },
    { id: "kompetenz:k2", kind: "kompetenz", key: "l1--k2", name: "K2" },
    { id: "kompetenz:k3", kind: "kompetenz", key: "l2--k3", name: "K3" },
  ],
  edges: [
    { from: "beruf:b1", to: "lernfeld:l1", kind: "beruf_has_lernfeld" },
    { from: "beruf:b1", to: "lernfeld:l2", kind: "beruf_has_lernfeld" },
    { from: "lernfeld:l1", to: "kompetenz:k1", kind: "lernfeld_has_kompetenz" },
    { from: "lernfeld:l1", to: "kompetenz:k2", kind: "lernfeld_has_kompetenz" },
    { from: "lernfeld:l2", to: "kompetenz:k3", kind: "lernfeld_has_kompetenz" },
  ],
} as const;

describe("P5 graph materialization shape", () => {
  const g = buildKnowledgeGraph(snap as never);

  it("contains all expected entities and edges", () => {
    const s = g.stats();
    expect(s.entities).toBe(6);
    expect(s.edges).toBe(5);
    expect(s.by_kind.beruf).toBe(1);
    expect(s.by_kind.lernfeld).toBe(2);
    expect(s.by_kind.kompetenz).toBe(3);
  });

  it("has zero graph orphans (every entity is referenced by ≥1 edge)", () => {
    const ids = new Set(snap.entities.map((e) => e.id));
    const touched = new Set<string>();
    for (const x of snap.edges) {
      touched.add(x.from);
      touched.add(x.to);
    }
    const orphans = [...ids].filter((id) => !touched.has(id));
    expect(orphans).toEqual([]);
  });

  it("emits stable sitemap entries for routed kinds", () => {
    const entries = pillarSitemapEntries(g);
    // 1 beruf + 3 kompetenz (pruefung kind absent) = 4 routed entries
    expect(entries.length).toBe(4);
    expect(entries.map((e) => e.path)).toEqual([...entries.map((e) => e.path)].sort());
    expect(entries[0].lastmod).toBe("2026-05-20");
  });
});
