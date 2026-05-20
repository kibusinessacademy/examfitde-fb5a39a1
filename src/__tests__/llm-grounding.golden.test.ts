/**
 * P2 — LLM-Grounding Layer golden tests.
 *
 * Guarantees:
 *  - Deterministic chunk_ids / document_ids for identical input.
 *  - Every chunk carries ≥1 citation against contract v1.0.0.
 *  - No marketing tone, no superlatives, no promises.
 *  - Examiner facts are passed through verbatim (no recomputation).
 *  - FAQ generation is byte-stable and templated (no LLM).
 */

import { describe, expect, it } from "vitest";

import {
  buildGroundedDocument,
  generateBerufFaqs,
  generateKompetenzFaqs,
  serialiseBeruf,
  serialiseExaminerHandover,
  serialiseKompetenz,
  assertChunkContract,
  assertDocumentContract,
  assertFaqContract,
  type ExaminerHandoverLike,
} from "@/lib/llm-grounding";
import { buildKnowledgeGraph, type KnowledgeGraphSnapshot } from "@/lib/semantic";

const SNAP: KnowledgeGraphSnapshot = {
  snapshot_at: "2026-05-20T00:00:00.000Z",
  entities: [
    { id: "b1", key: "fisi", name: "Fachinformatiker SI", kind: "beruf", description: "IHK-Beruf der Fachrichtung Systemintegration." },
    { id: "p1", key: "fisi-ap1", name: "AP1 FISI", kind: "pruefung", beruf_id: "b1", form: "schriftlich" },
    { id: "p2", key: "fisi-fg", name: "Fachgespräch FISI", kind: "pruefung", beruf_id: "b1", form: "fachgespraech" },
    { id: "lf1", key: "lf6", name: "Lernfeld 6", kind: "lernfeld", beruf_id: "b1", ordinal: 6 },
    { id: "k1", key: "netzwerk", name: "Netzwerkgrundlagen", kind: "kompetenz", lernfeld_id: "lf1", beruf_id: "b1" },
    { id: "k2", key: "subnetting", name: "Subnetting", kind: "kompetenz", lernfeld_id: "lf1", beruf_id: "b1" },
    { id: "r1", key: "transferluecke", name: "Transferlücke Subnetting", kind: "risiko", kompetenz_id: "k2", examiner_severity: "warning" },
    { id: "f1", key: "cidr-verwechslung", name: "CIDR-Verwechslung", kind: "fehlerbild", kompetenz_id: "k2" },
  ],
  edges: [
    { from: "b1", to: "p1", kind: "beruf_has_pruefung" },
    { from: "b1", to: "p2", kind: "beruf_has_pruefung" },
    { from: "b1", to: "lf1", kind: "beruf_has_lernfeld" },
    { from: "lf1", to: "k1", kind: "lernfeld_has_kompetenz" },
    { from: "lf1", to: "k2", kind: "lernfeld_has_kompetenz" },
    { from: "k2", to: "r1", kind: "kompetenz_has_risiko" },
    { from: "k2", to: "f1", kind: "kompetenz_has_fehlerbild" },
    { from: "k1", to: "k2", kind: "related_competency" },
  ],
};

const HANDOVER: ExaminerHandoverLike = {
  anchor_entity_id: "b1",
  anchor_entity_kind: "beruf",
  readiness_state: "approaching_readiness",
  readiness_confidence: 0.74,
  trend_signal: "improving",
  exam_consistency: 0.62,
  critical_competencies: ["Subnetting"],
  top_risks: [
    { id: "r1", label: "Transferlücke Subnetting", severity: "warning" },
  ],
};

describe("P2 LLM-Grounding — Serializers", () => {
  it("serialiseBeruf yields citable chunks with stable ids", () => {
    const g = buildKnowledgeGraph(SNAP);
    const beruf = g.getEntity("b1")!;
    const a = serialiseBeruf(g, beruf as never);
    const b = serialiseBeruf(g, beruf as never);
    expect(a.map((c) => c.chunk_id)).toEqual(b.map((c) => c.chunk_id));
    expect(a.length).toBeGreaterThanOrEqual(2);
    for (const c of a) {
      expect(assertChunkContract(c).ok).toBe(true);
      expect(c.citations.length).toBeGreaterThanOrEqual(1);
      for (const cit of c.citations) expect(cit.contract_version).toBe("1.0.0");
    }
  });

  it("serialiseKompetenz emits risk_profile + related_links when present", () => {
    const g = buildKnowledgeGraph(SNAP);
    const k = g.getEntity("k2")!;
    const chunks = serialiseKompetenz(g, k as never);
    const roles = chunks.map((c) => c.role);
    expect(roles).toContain("definition");
    expect(roles).toContain("risk_profile");
  });
});

