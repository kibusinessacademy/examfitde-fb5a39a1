/**
 * IAP SSOT Contract — Phase B.1 Regression Suite
 *
 * Static-scan tests that lock in the IAP single-source-of-truth:
 *   validate-iap-receipt → verify-(ios|android) → store_receipts
 *     → create_store_entitlement → entitlements
 *     → check_product_access_by_curriculum → useProductAccessByCurriculum
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "..", "..", "..");

const read = (p: string) => readFileSync(resolve(root, p), "utf8");

describe("IAP SSOT contract — Phase B.1", () => {
  it("validate-iap-receipt dispatches ONLY to verify-ios-receipt or verify-android-purchase", () => {
    const src = read("supabase/functions/validate-iap-receipt/index.ts");
    expect(src).toMatch(/verify-ios-receipt/);
    expect(src).toMatch(/verify-android-purchase/);

    // Forbidden: alternate dispatch targets.
    const forbiddenTargets = [
      "verify-iap-",
      "grant-mobile-",
      "unlock-course-",
      "mobile-entitlement-",
    ];
    for (const needle of forbiddenTargets) {
      expect(src, `dispatcher must not reference ${needle}`).not.toMatch(
        new RegExp(needle, "i"),
      );
    }
  });

  it("verify-ios-receipt writes entitlements only via create_store_entitlement RPC", () => {
    const src = read("supabase/functions/verify-ios-receipt/index.ts");
    expect(src).toMatch(/create_store_entitlement/);
    // No direct INSERT into entitlements.
    expect(src).not.toMatch(/\.from\(\s*['"]entitlements['"]\s*\)\s*\n?\s*\.insert/);
  });

  it("verify-android-purchase writes entitlements only via create_store_entitlement RPC", () => {
    const src = read("supabase/functions/verify-android-purchase/index.ts");
    expect(src).toMatch(/create_store_entitlement/);
    expect(src).not.toMatch(/\.from\(\s*['"]entitlements['"]\s*\)\s*\n?\s*\.insert/);
  });

  it("useIAPReceiptValidation invalidates all required SSOT cache keys", () => {
    const src = read("src/hooks/useIAPReceiptValidation.ts");
    for (const key of [
      "product-access",
      "product-access-curriculum",
      "entitlements",
      "course-access",
      "learner-course-grants",
    ]) {
      expect(src, `must invalidate ${key}`).toContain(key);
    }
  });

  it("useIAPReceiptValidation does not maintain a local mobile access state", () => {
    const src = read("src/hooks/useIAPReceiptValidation.ts");
    expect(src).not.toMatch(/localStorage|sessionStorage/);
    expect(src).not.toMatch(/mobile_access|course_unlocked|iap_entitlement/);
  });
});
