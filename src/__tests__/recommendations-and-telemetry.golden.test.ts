/**
 * W1 Cut 3b — Golden tests for Recommendation engine + telemetry payloads.
 *
 * Hard rules under test:
 *   - deterministic ordering (same inputs ⇒ same output)
 *   - never recommends the weak competency itself
 *   - exam-form bias prefers oral patterns for muendlich
 *   - days_to_exam ≤ 14 drops "preventive" recs
 *   - telemetry payload carries every SSOT field
 *   - no free text / no PII in telemetry metadata
 */
import { describe, it, expect } from "vitest";
import { recommendForWeaknesses } from "@/lib/recommendations/engine";
import {
  classifyWeaknessClusters,
  WEAKNESS_CLUSTER_TAGS,
} from "@/lib/recommendations/weakness-clusters";
import {
  buildAdaptiveCtaDecisionPayload,
  readinessBucket,
  examPhase,
  sessionDepthBucket,
  confidenceBucket,
  __testing,
} from "@/lib/intent/decision-telemetry";
import type { KnowledgeGraphSnapshot } from "@/lib/semantic/types";

const KOMP_A = "k-angebot";
const KOMP_B = "k-kalkulation";
const FB = "fb-rechenfehler";
const RISK = "r-zeitdruck";
const ORAL = "op-einkauf";
const REL = "k-deckungsbeitrag";

const graph: KnowledgeGraphSnapshot = {
  snapshot_at: "2026-05-25T00:00:00Z",
  entities: [
    { id: KOMP_A, key: "angebotsvergleich", name: "Angebotsvergleich", kind: "kompetenz", difficulty: 4 },
    { id: KOMP_B, key: "kalkulation", name: "Kalkulation", kind: "kompetenz" },
    { id: FB, key: "rechenfehler-kalkulation", name: "Typischer Rechenfehler Kalkulation", kind: "fehlerbild", kompetenz_id: KOMP_B },
    { id: RISK, key: "zeitdruck-bei-angebotsvergleich", name: "Zeitdruck im Angebotsvergleich", kind: "risiko", kompetenz_id: KOMP_A, examiner_severity: "warning" },
    { id: ORAL, key: "fachgespraech-einkauf", name: "Fachgespräch Einkaufssituation", kind: "oral_pattern", kompetenz_id: KOMP_A },
    { id: REL, key: "deckungsbeitrag", name: "Deckungsbeitrag", kind: "kompetenz", description: "Beitrag zur Fixkostendeckung." },
  ],
  edges: [
    { from: KOMP_A, to: RISK, kind: "kompetenz_has_risiko", weight: 0.9 },
    { from: KOMP_A, to: ORAL, kind: "kompetenz_has_oral_pattern", weight: 0.7 },
    { from: KOMP_A, to: REL, kind: "related_competency", weight: 0.6 },
    { from: KOMP_B, to: FB, kind: "kompetenz_has_fehlerbild", weight: 0.85 },
    { from: KOMP_B, to: REL, kind: "related_competency", weight: 0.5 },
  ],
};

describe("Cut 3b — recommendForWeaknesses", () => {
  it("is deterministic for repeated calls", () => {
    const a = recommendForWeaknesses(graph, { weak_kompetenz_ids: [KOMP_A, KOMP_B] });
    const b = recommendForWeaknesses(graph, { weak_kompetenz_ids: [KOMP_A, KOMP_B] });
    expect(a.map(r => r.id)).toEqual(b.map(r => r.id));
  });

  it("never recommends a weak competency back to itself", () => {
    const recs = recommendForWeaknesses(graph, { weak_kompetenz_ids: [KOMP_A, KOMP_B] });
    expect(recs.find(r => r.id === `kompetenz:angebotsvergleich`)).toBeUndefined();
    expect(recs.find(r => r.id === `kompetenz:kalkulation`)).toBeUndefined();
  });

  it("attaches direct/adjacent/preventive relation per edge kind", () => {
    const recs = recommendForWeaknesses(graph, { weak_kompetenz_ids: [KOMP_A, KOMP_B] });
    const risk = recs.find(r => r.id === "risiko:zeitdruck-bei-angebotsvergleich");
    expect(risk?.evidence.weakness_relation).toBe("direct");
    const fb = recs.find(r => r.id === "fehlerbild:rechenfehler-kalkulation");
    expect(fb?.evidence.weakness_relation).toBe("direct");
    const rel = recs.find(r => r.id === "kompetenz:deckungsbeitrag");
    expect(rel?.evidence.weakness_relation).toBe("adjacent");
  });

  it("boosts oral patterns when exam_form=muendlich", () => {
    const recs = recommendForWeaknesses(graph, { weak_kompetenz_ids: [KOMP_A], exam_form: "muendlich", limit: 5 });
    expect(recs[0].id).toBe("oral_pattern:fachgespraech-einkauf");
    expect(recs[0].evidence.exam_relevance).toBe("high");
  });

  it("drops preventive recs when exam is imminent (≤14 days)", () => {
    const recs = recommendForWeaknesses(graph, { weak_kompetenz_ids: [KOMP_A, KOMP_B], days_to_exam: 7 });
    expect(recs.every(r => r.evidence.weakness_relation !== "preventive")).toBe(true);
  });

  it("returns empty array when there are no weak competencies", () => {
    expect(recommendForWeaknesses(graph, { weak_kompetenz_ids: [] })).toHaveLength(0);
  });
});

