import { describe, expect, it } from "vitest";
import {
  COMMERCE_GAP_CODES,
  COMMERCE_HEAL_MATRIX,
  getCommerceHealRule,
  type CommerceGapCode,
} from "../commerceHealMatrix";

describe("commerceHealMatrix — Stage A SSOT", () => {
  it("covers every gap_code exactly once", () => {
    const matrixKeys = Object.keys(COMMERCE_HEAL_MATRIX).sort();
    const codeList = [...COMMERCE_GAP_CODES].sort();
    expect(matrixKeys).toEqual(codeList);
  });

  it("each rule has consistent self-reference and required fields", () => {
    for (const code of COMMERCE_GAP_CODES) {
      const r = COMMERCE_HEAL_MATRIX[code];
      expect(r.gapCode).toBe(code);
      expect(r.cooldownHours).toBeGreaterThanOrEqual(0);
      expect([1, 2, 3]).toContain(r.severityHint);
      expect(r.description.length).toBeGreaterThan(20);
      // auto_enqueue MUSS einen jobType haben; alle anderen Modi nicht.
      if (r.mode === "auto_enqueue") {
        expect(r.jobType, `${code} auto_enqueue requires jobType`).toBeTruthy();
      } else {
        // smoke_rerun/audit_only/manual_review dürfen jobType=null haben
        expect(r.jobType === null || typeof r.jobType === "string").toBe(true);
      }
    }
  });

  it("revenue-blocking gaps are marked severity 3", () => {
    expect(COMMERCE_HEAL_MATRIX.MISSING_PRICE.severityHint).toBe(3);
    expect(COMMERCE_HEAL_MATRIX.CHECKOUT_FAIL.severityHint).toBe(3);
  });

  it("getCommerceHealRule throws on unknown code", () => {
    expect(() => getCommerceHealRule("UNKNOWN" as CommerceGapCode)).toThrow();
  });
});
