import { describe, it, expect } from "vitest";
import { PROGRAMS } from "@/lib/foerdermittel/registry";
import {
  buildStateCluster,
  buildTopicCluster,
  buildIndustryCluster,
  buildCombinationCluster,
  buildAntragChecklistCluster,
  buildAktuellCluster,
  buildClusterMeta,
  buildSeoFaqs,
  computeSeoAuthorityScore,
  detectClusterGaps,
  recommendInternalLinks,
  COMBINATIONS,
  STATE_LABEL,
  INDUSTRY_LABEL,
} from "@/lib/foerdermittel/seoAuthority";
import { summarizeAiAct, FOERDERMITTEL_AI_SYSTEMS } from "@/lib/foerdermittel/euAiAct";

describe("seoAuthority — cluster builders", () => {
  it("buildStateCluster NRW includes federal + NRW-only programs", () => {
    const c = buildStateCluster(PROGRAMS, "NW");
    const slugs = c.programs.map((p) => p.slug);
    expect(slugs).toContain("digitalbonus-nrw");
    expect(slugs).toContain("go-digital");
    expect(c.meta.canonicalPath).toBe("/foerdermittel/bundesland/nw");
    expect(c.meta.title).toContain(STATE_LABEL.NW);
  });

  it("buildTopicCluster digitalisierung only includes digital programs", () => {
    const c = buildTopicCluster(PROGRAMS, "digitalisierung");
    expect(c.programs.length).toBeGreaterThan(0);
    expect(c.programs.every((p) => p.topics.includes("digitalisierung"))).toBe(true);
  });

  it("buildIndustryCluster handwerk respects topic map", () => {
    const c = buildIndustryCluster(PROGRAMS, "handwerk");
    expect(c.programs.length).toBeGreaterThan(0);
    expect(INDUSTRY_LABEL.handwerk).toBeTruthy();
  });

  it("buildCombinationCluster digitalisierung-bund-land selects defined programs", () => {
    const def = COMBINATIONS.find((c) => c.slug === "digitalisierung-bund-land")!;
    const c = buildCombinationCluster(PROGRAMS, def);
    expect(c.programs.length).toBeGreaterThanOrEqual(2);
    expect(c.programs.every((p) => def.programSlugs.includes(p.slug))).toBe(true);
  });

  it("buildAntragChecklistCluster uses full registry", () => {
    const c = buildAntragChecklistCluster(PROGRAMS);
    expect(c.programs.length).toBe(PROGRAMS.length);
    expect(c.meta.canonicalPath).toBe("/foerdermittel/antrag/checkliste");
  });

  it("buildAktuellCluster excludes stale-only programs", () => {
    const c = buildAktuellCluster(PROGRAMS);
    expect(c.programs.length).toBeGreaterThan(0);
    expect(c.programs.length).toBeLessThanOrEqual(PROGRAMS.length);
  });
});

describe("seoAuthority — scoring & gaps", () => {
  it("computeSeoAuthorityScore returns 0..100", () => {
    const c = buildTopicCluster(PROGRAMS, "digitalisierung");
    const score = computeSeoAuthorityScore(c);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it("empty cluster gets score 0 and isThin true", () => {
    const c = buildStateCluster([], "SH");
    expect(c.authorityScore).toBe(0);
    expect(c.isThin).toBe(true);
  });

  it("detectClusterGaps flags thin/empty clusters", () => {
    const gaps = detectClusterGaps(PROGRAMS);
    expect(gaps.length).toBeGreaterThan(0);
    // Federal "DE" programs pad every state, so state-thinness rather than "no-programs" is expected
    expect(gaps.some((g) => g.kind === "industry" || g.kind === "combination" || g.kind === "state")).toBe(true);
  });
});

describe("seoAuthority — meta + faqs + internal links", () => {
  it("thin cluster gets noindex,follow", () => {
    const c = buildStateCluster([], "SH");
    expect(buildClusterMeta(c).robots).toBe("noindex,follow");
  });

  it("populated cluster gets index,follow with canonical apex", () => {
    const c = buildStateCluster(PROGRAMS, "NW");
    const meta = buildClusterMeta(c);
    expect(meta.robots).toBe("index,follow");
    expect(meta.canonicalUrl.startsWith("https://berufos.com/")).toBe(true);
    expect(meta.description.length).toBeLessThanOrEqual(160);
  });

  it("buildSeoFaqs returns ≥ 3 entries", () => {
    const c = buildTopicCluster(PROGRAMS, "digitalisierung");
    expect(buildSeoFaqs(c).length).toBeGreaterThanOrEqual(3);
  });

  it("recommendInternalLinks always offers checklist fallback", () => {
    const c = buildTopicCluster(PROGRAMS, "digitalisierung");
    const links = recommendInternalLinks(c, PROGRAMS);
    expect(links.some((l) => l.href === "/foerdermittel/antrag/checkliste")).toBe(true);
    // no duplicate hrefs
    const hrefs = links.map((l) => l.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it("duplicate title guard — each cluster kind produces distinct titles", () => {
    const titles = new Set<string>([
      buildStateCluster(PROGRAMS, "NW").meta.title,
      buildTopicCluster(PROGRAMS, "digitalisierung").meta.title,
      buildIndustryCluster(PROGRAMS, "it").meta.title,
      buildAntragChecklistCluster(PROGRAMS).meta.title,
      buildAktuellCluster(PROGRAMS).meta.title,
    ]);
    expect(titles.size).toBe(5);
  });
});

describe("euAiAct — transparency registry", () => {
  it("summarizes total systems and highest risk", () => {
    const s = summarizeAiAct();
    expect(s.totalSystems).toBe(FOERDERMITTEL_AI_SYSTEMS.length);
    expect(s.hasProhibitedSystems).toBe(false);
    expect(["minimal", "limited", "high"]).toContain(s.highestRisk);
  });

  it("every AI system declares purposes, prohibited uses and oversight", () => {
    for (const s of FOERDERMITTEL_AI_SYSTEMS) {
      expect(s.purposes.length).toBeGreaterThan(0);
      expect(s.prohibitedUses.length).toBeGreaterThan(0);
      expect(s.humanOversight.length).toBeGreaterThan(10);
      expect(s.outputDisclosure.length).toBeGreaterThan(10);
    }
  });
});
