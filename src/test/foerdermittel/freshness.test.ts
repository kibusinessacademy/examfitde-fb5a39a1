import { describe, expect, it } from "vitest";
import {
  classifyFreshness,
  classifyChangeRisk,
  needsReview,
  rankProgramsByReviewUrgency,
  summarizeProgramFreshness,
} from "@/lib/foerdermittel/freshness";
import { scoreMatch } from "@/lib/foerdermittel/matching";
import { PROGRAMS } from "@/lib/foerdermittel/registry";
import type { CompanyProfile, Program } from "@/lib/foerdermittel/types";

const NOW = new Date("2026-06-01T00:00:00.000Z");

function mk(overrides: Partial<Program> = {}): Program {
  return {
    id: "t",
    slug: "t",
    name: "Test",
    shortDescription: "",
    authority: "BMWK",
    region: "DE",
    topics: ["digitalisierung"],
    kind: "zuschuss",
    status: "active",
    funding: {},
    eligibleCompanySizes: ["small"],
    requirements: [],
    documentsNeeded: [],
    sources: [],
    ...overrides,
  };
}

describe("freshness.classifyFreshness", () => {
  it("returns unknown when no metadata", () => {
    expect(classifyFreshness(mk(), NOW)).toBe("unknown");
  });
  it("returns fresh for recent verification within cadence", () => {
    const p = mk({ freshness: { lastVerifiedAt: "2026-05-20", updateCadence: "quarterly", nextReviewAt: "2026-08-01" } });
    expect(classifyFreshness(p, NOW)).toBe("fresh");
  });
  it("returns stale when verification older than stale-window", () => {
    const p = mk({ freshness: { lastVerifiedAt: "2024-01-01", updateCadence: "quarterly" } });
    expect(classifyFreshness(p, NOW)).toBe("stale");
  });
  it("returns watch when between fresh and stale", () => {
    const p = mk({ freshness: { lastVerifiedAt: "2026-01-01", updateCadence: "quarterly", nextReviewAt: "2026-09-01" } });
    expect(classifyFreshness(p, NOW)).toBe("watch");
  });
  it("returns stale when next review overdue >30d even if recent", () => {
    const p = mk({ freshness: { lastVerifiedAt: "2026-05-30", updateCadence: "quarterly", nextReviewAt: "2026-04-01" } });
    expect(classifyFreshness(p, NOW)).toBe("stale");
  });
});

describe("freshness.classifyChangeRisk", () => {
  it("marks paused + high tension as high risk", () => {
    expect(classifyChangeRisk(mk({ status: "paused", budgetTensionPct: 95 }), NOW)).toBe("high");
  });
  it("marks stable federal active program as low risk", () => {
    expect(
      classifyChangeRisk(mk({ status: "active", region: "DE", freshness: { updateCadence: "yearly" } }), NOW),
    ).toBe("low");
  });
  it("marks regional state programs at least medium", () => {
    const r = classifyChangeRisk(mk({ region: "NW", freshness: { updateCadence: "monthly" } }), NOW);
    expect(["medium", "high"]).toContain(r);
  });
});

describe("freshness.needsReview", () => {
  it("true for stale", () => {
    expect(needsReview(mk({ freshness: { lastVerifiedAt: "2023-01-01" } }), NOW)).toBe(true);
  });
  it("false for fresh with future next-review", () => {
    expect(needsReview(mk({ freshness: { lastVerifiedAt: "2026-05-25", nextReviewAt: "2026-09-01" } }), NOW)).toBe(false);
  });
});

describe("freshness.rankProgramsByReviewUrgency", () => {
  it("ranks stale/high-risk above fresh/low", () => {
    const a = mk({ id: "a", slug: "a", status: "paused", budgetTensionPct: 95, freshness: { lastVerifiedAt: "2024-01-01" } });
    const b = mk({ id: "b", slug: "b", freshness: { lastVerifiedAt: "2026-05-25", nextReviewAt: "2026-09-01" } });
    const ranked = rankProgramsByReviewUrgency([b, a], NOW);
    expect(ranked[0].program.id).toBe("a");
    expect(ranked[0].urgency).toBeGreaterThan(ranked[1].urgency);
  });
});

describe("freshness.summarizeProgramFreshness on seed registry", () => {
  it("covers all programs and produces consistent totals", () => {
    const s = summarizeProgramFreshness(PROGRAMS);
    expect(s.total).toBe(PROGRAMS.length);
    expect(s.fresh + s.watch + s.stale + s.unknown).toBe(s.total);
    expect(s.needsReview).toBeGreaterThanOrEqual(s.stale + s.unknown);
  });
});

describe("matching applies freshness-aware penalty without disqualifying", () => {
  const profile: CompanyProfile = { region: "DE", size: "small", topics: ["digitalisierung"] };
  it("stale freshness reduces fit and adds warning", () => {
    const stale = mk({ freshness: { lastVerifiedAt: "2023-01-01", updateCadence: "quarterly" } });
    const fresh = mk({ freshness: { lastVerifiedAt: "2026-05-25", updateCadence: "quarterly", nextReviewAt: "2026-09-01" } });
    const ms = scoreMatch(profile, stale);
    const mf = scoreMatch(profile, fresh);
    expect(ms.fit).toBeLessThan(mf.fit);
    expect(ms.warnings.some((w) => w.toLowerCase().includes("aktualität"))).toBe(true);
    expect(ms.disqualifiers).toHaveLength(0);
  });
  it("unknown freshness adds prüfen warning", () => {
    const m = scoreMatch(profile, mk());
    expect(m.warnings.some((w) => w.toLowerCase().includes("aktualität"))).toBe(true);
  });
});
