/**
 * P3 — Schema.org SSOT golden tests.
 *
 * Guarantees:
 *  - Builders are pure + deterministic (byte-stable JSON).
 *  - Pillar schema graph includes WebPage + Course + DefinedTermSet +
 *    FAQPage + BreadcrumbList nodes.
 *  - assertSchemaContract rejects missing @id, missing @context, and
 *    marketing phrases.
 *  - Examiner facts are NEVER recomputed here — examiner pass-through
 *    happens upstream in the grounding layer.
 */

import { describe, expect, it } from "vitest";

import {
  assertSchemaContract,
  buildBerufPillarSchema,
  buildBreadcrumbList,
  buildEntitySchema,
  buildFAQPage,
  buildKompetenzSatelliteSchema,
  composeSchemaGraph,
  serializeSchema,
  type SchemaBuilderContext,
} from "@/lib/seo/schema";
import { generateBerufFaqs } from "@/lib/llm-grounding";
import { buildKnowledgeGraph, type KnowledgeGraphSnapshot } from "@/lib/semantic";

const SNAP: KnowledgeGraphSnapshot = {
  snapshot_at: "2026-05-20T00:00:00.000Z",
  entities: [
    { id: "b1", key: "fisi", name: "Fachinformatiker SI", kind: "beruf", description: "IHK-Beruf der Fachrichtung Systemintegration." },
    { id: "p1", key: "fisi-ap1", name: "AP1 FISI", kind: "pruefung", beruf_id: "b1", form: "schriftlich" },
    { id: "lf1", key: "lf6", name: "Lernfeld 6", kind: "lernfeld", beruf_id: "b1", ordinal: 6 },
    { id: "k1", key: "netzwerk", name: "Netzwerkgrundlagen", kind: "kompetenz", lernfeld_id: "lf1", beruf_id: "b1" },
    { id: "k2", key: "subnetting", name: "Subnetting", kind: "kompetenz", lernfeld_id: "lf1", beruf_id: "b1" },
    { id: "r1", key: "transferluecke", name: "Transferlücke", kind: "risiko", kompetenz_id: "k2" },
  ],
  edges: [
    { from: "b1", to: "p1", kind: "beruf_has_pruefung" },
    { from: "b1", to: "lf1", kind: "beruf_has_lernfeld" },
    { from: "lf1", to: "k1", kind: "lernfeld_has_kompetenz" },
    { from: "lf1", to: "k2", kind: "lernfeld_has_kompetenz" },
    { from: "k2", to: "r1", kind: "kompetenz_has_risiko" },
  ],
};

const CTX: SchemaBuilderContext = {
  baseUrl: "https://examfitde.lovable.app",
  snapshot_at: SNAP.snapshot_at,
};
const PROVIDER = { name: "ExamFit", url: "https://examfitde.lovable.app" };

describe("P3 Schema — atomic builders", () => {
  it("buildFAQPage produces deterministic ids and contract-clean output", () => {
    const g = buildKnowledgeGraph(SNAP);
    const faqs = generateBerufFaqs(g, g.getEntity("b1")! as never);
    const a = buildFAQPage(faqs);
    const b = buildFAQPage(faqs);
    expect(serializeSchema(a)).toBe(serializeSchema(b));
    expect(a["@type"]).toBe("FAQPage");
    expect(assertSchemaContract(a).ok).toBe(true);
  });

  it("buildBreadcrumbList positions items 1..n", () => {
    const bc = buildBreadcrumbList([
      { name: "Start", url: "https://examfitde.lovable.app/" },
      { name: "Wissen", url: "https://examfitde.lovable.app/wissen" },
    ]);
    expect(bc["@type"]).toBe("BreadcrumbList");
    const items = bc.itemListElement as ReadonlyArray<{ position: number }>;
    expect(items.map((i) => i.position)).toEqual([1, 2]);
  });

  it("composeSchemaGraph sorts nodes by @id then @type and strips inner @context", () => {
    const a = { "@context": "https://schema.org" as const, "@type": "WebPage", "@id": "z" };
    const b = { "@context": "https://schema.org" as const, "@type": "Course", "@id": "a" };
    const graph = composeSchemaGraph([a, b]);
    const nodes = graph["@graph"] as ReadonlyArray<{ "@id": string }>;
    expect(nodes.map((n) => n["@id"])).toEqual(["a", "z"]);
    // inner @context stripped
    expect((nodes[0] as Record<string, unknown>)["@context"]).toBeUndefined();
  });
});

