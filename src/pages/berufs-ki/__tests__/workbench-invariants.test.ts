/**
 * Berufs-KI Invariants — Filter, Copy, Tier-Mapping.
 */
import { describe, it, expect } from "vitest";
import { filterWorkflows, matchesQuery } from "@/pages/berufs-ki/BerufsKIWorkbenchPage";
import { BERUFS_KI, CATEGORY_LABEL, tierLabel } from "@/lib/berufs-ki/copy";
import type { WorkflowDefinition } from "@/lib/berufs-ki/types";

const wf = (over: Partial<WorkflowDefinition> = {}): WorkflowDefinition => ({
  id: over.id ?? "id-" + (over.slug ?? "x"),
  slug: over.slug ?? "demo",
  title: over.title ?? "Kundenmail erstellen",
  description: over.description ?? "Strukturierte Antwort an Kunden.",
  category: over.category ?? "kommunikation",
  subcategory: null,
  curriculum_id: null,
  learning_field_id: null,
  competency_id: null,
  blueprint_id: null,
  competency_ids: [],
  target_roles: ["fachkraft"],
  tier_required: over.tier_required ?? "free",
  input_schema: { fields: [] },
  output_schema: { sections: [] },
  model_recommendation: "google/gemini-2.5-pro",
  compliance_level: "standard",
  risk_level: "low",
  is_active: true,
  version: 1,
  workflow_class: over.workflow_class,
  ...over,
});

describe("Berufs-KI · Copy invariants", () => {
  it("hat alle Kategorie-Labels", () => {
    for (const k of ["kommunikation","analyse","dokumentation","organisation","fach","lernhilfe"] as const) {
      expect(CATEGORY_LABEL[k]).toBeTruthy();
    }
  });
  it("Tier-Labels nicht leer", () => {
    expect(tierLabel("free")).toBe(BERUFS_KI.tier.free.label);
    expect(tierLabel("pro")).toBe(BERUFS_KI.tier.pro.label);
    expect(tierLabel("business")).toBe(BERUFS_KI.tier.business.label);
  });
});

describe("Berufs-KI · matchesQuery", () => {
  it("matched bei leerem Query immer", () => {
    expect(matchesQuery(wf(), "")).toBe(true);
    expect(matchesQuery(wf(), "   ")).toBe(true);
  });
  it("matched case-insensitive auf Title", () => {
    expect(matchesQuery(wf({ title: "KPI Auswertung" }), "kpi")).toBe(true);
  });
  it("matched auf Kategorie-Label", () => {
    expect(matchesQuery(wf({ category: "kommunikation" }), "Kommun")).toBe(true);
  });
  it("filtert non-matches raus", () => {
    expect(matchesQuery(wf({ title: "ABC" }), "xyz")).toBe(false);
  });
});

describe("Berufs-KI · filterWorkflows (Governance/Tier)", () => {
  const rows = [
    wf({ slug: "a", category: "kommunikation", tier_required: "free", workflow_class: "official" }),
    wf({ slug: "b", category: "analyse", tier_required: "pro", workflow_class: "blueprint_materialized" }),
    wf({ slug: "c", category: "fach", tier_required: "business", workflow_class: "experimental" }),
  ];
  it("Kategorie-Filter isoliert", () => {
    expect(filterWorkflows(rows, { category: "analyse", tier: null, klass: null, query: "" }).map((r) => r.slug)).toEqual(["b"]);
  });
  it("Tier-Filter isoliert", () => {
    expect(filterWorkflows(rows, { category: null, tier: "business", klass: null, query: "" }).map((r) => r.slug)).toEqual(["c"]);
  });
  it("Klass-Filter isoliert", () => {
    expect(filterWorkflows(rows, { category: null, tier: null, klass: "blueprint_materialized", query: "" }).map((r) => r.slug)).toEqual(["b"]);
  });
  it("kombiniert alle Filter konjunktiv", () => {
    expect(filterWorkflows(rows, { category: "analyse", tier: "pro", klass: "blueprint_materialized", query: "" }).map((r) => r.slug)).toEqual(["b"]);
    expect(filterWorkflows(rows, { category: "analyse", tier: "business", klass: null, query: "" })).toHaveLength(0);
  });
  it("undefined workflow_class wird als 'official' behandelt", () => {
    const r = [wf({ slug: "x", workflow_class: undefined })];
    expect(filterWorkflows(r, { category: null, tier: null, klass: "official", query: "" })).toHaveLength(1);
  });
});
