import { describe, it, expect } from "vitest";
import { isCoverageEligible, QC_COVERAGE_ELIGIBLE, QC_TERMINAL_REJECTED } from "./qcStatus";

describe("QC Status SSOT", () => {
  describe("QC_COVERAGE_ELIGIBLE", () => {
    it("includes approved and tier1_passed", () => {
      expect(QC_COVERAGE_ELIGIBLE).toContain("approved");
      expect(QC_COVERAGE_ELIGIBLE).toContain("tier1_passed");
    });

    it("does NOT include draft, pending, rejected", () => {
      expect(QC_COVERAGE_ELIGIBLE).not.toContain("draft");
      expect(QC_COVERAGE_ELIGIBLE).not.toContain("pending");
      expect(QC_COVERAGE_ELIGIBLE).not.toContain("rejected");
    });
  });

  describe("isCoverageEligible", () => {
    it("returns true for approved", () => {
      expect(isCoverageEligible("approved")).toBe(true);
    });

    it("returns true for tier1_passed (regression: was false-negative root cause)", () => {
      expect(isCoverageEligible("tier1_passed")).toBe(true);
    });

    it("returns true for null qc_status with status=approved (legacy fallback)", () => {
      expect(isCoverageEligible(null, "approved")).toBe(true);
    });

    it("returns false for tier1_failed", () => {
      expect(isCoverageEligible("tier1_failed")).toBe(false);
    });

    it("returns false for needs_revision", () => {
      expect(isCoverageEligible("needs_revision")).toBe(false);
    });

    it("returns false for rejected", () => {
      expect(isCoverageEligible("rejected")).toBe(false);
    });

    it("returns false for null qc_status with status=draft", () => {
      expect(isCoverageEligible(null, "draft")).toBe(false);
    });
  });

  describe("QC_TERMINAL_REJECTED", () => {
    it("includes rejected and pruned_quality", () => {
      expect(QC_TERMINAL_REJECTED).toContain("rejected");
      expect(QC_TERMINAL_REJECTED).toContain("pruned_quality");
    });
  });
});