describe("P3 Schema — Pillar (Beruf)", () => {
  it("emits WebPage + Course + DefinedTermSet + EducationEvent + FAQPage", () => {
    const g = buildKnowledgeGraph(SNAP);
    const beruf = g.getEntity("b1")!;
    const schema = buildBerufPillarSchema(g, CTX, beruf as never, {
      provider: PROVIDER,
      breadcrumbs: [{ name: "Start", url: CTX.baseUrl + "/" }, { name: beruf.name, url: CTX.baseUrl + "/wissen/beruf/fisi" }],
    });
    const types = (schema["@graph"] as ReadonlyArray<{ "@type": string }>).map((n) => n["@type"]);
    expect(types).toContain("WebPage");
    expect(types).toContain("Course");
    expect(types).toContain("DefinedTermSet");
    expect(types).toContain("EducationEvent");
    expect(types).toContain("FAQPage");
    expect(types).toContain("BreadcrumbList");
    expect(assertSchemaContract(schema).ok).toBe(true);
  });

  it("is byte-stable across invocations", () => {
    const g = buildKnowledgeGraph(SNAP);
    const beruf = g.getEntity("b1")!;
    const a = buildBerufPillarSchema(g, CTX, beruf as never, { provider: PROVIDER });
    const b = buildBerufPillarSchema(g, CTX, beruf as never, { provider: PROVIDER });
    expect(serializeSchema(a)).toBe(serializeSchema(b));
  });
});

describe("P3 Schema — Satellite (Kompetenz)", () => {
  it("emits WebPage + DefinedTerm + FAQPage", () => {
    const g = buildKnowledgeGraph(SNAP);
    const k = g.getEntity("k2")!;
    const schema = buildKompetenzSatelliteSchema(g, CTX, k as never, { provider: PROVIDER });
    const types = (schema["@graph"] as ReadonlyArray<{ "@type": string }>).map((n) => n["@type"]);
    expect(types).toContain("WebPage");
    expect(types).toContain("DefinedTerm");
    expect(types).toContain("FAQPage");
    expect(assertSchemaContract(schema).ok).toBe(true);
  });
});

describe("P3 Schema — Contract", () => {
  it("rejects missing @id on Course / WebPage / DefinedTermSet / QAPage / EducationEvent", () => {
    const bad = {
      "@context": "https://schema.org" as const,
      "@type": "Dataset",
      "@graph": [{ "@type": "Course", name: "X" } as never],
    };
    const r = assertSchemaContract(bad);
    expect(r.ok).toBe(false);
    expect(r.violations.some((v) => v.includes("Course_missing_id"))).toBe(true);
  });

  it("rejects marketing phrases anywhere in the graph", () => {
    const g = buildKnowledgeGraph(SNAP);
    const beruf = g.getEntity("b1")!;
    const good = buildBerufPillarSchema(g, CTX, beruf as never, { provider: PROVIDER });
    // inject marketing phrase
    const broken = {
      ...good,
      "@graph": [
        ...((good["@graph"] as JsonLdObject[]) ?? []),
        { "@type": "Thing", "@id": "x", name: "Garantiert die beste Prüfungsvorbereitung" },
      ],
    } as JsonLdObject;
    const r = assertSchemaContract(broken);
    expect(r.ok).toBe(false);
    expect(r.violations.some((v) => v.includes("marketing_phrase"))).toBe(true);
  });

  it("buildEntitySchema dispatches by kind", () => {
    const g = buildKnowledgeGraph(SNAP);
    const beruf = g.getEntity("b1")!;
    const k = g.getEntity("k2")!;
    const p = g.getEntity("p1")!;
    for (const e of [beruf, k, p]) {
      const s = buildEntitySchema(g, CTX, e, { provider: PROVIDER });
      expect(assertSchemaContract(s).ok).toBe(true);
    }
  });
});

import type { JsonLdObject } from "@/lib/seo/schema";
