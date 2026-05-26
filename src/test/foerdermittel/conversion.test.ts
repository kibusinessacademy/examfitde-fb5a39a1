import { describe, it, expect } from "vitest";
import {
  buildConsentCopy,
  buildCrossOsUpsellRecommendations,
  buildFundingReportSummary,
  buildLeadMagnetOffer,
  buildReportKey,
  buildReportPath,
  classifyConversionIntent,
  computeLeadQualityScore,
  isBusinessEmail,
  sanitizeLeadPayload,
} from "@/lib/foerdermittel/conversion";
import { PROGRAMS } from "@/lib/foerdermittel/registry";
import { matchPrograms } from "@/lib/foerdermittel/matching";
import type { CompanyProfile, ProgramMatch } from "@/lib/foerdermittel/types";

const profile: CompanyProfile = {
  region: "NW",
  size: "small",
  industry: "IT",
  topics: ["digitalisierung", "ki"],
};

const matches: ProgramMatch[] = matchPrograms(profile).slice(0, 3);

describe("FördermittelOS Cut 6 — conversion SSOT", () => {
  describe("lead magnet offer", () => {
    it("empty state offers free check", () => {
      const o = buildLeadMagnetOffer({ hasMatches: false, topCount: 0, staleCount: 0, source: "hub" });
      expect(o.ctaLabel).toMatch(/Report/i);
      expect(o.bullets.length).toBeGreaterThanOrEqual(3);
    });
    it("urgent state mentions stale risks in headline", () => {
      const o = buildLeadMagnetOffer({ hasMatches: true, topCount: 5, staleCount: 2, source: "program_detail" });
      expect(o.headline).toMatch(/Aktualitätsrisiko|Aktualität/);
    });
  });

  describe("lead quality score", () => {
    it("returns 0..100 and tier", () => {
      const q = computeLeadQualityScore(matches, profile, "program_detail");
      expect(q.score).toBeGreaterThanOrEqual(0);
      expect(q.score).toBeLessThanOrEqual(100);
      expect(["cold", "warm", "hot"]).toContain(q.tier);
    });
    it("hub source + empty profile scores lower than program_detail + full profile", () => {
      const low = computeLeadQualityScore([], {}, "hub");
      const high = computeLeadQualityScore(matches, profile, "program_detail");
      expect(high.score).toBeGreaterThan(low.score);
    });
  });

  describe("conversion intent classification", () => {
    it.each([
      ["funding_check_started", "funding_check_started"],
      ["matching_completed", "funding_check_completed"],
      ["report_requested", "report_requested"],
      ["report_downloaded", "report_downloaded"],
      ["copilot_action_clicked", "copilot_action_clicked"],
      ["application_roadmap_opened", "application_roadmap_opened"],
      ["cross_os_upsell_clicked", "cross_os_upsell_clicked"],
      ["totally_random_event_xyz", "unknown"],
    ])("classifies %s", (name, expected) => {
      expect(classifyConversionIntent({ name })).toBe(expected);
    });
  });

  describe("funding report summary", () => {
    const report = buildFundingReportSummary({
      matchResults: matches,
      profile,
      reportKey: buildReportKey("test-seed"),
      now: new Date("2026-06-01T10:00:00Z"),
    });

    it("includes top matches and ISO generated date", () => {
      expect(report.topMatches.length).toBeLessThanOrEqual(5);
      expect(report.generatedAtIso).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
    it("includes cross-os recommendations and at least WissensOS", () => {
      const oses = report.crossOsRecommendations.map((r) => r.os);
      expect(oses).toContain("WissensOS");
      expect(report.crossOsRecommendations.length).toBeGreaterThan(0);
    });
    it("warnings non-empty when no matches", () => {
      const empty = buildFundingReportSummary({
        matchResults: [],
        reportKey: buildReportKey("empty"),
      });
      expect(empty.warnings.length).toBeGreaterThan(0);
    });
  });

  describe("cross-os upsell", () => {
    it("always recommends WissensOS", () => {
      const recs = buildCrossOsUpsellRecommendations({ topMatches: [], freshnessRisks: [] });
      expect(recs.find((r) => r.os === "WissensOS")).toBeDefined();
    });
    it("adds ComplianceOS as 'now' when blocked", () => {
      const recs = buildCrossOsUpsellRecommendations({
        topMatches: [],
        freshnessRisks: [{ slug: "x", reason: "y" }],
        readinessVerdict: "blocked",
      });
      expect(recs.find((r) => r.os === "ComplianceOS")?.priority).toBe("now");
    });
  });

  describe("consent copy", () => {
    it("contains DSGVO art. 6 reference", () => {
      const c = buildConsentCopy("hub");
      expect(c.privacyLine).toMatch(/Art\. 6/);
      expect(c.checkboxLabel.length).toBeGreaterThan(20);
    });
  });

  describe("payload sanitization", () => {
    it("rejects invalid email", () => {
      const r = sanitizeLeadPayload({ email: "not-an-email", consentMarketing: true, source: "hub", requestId: "x" });
      expect(r.ok).toBe(false);
      expect(r.errors).toContain("invalid_email");
    });
    it("requires consent", () => {
      const r = sanitizeLeadPayload({ email: "a@firma.de", consentMarketing: false, source: "hub", requestId: "x" });
      expect(r.errors).toContain("consent_required");
    });
    it("strips phone-like fields from companyName", () => {
      const r = sanitizeLeadPayload({
        email: "a@firma.de", consentMarketing: true, source: "hub", requestId: "x",
        companyName: "Acme +49 30 1234567",
      });
      expect(r.ok).toBe(true);
      expect(r.cleaned?.companyName).toBeUndefined();
    });
    it("warns on non-business email", () => {
      const r = sanitizeLeadPayload({ email: "a@gmail.com", consentMarketing: true, source: "hub", requestId: "x" });
      expect(r.ok).toBe(true);
      expect(r.warnings).toContain("non_business_email");
    });
    it("isBusinessEmail recognizes domain", () => {
      expect(isBusinessEmail("foo@firma.de")).toBe(true);
      expect(isBusinessEmail("foo@gmail.com")).toBe(false);
    });
  });

  describe("report path / URL safety", () => {
    it("buildReportKey is opaque (no PII shape)", () => {
      const k = buildReportKey("max.mustermann@firma.de|hub|req_abc");
      expect(k).toMatch(/^r_[a-z0-9_]+$/);
      expect(k).not.toContain("@");
      expect(k).not.toContain("firma");
      expect(k).not.toContain("mustermann");
    });
    it("buildReportPath rejects invalid keys", () => {
      expect(() => buildReportPath("invalid@key")).toThrow();
      expect(buildReportPath("r_abc_def123")).toBe("/foerdermittel/report/r_abc_def123");
    });
    it("report key never contains the email", () => {
      const email = "alice.smith@acme-corp.com";
      const k = buildReportKey(`${email}|hub|req_1`);
      expect(k.toLowerCase()).not.toContain("alice");
      expect(k.toLowerCase()).not.toContain("acme");
    });
  });

  describe("regression — Cut 1–5 still importable", () => {
    it("PROGRAMS registry intact", () => {
      expect(PROGRAMS.length).toBeGreaterThan(0);
    });
    it("matchPrograms still works", () => {
      expect(matches.length).toBeGreaterThan(0);
    });
  });
});
