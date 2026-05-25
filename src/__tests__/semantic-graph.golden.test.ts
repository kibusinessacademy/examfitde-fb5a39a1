/**
 * P1 — Knowledge Graph golden tests.
 *
 * Guarantees:
 *  - Deterministic ordering (same input → same output, every time).
 *  - Resolvers dedupe + sort stably.
 *  - The semantic layer does NOT import from `@/lib/examiner` for
 *    computation — it only consumes the frozen Handover Contract types.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildKnowledgeGraph,
  relatedCompetencies,
  relatedExamScenarios,
  relatedFaqs,
  relatedKarrierepfade,
  relatedLernpfade,
  relatedMistakes,
  relatedOralExamTopics,
  relatedOralPatterns,
  relatedRisks,
  relatedTutorTopics,
  type KnowledgeGraphSnapshot,
} from "@/lib/semantic";

const SNAP: KnowledgeGraphSnapshot = {
  snapshot_at: "2026-05-20T00:00:00.000Z",
  entities: [
    { id: "b1", key: "fisi", name: "Fachinformatiker SI", kind: "beruf" },
    { id: "p1", key: "fisi-ap1", name: "AP1 FISI", kind: "pruefung", beruf_id: "b1", form: "schriftlich" },
    { id: "p2", key: "fisi-fg", name: "Fachgespräch FISI", kind: "pruefung", beruf_id: "b1", form: "fachgespraech" },
    { id: "lf1", key: "lf6", name: "Lernfeld 6", kind: "lernfeld", beruf_id: "b1", ordinal: 6 },
    { id: "k1", key: "netzwerk", name: "Netzwerkgrundlagen", kind: "kompetenz", lernfeld_id: "lf1", beruf_id: "b1" },
    { id: "k2", key: "subnetting", name: "Subnetting", kind: "kompetenz", lernfeld_id: "lf1", beruf_id: "b1" },
    { id: "r1", key: "transferluecke", name: "Transferlücke Subnetting", kind: "risiko", kompetenz_id: "k2", examiner_severity: "warning" },
    { id: "f1", key: "cidr-verwechslung", name: "CIDR-Verwechslung", kind: "fehlerbild", kompetenz_id: "k2" },
    { id: "o1", key: "oral-netz", name: "Mündliches Netz-Pattern", kind: "oral_pattern", kompetenz_id: "k1" },
  ],
  edges: [
    { from: "b1", to: "p1", kind: "beruf_has_pruefung" },
    { from: "b1", to: "p2", kind: "beruf_has_pruefung" },
    { from: "b1", to: "lf1", kind: "beruf_has_lernfeld" },
    { from: "lf1", to: "k1", kind: "lernfeld_has_kompetenz" },
    { from: "lf1", to: "k2", kind: "lernfeld_has_kompetenz" },
    { from: "k2", to: "r1", kind: "kompetenz_has_risiko" },
    { from: "k2", to: "f1", kind: "kompetenz_has_fehlerbild" },
    { from: "k1", to: "o1", kind: "kompetenz_has_oral_pattern" },
    { from: "k1", to: "k2", kind: "related_competency" },
    // duplicate, must dedupe:
    { from: "k1", to: "k2", kind: "related_competency" },
  ],
};

describe("KnowledgeGraph determinism", () => {
  it("produces identical stats across rebuilds", () => {
    const a = buildKnowledgeGraph(SNAP).stats();
    const b = buildKnowledgeGraph({ ...SNAP }).stats();
    expect(a).toEqual(b);
    expect(a.entities).toBe(9);
    // 10 edges in input, 1 duplicate → 9 unique
    expect(a.edges).toBe(9);
  });

  it("dedupes duplicate edges", () => {
    const g = buildKnowledgeGraph(SNAP);
    const rel = g.outgoingEdges("k1", "related_competency");
    expect(rel.length).toBe(1);
  });
});

describe("resolvers", () => {
  const g = buildKnowledgeGraph(SNAP);

  it("relatedCompetencies(lernfeld) returns its competencies, sorted", () => {
    const out = relatedCompetencies(g, "lf1").map((e) => e.key);
    expect(out).toEqual(["netzwerk", "subnetting"]);
  });

  it("relatedRisks(lernfeld) flows through competencies", () => {
    const out = relatedRisks(g, "lf1").map((e) => e.key);
    expect(out).toEqual(["transferluecke"]);
  });

  it("relatedMistakes(kompetenz) returns direct fehlerbilder", () => {
    const out = relatedMistakes(g, "k2").map((e) => e.key);
    expect(out).toEqual(["cidr-verwechslung"]);
  });

  it("relatedOralPatterns(kompetenz) returns direct patterns", () => {
    const out = relatedOralPatterns(g, "k1").map((e) => e.key);
    expect(out).toEqual(["oral-netz"]);
  });

  it("relatedExamScenarios(beruf, form=fachgespraech) narrows correctly", () => {
    const out = relatedExamScenarios(g, "b1", { form: "fachgespraech" }).map((e) => e.key);
    expect(out).toEqual(["fisi-fg"]);
  });

  it("relatedExamScenarios(kompetenz) resolves via beruf_id", () => {
    const out = relatedExamScenarios(g, "k1").map((e) => e.key);
    expect(out).toEqual(["fisi-ap1", "fisi-fg"]);
  });
});

describe("examiner isolation", () => {
  it("semantic source files do not import from @/lib/examiner", () => {
    const files = ["types.ts", "KnowledgeGraph.ts", "resolvers.ts", "PillarTypes.ts", "index.ts"];
    for (const f of files) {
      const path = join(process.cwd(), "src/lib/semantic", f);
      const src = readFileSync(path, "utf8");
      expect(src, `${f} must not import from @/lib/examiner`).not.toMatch(/from\s+["']@\/lib\/examiner/);
    }
  });
});