describe("Cut 3b — weakness clusters", () => {
  it("flags difficulty ≥4 as hohe_durchfall_relevanz", () => {
    const tags = classifyWeaknessClusters({ id: "x", key: "x", name: "X", kind: "kompetenz", difficulty: 5 });
    expect(tags).toContain("hohe_durchfall_relevanz");
  });
  it("reads explicit meta cluster flags", () => {
    const tags = classifyWeaknessClusters({
      id: "x", key: "x", name: "X", kind: "kompetenz",
      meta: { cluster_oft_verwechselt_mit: true, cluster_zeitdruck_anfaellig: 1 },
    });
    expect(tags).toEqual(expect.arrayContaining(["oft_verwechselt_mit", "zeitdruck_anfaellig"]));
  });
  it("returns tags in canonical SSOT order", () => {
    const tags = classifyWeaknessClusters({
      id: "x", key: "x", name: "X", kind: "kompetenz",
      meta: {
        cluster_zeitdruck_anfaellig: true,
        cluster_typische_pruefungsfalle: true,
        cluster_oft_verwechselt_mit: true,
      },
    });
    const idx = tags.map(t => WEAKNESS_CLUSTER_TAGS.indexOf(t));
    expect(idx).toEqual([...idx].sort((a, b) => a - b));
  });
});

describe("Cut 3b — decision telemetry buckets", () => {
  it("buckets readiness deterministically", () => {
    expect(readinessBucket(null)).toBe("unknown");
    expect(readinessBucket(10)).toBe("0_20");
    expect(readinessBucket(35)).toBe("20_40");
    expect(readinessBucket(74)).toBe("60_75");
    expect(readinessBucket(75)).toBe("75_90");
    expect(readinessBucket(100)).toBe("90_100");
  });
  it("buckets exam phase by days_to_exam", () => {
    expect(examPhase(null)).toBe("unknown");
    expect(examPhase(-3)).toBe("post");
    expect(examPhase(7)).toBe("imminent");
    expect(examPhase(30)).toBe("endspurt");
    expect(examPhase(80)).toBe("mid");
    expect(examPhase(180)).toBe("early");
  });
  it("buckets session depth", () => {
    expect(sessionDepthBucket(0)).toBe("cold");
    expect(sessionDepthBucket(2)).toBe("light");
    expect(sessionDepthBucket(5)).toBe("active");
    expect(sessionDepthBucket(20)).toBe("deep");
  });
  it("buckets confidence", () => {
    expect(confidenceBucket(0.1)).toBe("low");
    expect(confidenceBucket(0.5)).toBe("medium");
    expect(confidenceBucket(0.9)).toBe("high");
  });
});

describe("Cut 3b — adaptive_cta_decision payload SSOT", () => {
  it("carries every SSOT field and no free text", () => {
    const payload = buildAdaptiveCtaDecisionPayload({
      decision: { variant: "urgency", tone: "sharp", urgency_level: "critical", action_type: "study_plan", message: "x", reason: "exam_imminent" },
      intent: { primary: "letzte_wochen", confidence: 0.8, urgency: "critical", emotional_state: "panisch", recommended_surface: "study_plan", reason: "test" },
      signals: { readiness: { readiness_score: 62, risk_level: "medium", weak_count: 3 }, behaviour: { days_to_exam: 7, sessions_last_7d: 4 } },
      entity_kind: "beruf",
      entity_slug: "industriekaufmann",
      persona: "azubi",
      package_id: null,
      confidence: 0.8,
      phase: "rendered",
    });
    expect(payload.event_type).toBe("adaptive_cta_decision");
    const m = payload.metadata as Record<string, unknown>;
    for (const k of [
      "entity_kind","entity_slug","intent_kind","readiness_bucket","emotional_state",
      "cta_variant","tone","explainable_cta_reason","recommended_action","confidence_bucket",
      "exam_phase","session_depth_bucket","phase","urgency_level",
    ]) {
      expect(m[k], `missing ${k}`).toBeDefined();
    }
    expect(m.exam_phase).toBe("imminent");
    expect(m.session_depth_bucket).toBe("active");
    expect(m.readiness_bucket).toBe("60_75");
    // no message / no headline / no free text fields
    expect("message" in m).toBe(false);
    expect("headline" in m).toBe(false);
  });
});

describe("Cut 3b — recommendation telemetry payload", () => {
  it("clamps similarity to [0,1] and floors overlap", () => {
    const p = __testing.buildRecPayload("recommendation_view", {
      recommendation_id: "r1",
      source_entity_kind: "beruf",
      source_entity_slug: "x",
      recommendation_reason: "kompetenz_has_risiko/direct",
      semantic_similarity_score: 1.7,
      competency_overlap: 3.6,
      exam_relevance: "high",
      weakness_relation: "direct",
    });
    const m = p.metadata as Record<string, unknown>;
    expect(m.semantic_similarity_score).toBe(1);
    expect(m.competency_overlap).toBe(3);
  });
});
