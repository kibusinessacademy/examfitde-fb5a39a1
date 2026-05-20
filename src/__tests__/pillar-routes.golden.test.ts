/**
 * Phase P4 — Golden tests for Pillar route SSOT.
 *
 * Determinism: path builders, cross-link rows, sitemap entries.
 */

import { describe, it, expect } from "vitest";
import {
  buildKnowledgeGraph,
  pillarPath,
  pillarPathByKind,
  pillarAbsoluteUrl,
  pillarSitemapEntries,
  isRoutedEntityKind,
  ROUTED_ENTITY_KINDS,
  type KnowledgeGraphSnapshot,
} from "@/lib/semantic";

const SNAP: KnowledgeGraphSnapshot = {
  snapshot_at: "2026-05-20T00:00:00.000Z",
  entities: [
    { id: "b1", key: "fachinformatiker-ae", name: "Fachinformatiker AE", kind: "beruf" },
    { id: "k1", key: "datenmodellierung", name: "Datenmodellierung", kind: "kompetenz", beruf_id: "b1" },
    { id: "p1", key: "fisi-ap1", name: "Abschlussprüfung Teil 1", kind: "pruefung", beruf_id: "b1", form: "schriftlich" },
    { id: "f1", key: "norm-fehler", name: "Normalisierungsfehler", kind: "fehlerbild", kompetenz_id: "k1" },
  ],
  edges: [
    { kind: "beruf_has_pruefung", from: "b1", to: "p1" },
    { kind: "kompetenz_has_fehlerbild", from: "k1", to: "f1" },
  ],
};

describe("P4 pillar routes", () => {
  it("ROUTED_ENTITY_KINDS is the 3 public kinds", () => {
    expect([...ROUTED_ENTITY_KINDS]).toEqual(["beruf", "kompetenz", "pruefung"]);
  });

  it("pillarPath encodes only routed kinds; non-routed returns null", () => {
    expect(pillarPathByKind("beruf", "fachinformatiker-ae")).toBe("/wissen/beruf/fachinformatiker-ae");
    expect(pillarPath({ kind: "kompetenz", key: "datenmodellierung" })).toBe("/wissen/kompetenz/datenmodellierung");
    expect(pillarPath({ kind: "fehlerbild", key: "norm-fehler" })).toBeNull();
    expect(isRoutedEntityKind("industry_context")).toBe(false);
  });

  it("pillarAbsoluteUrl strips trailing slash and prefixes base", () => {
    expect(
      pillarAbsoluteUrl("https://examfitde.lovable.app/", { kind: "beruf", key: "fachinformatiker-ae" }),
    ).toBe("https://examfitde.lovable.app/wissen/beruf/fachinformatiker-ae");
  });

  it("sitemap entries are deterministic, sorted, only routed kinds", () => {
    const g = buildKnowledgeGraph(SNAP);
    const a = pillarSitemapEntries(g);
    const b = pillarSitemapEntries(g);
    expect(a).toEqual(b);
    expect(a.map((e) => e.path)).toEqual([
      "/wissen/beruf/fachinformatiker-ae",
      "/wissen/kompetenz/datenmodellierung",
      "/wissen/pruefung/fisi-ap1",
    ]);
    expect(a.every((e) => e.lastmod === "2026-05-20")).toBe(true);
  });
});
