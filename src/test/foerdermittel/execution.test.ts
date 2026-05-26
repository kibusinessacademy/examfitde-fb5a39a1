// FördermittelOS Cut 3 — Execution OS deterministic tests.
import { describe, it, expect } from "vitest";
import {
  buildApplicationChecklist,
  buildApplicationTimeline,
  buildBridgeEvents,
  buildDocumentChecklist,
  buildNextBestActions,
  classifyMissingDocuments,
  computeApplicationReadiness,
  rankApplicationRisks,
  toDocKey,
} from "@/lib/foerdermittel/execution";
import type { Program } from "@/lib/foerdermittel/types";
import { PROGRAMS, getProgramBySlug } from "@/lib/foerdermittel/registry";

const sample: Program =
  getProgramBySlug("go-digital") ??
  (PROGRAMS[0] as Program);

describe("Cut 3 — Document Check", () => {
  it("flags critical documents when missing", () => {
    const checklist = buildDocumentChecklist(sample);
    const critical = checklist.filter((d) => d.critical);
    expect(critical.length).toBeGreaterThan(0);
    expect(critical.every((d) => d.status === "critical")).toBe(true);
  });

  it("marks present documents", () => {
    const keys = new Set([toDocKey(sample.documentsNeeded[0])]);
    const { present, missingCritical } = classifyMissingDocuments(sample, keys);
    expect(present.length).toBe(1);
    expect(present[0].status).toBe("present");
    expect(missingCritical.find((d) => d.key === present[0].key)).toBeUndefined();
  });

  it("toDocKey is stable and slug-safe", () => {
    expect(toDocKey("KMU-Erklärung")).toBe("kmu-erklarung");
    expect(toDocKey("Angebot Berater")).toBe("angebot-berater");
  });
});

describe("Cut 3 — Application Readiness", () => {
  it("returns 'blocked' when no docs and no requirements met", () => {
    const r = computeApplicationReadiness(sample, undefined, new Set(), new Set());
    expect(r.score).toBeLessThan(50);
    expect(["blocked", "gaps"]).toContain(r.verdict);
  });

  it("returns 'ready' when all docs+requirements satisfied", () => {
    const docKeys = new Set(sample.documentsNeeded.map(toDocKey));
    const reqKeys = new Set(sample.requirements.map((r) => r.key));
    const r = computeApplicationReadiness(sample, undefined, docKeys, reqKeys);
    expect(r.score).toBeGreaterThanOrEqual(85);
    expect(r.verdict).toBe("ready");
    expect(r.missingCriticalDocs).toBe(0);
    expect(r.unmetHardRequirements).toBe(0);
  });

  it("breakdown is bounded 0..100", () => {
    const r = computeApplicationReadiness(sample);
    for (const v of Object.values(r.breakdown)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
  });
});

describe("Cut 3 — Checklist", () => {
  it("combines requirements + documents", () => {
    const items = buildApplicationChecklist(sample);
    expect(items.some((i) => i.group === "requirement")).toBe(true);
    expect(items.some((i) => i.group === "document")).toBe(true);
    expect(items.length).toBe(sample.requirements.length + sample.documentsNeeded.length);
  });
});

describe("Cut 3 — Risk Ranking", () => {
  it("surfaces hard-requirement + critical-doc risks when nothing satisfied", () => {
    const risks = rankApplicationRisks(sample);
    const keys = risks.map((r) => r.key);
    expect(keys).toContain("hard-requirements");
    expect(keys).toContain("critical-documents");
  });

  it("orders high severity first", () => {
    const risks = rankApplicationRisks(sample);
    const weights = risks.map((r) => (r.severity === "high" ? 3 : r.severity === "medium" ? 2 : 1));
    for (let i = 1; i < weights.length; i++) {
      expect(weights[i - 1]).toBeGreaterThanOrEqual(weights[i]);
    }
  });

  it("clears document risk when present", () => {
    const docKeys = new Set(sample.documentsNeeded.map(toDocKey));
    const reqKeys = new Set(sample.requirements.map((r) => r.key));
    const risks = rankApplicationRisks(sample, undefined, docKeys, reqKeys);
    expect(risks.find((r) => r.key === "critical-documents")).toBeUndefined();
    expect(risks.find((r) => r.key === "hard-requirements")).toBeUndefined();
  });
});

describe("Cut 3 — Next Best Actions", () => {
  it("emits 'now'-priority items when readiness is low", () => {
    const r = computeApplicationReadiness(sample);
    const actions = buildNextBestActions(sample, r);
    expect(actions.length).toBeGreaterThan(0);
    expect(actions.some((a) => a.priority === "now")).toBe(true);
  });

  it("attaches bridge events to actionable items", () => {
    const r = computeApplicationReadiness(sample);
    const actions = buildNextBestActions(sample, r);
    const withBridge = actions.filter((a) => a.bridge);
    expect(withBridge.length).toBeGreaterThan(0);
    const bridgeOSes = new Set(withBridge.map((a) => a.bridge!.os));
    // At least one of the documented bridge targets is present
    expect(
      ["FristenOS", "VertragscheckerOS", "AngebotsvergleichOS", "ComplianceOS", "WissensOS"].some(
        (os) => bridgeOSes.has(os as never),
      ),
    ).toBe(true);
  });
});

describe("Cut 3 — Timeline", () => {
  it("returns 8 canonical phases", () => {
    const t = buildApplicationTimeline(sample);
    expect(t.map((s) => s.key)).toEqual([
      "pruefung",
      "unterlagen",
      "projektbeschreibung",
      "kostenplan",
      "antrag",
      "rueckfragen",
      "bewilligung",
      "nachweise",
    ]);
    expect(t.every((s) => s.estimateWeeks > 0)).toBe(true);
  });
});

describe("Cut 3 — Bridge Events", () => {
  it("emits structured cross-OS events", () => {
    const r = computeApplicationReadiness(sample);
    const evts = buildBridgeEvents(sample, r);
    expect(evts.length).toBeGreaterThan(0);
    for (const e of evts) {
      expect(typeof e.os).toBe("string");
      expect(typeof e.intent).toBe("string");
      expect(typeof e.payload).toBe("object");
    }
  });
});

describe("Cut 1/2 Regression — still importable", () => {
  it("registry + freshness still resolve", async () => {
    expect(PROGRAMS.length).toBeGreaterThan(0);
    const { classifyFreshness } = await import("@/lib/foerdermittel/freshness");
    expect(["fresh", "watch", "stale", "unknown"]).toContain(classifyFreshness(sample));
  });
});
