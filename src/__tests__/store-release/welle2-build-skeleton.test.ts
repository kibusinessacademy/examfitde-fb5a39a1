/**
 * Welle 2 — CI Build & Upload Skeleton contract tests.
 *
 * Covers tests 1–20 from the Welle 2 spec.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const r = (p: string) => readFileSync(join(ROOT, p), "utf8");

const ANDROID_WF = ".github/workflows/store-build-android.yml";
const IOS_WF = ".github/workflows/store-build-ios.yml";
const PAGE = "src/pages/admin/StoreReleaseCenterPage.tsx";
const CALLBACK_FN = "supabase/functions/store-release-build-status/index.ts";
const DISPATCH_FN = "supabase/functions/store-release-dispatch-build/index.ts";
const VALIDATOR = "scripts/store-build/validate-mobile-package.mjs";
const BUILD_ANDROID = "scripts/store-build/build-android.mjs";
const BUILD_IOS = "scripts/store-build/build-ios.mjs";

describe("Welle 2 — workflows", () => {
  it("1. Android workflow exists", () => expect(existsSync(join(ROOT, ANDROID_WF))).toBe(true));
  it("2. iOS workflow exists", () => expect(existsSync(join(ROOT, IOS_WF))).toBe(true));
  it("3. both workflows have workflow_dispatch", () => {
    expect(r(ANDROID_WF)).toMatch(/workflow_dispatch:/);
    expect(r(IOS_WF)).toMatch(/workflow_dispatch:/);
  });
  it("4. both have dry_run default true", () => {
    expect(r(ANDROID_WF)).toMatch(/dry_run:[\s\S]*?default:\s*"true"/);
    expect(r(IOS_WF)).toMatch(/dry_run:[\s\S]*?default:\s*"true"/);
  });
  it("5. Android workflow has no production track", () => {
    const s = r(ANDROID_WF);
    expect(s).not.toMatch(/track:\s*production/i);
    expect(s).not.toMatch(/release\s*track.*production/i);
    expect(s).toMatch(/upload-internal|Internal Track/);
  });
  it("6. iOS workflow does not submit to App Review", () => {
    const s = r(IOS_WF);
    expect(s).not.toMatch(/submitForReview/i);
    expect(s).not.toMatch(/appStoreVersionReleaseRequest/i);
    expect(s).toMatch(/TestFlight/i);
  });
  it("7. missing callback secrets → missing_secrets no-op", () => {
    for (const wf of [ANDROID_WF, IOS_WF]) {
      const s = r(wf);
      expect(s).toMatch(/missing_secrets|exiting cleanly/);
      expect(s).toMatch(/skip=true/);
    }
  });
});

describe("Welle 2 — callback function", () => {
  const s = r(CALLBACK_FN);
  it("8. accepts only valid callback secret", () => {
    expect(s).toMatch(/STORE_RELEASE_STATUS_CALLBACK_SECRET/);
    expect(s).toMatch(/x-callback-secret/);
    expect(s).toMatch(/constantEq/);
    expect(s).toMatch(/unauthorized/);
  });
  it("9. blocks unknown platform", () => {
    expect(s).toMatch(/ALLOWED_PLATFORMS/);
    expect(s).toMatch(/invalid platform/);
  });
  it("10. blocks unknown stage", () => {
    expect(s).toMatch(/ALLOWED_STAGES/);
    expect(s).toMatch(/invalid stage/);
  });
  it("11. callback strips/refuses secrets", () => {
    expect(s).toMatch(/stripSecrets/);
    expect(s).toMatch(/FORBIDDEN_META_KEYS/);
  });
});

describe("Welle 2 — dispatch", () => {
  const s = r(DISPATCH_FN);
  it("12. dispatch is admin-only", () => {
    expect(s).toMatch(/assertAdmin/);
  });
  it("13. dispatch writes queued status", () => {
    expect(s).toMatch(/store_release_builds/);
    expect(s).toMatch(/stage:\s*["']queued["']/);
  });
});

describe("Welle 2 — release center UI", () => {
  const s = r(PAGE);
  it("14. no production buttons", () => {
    expect(s).not.toMatch(/production/i);
    expect(s).not.toMatch(/submitForReview/i);
  });
});

describe("Welle 2 — package validator", () => {
  const s = r(VALIDATOR);
  it("15. blocks secrets", () => {
    expect(s).toMatch(/FORBIDDEN_SECRETS/);
    expect(s).toMatch(/service_role/);
  });
  it("16. blocks admin routes", () => {
    expect(s).toMatch(/FORBIDDEN_ADMIN_ROUTES/);
    expect(s).toMatch(/\/admin\//);
  });
  it("17. requires IAP SSOT strings", () => {
    expect(s).toMatch(/REQUIRED_IAP_SSOT/);
    expect(s).toMatch(/validate-iap-receipt/);
    expect(s).toMatch(/check_product_access_by_curriculum/);
  });
});

describe("Welle 2 — build scripts", () => {
  it("18. build-info carries manifest/product/curriculum/course", () => {
    for (const f of [BUILD_ANDROID, BUILD_IOS]) {
      const s = r(f);
      expect(s).toMatch(/manifest_id/);
      expect(s).toMatch(/product_id/);
      expect(s).toMatch(/curriculum_id/);
      expect(s).toMatch(/course_id/);
    }
  });
});

describe("Welle 2 — secret leak guards", () => {
  const clientFiles = [PAGE];
  it("19. client code contains no GitHub token", () => {
    for (const f of clientFiles) {
      const s = r(f);
      expect(s).not.toMatch(/GITHUB_DISPATCH_TOKEN/);
      expect(s).not.toMatch(/ghp_[A-Za-z0-9]/);
    }
  });
  it("20. client code contains no service role key", () => {
    for (const f of clientFiles) {
      const s = r(f);
      expect(s).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY/);
      expect(s).not.toMatch(/service_role/);
    }
  });
});