describe("P2 LLM-Grounding — Examiner pass-through", () => {
  it("serialiseExaminerHandover passes values verbatim and cites contract v1", () => {
    const chunks = serialiseExaminerHandover(HANDOVER, SNAP.snapshot_at);
    expect(chunks.length).toBe(2);
    const snap = chunks[0];
    expect(snap.role).toBe("readiness_snapshot");
    expect(snap.body).toContain("approaching_readiness");
    expect(snap.body).toContain("74%");
    expect(snap.body).toContain("improving");
    for (const c of chunks) {
      expect(assertChunkContract(c).ok).toBe(true);
      expect(c.citations[0].contract_version).toBe("1.0.0");
      expect(c.citations[0].source_kind).toBe("examiner_handover");
    }
  });

  it("readiness chunk is byte-stable for identical handover", () => {
    const a = serialiseExaminerHandover(HANDOVER, SNAP.snapshot_at);
    const b = serialiseExaminerHandover(HANDOVER, SNAP.snapshot_at);
    expect(a.map((c) => c.chunk_id)).toEqual(b.map((c) => c.chunk_id));
  });
});

describe("P2 LLM-Grounding — FAQ Generator", () => {
  it("generateBerufFaqs yields valid, deterministic faqs with question marks", () => {
    const g = buildKnowledgeGraph(SNAP);
    const beruf = g.getEntity("b1")!;
    const a = generateBerufFaqs(g, beruf as never);
    const b = generateBerufFaqs(g, beruf as never);
    expect(a.map((f) => f.faq_id)).toEqual(b.map((f) => f.faq_id));
    expect(a.length).toBeGreaterThanOrEqual(2);
    for (const f of a) {
      expect(assertFaqContract(f).ok).toBe(true);
      expect(f.question.endsWith("?")).toBe(true);
    }
  });

  it("generateKompetenzFaqs includes a typical-mistakes question when risks exist", () => {
    const g = buildKnowledgeGraph(SNAP);
    const k = g.getEntity("k2")!;
    const faqs = generateKompetenzFaqs(g, k as never);
    expect(faqs.some((f) => /typische[n]? fehler/i.test(f.question))).toBe(true);
  });
});

describe("P2 LLM-Grounding — Document Builder", () => {
  it("buildGroundedDocument composes graph + examiner + faqs deterministically", () => {
    const g = buildKnowledgeGraph(SNAP);
    const beruf = g.getEntity("b1")!;
    const docA = buildGroundedDocument(g, beruf, { examiner: HANDOVER });
    const docB = buildGroundedDocument(g, beruf, { examiner: HANDOVER });

    expect(docA.document_id).toBe(docB.document_id);
    expect(assertDocumentContract(docA).ok).toBe(true);

    const roles = new Set(docA.chunks.map((c) => c.role));
    expect(roles.has("definition")).toBe(true);
    expect(roles.has("readiness_snapshot")).toBe(true);
    expect(roles.has("faq_pair")).toBe(true);
  });

  it("rejects marketing tone in chunk contract", () => {
    const bad = {
      chunk_id: "ch_x",
      role: "definition" as const,
      anchor_entity_id: "b1",
      anchor_entity_kind: "beruf" as const,
      headline: "FISI",
      body: "Mit uns bestehst du garantiert die Prüfung.",
      citations: [{ source_id: "b1", source_kind: "graph_entity" as const, contract_version: "1.0.0" as const }],
      snapshot_at: SNAP.snapshot_at,
    };
    const r = assertChunkContract(bad);
    expect(r.ok).toBe(false);
    expect(r.violations).toContain("body_marketing_tone");
  });
});
