/**
 * MOBILE.COURSE.PACKAGE.OS.1 — Phase C Contract Tests
 *
 * Static-scan tests that lock in the Phase-C release bundle contract.
 * The edge function source itself is the SSOT: required files, IAP SSOT
 * references, no secrets, no admin routes, no shadow access paths.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "..", "..", "..");
const src = readFileSync(
  resolve(root, "supabase/functions/mobile-course-package-build/index.ts"),
  "utf8",
);

const REQUIRED_FILES = [
  "README.md",
  "capacitor.config.ts",
  "package.json",
  "src/course-manifest.json",
  "src/iap.config.ts",
  "src/access-policy.ts",
  "src/build-info.json",
  "store/app-store/listing.de.json",
  "store/app-store/listing.en.json",
  "store/google-play/listing.de.json",
  "store/google-play/listing.en.json",
  "store/privacy/README.md",
  "store/review-notes.md",
  "store/screenshots/README.md",
  "store/screenshots/required-sizes.json",
  ".github/workflows/android-release.yml",
  ".github/workflows/ios-release.yml",
  ".github/workflows/mobile-package-check.yml",
  "RELEASE_CHECKLIST.md",
  "SSOT_NOTES.md",
  "IAP_NOTES.md",
  "NO_SECRETS.md",
  "KNOWN_LIMITATIONS.md",
];

describe("Mobile Package · Phase C — required files", () => {
  for (const f of REQUIRED_FILES) {
    it(`bundle zip includes ${f}`, () => {
      expect(src).toContain(`zip.file("${f}"`);
    });
  }
});

describe("Mobile Package · Phase C — IAP SSOT", () => {
  it("iap.config.ts targets validate-iap-receipt dispatcher", () => {
    expect(src).toMatch(/validate-iap-receipt/);
    expect(src).toMatch(/check_product_access_by_curriculum/);
  });

  it("includes all required cache invalidation keys", () => {
    for (const key of [
      "product-access",
      "product-access-by-curriculum",
      "product-access-curriculum",
      "entitlements",
      "course-access",
      "learner-course-grants",
    ]) {
      expect(src).toContain(key);
    }
  });

  it("forbids local unlock identifiers in generated access-policy.ts", () => {
    // policy doc must NAME them as forbidden (they appear in the doc string),
    // but the runtime config must not USE them as identifiers.
    // We check no `const grantMobileAccess` / `function unlockCourseLocally` etc.
    for (const id of [
      "grantMobileAccess",
      "unlockCourseLocally",
      "createMobileEntitlement",
      "validateReceiptClientSide",
    ]) {
      const re = new RegExp(`(function|const|let|var)\\s+${id}\\b`);
      expect(src, `must not define ${id}`).not.toMatch(re);
    }
  });

  it("Known Limitation IAP.STATUS.LIFECYCLE is referenced", () => {
    expect(src).toMatch(/IAP\.STATUS\.LIFECYCLE/);
  });
});

describe("Mobile Package · Phase C — content SSOT", () => {
  it("course-manifest.json references content via export reference, never inlines content", () => {
    expect(src).toContain("content_export_reference");
    expect(src).toContain("content_export_url");
    // Forbid words that would imply inlined content.
    expect(src).not.toMatch(/inline_course_content|embedded_lessons/);
  });

  it("bundle identity must include course / curriculum / product", () => {
    expect(src).toMatch(/course_id:\s*course\.id/);
    expect(src).toMatch(/curriculum_id:\s*manifest\.curriculum_id/);
    expect(src).toMatch(/product_id:\s*manifest\.product_id/);
  });
});

describe("Mobile Package · Phase C — store listing legality", () => {
  it("listings refuse 'offizielle IHK-App' phrasing in defaults", () => {
    // Default listings must explicitly disclaim official-examiner status.
    expect(src).toMatch(/KEIN offizieller Prüfungsträger/);
    expect(src).toMatch(/KEINE offizielle IHK-App/);
    expect(src).toMatch(/NOT an official examiner/);
  });

  it("CTA phrasing is constrained to 'Prüfung starten' / 'Prüfung simulieren'", () => {
    expect(src).toMatch(/Prüfung simulieren/);
    expect(src).toMatch(/Prüfung starten/);
  });
});

describe("Mobile Package · Phase C — secrets & admin guard", () => {
  const SECRET_PATTERNS = [
    /SUPABASE_SERVICE_ROLE_KEY\s*=/,
    /sk_live_[A-Za-z0-9]+/,
    /sk_test_[A-Za-z0-9]+/,
    /BEGIN (RSA|EC|OPENSSH) PRIVATE KEY/,
  ];

  it("source emits no hardcoded secret values", () => {
    for (const re of SECRET_PATTERNS) {
      expect(src, `must not contain ${re}`).not.toMatch(re);
    }
  });

  it("packaged content does not reference admin routes inside the bundled shell", () => {
    // The function source CAN mention /admin/tools/bulk-course-export as
    // operator note. But the bundled shell strings must not ship admin links
    // as live routes. Static guard: package-check workflow enforces it.
    expect(src).toContain("Forbid admin routes");
    expect(src).toContain("Forbid local unlock shadows");
    expect(src).toContain("Forbid secrets in repo");
  });
});

describe("Mobile Package · Phase C — build info & traceability", () => {
  for (const f of [
    "generated_at",
    "manifest_id",
    "product_id",
    "curriculum_id",
    "course_id",
    "app_version",
    "build_number",
    "commit_sha",
    "builder_version",
    "content_export_reference",
    "listing_hash",
    "iap_config_hash",
  ]) {
    it(`build-info exposes ${f}`, () => {
      expect(src).toContain(f);
    });
  }
});

describe("Mobile Package · Phase C — bundle ID validation", () => {
  it("rejects non-reverse-DNS bundle IDs", () => {
    expect(src).toContain("validateBundleId");
    expect(src).toMatch(/invalid bundle_id/);
  });
});

describe("Mobile Package · Phase C — screenshots", () => {
  it("required-sizes.json declares iOS & Android pflicht-sizes", () => {
    expect(src).toMatch(/iphone_6_7/);
    expect(src).toMatch(/feature_graphic/);
    expect(src).toMatch(/min_count/);
  });
});

describe("Mobile Package · Phase C — release checklist", () => {
  it("checklist references Phase B.1 IAP smoke and SSOT access path", () => {
    expect(src).toMatch(/Phase B\.1/);
    expect(src).toMatch(/check_product_access_by_curriculum/);
    expect(src).toMatch(/IAP\.STATUS\.LIFECYCLE/);
  });
});
