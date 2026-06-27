import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * STORE.OPS.KPI.OS.1 — No-Publish + Guard surface.
 * Tests 18–28, 35 from the mission acceptance list.
 */
const ROOT = process.cwd();
const SSOT_FILES = [
  "src/lib/storeOpsKpi/contracts.ts",
  "src/lib/storeOpsKpi/metrics.ts",
  "src/lib/storeOpsKpi/risk.ts",
  "src/lib/storeOpsKpi/bottlenecks.ts",
  "src/lib/storeOpsKpi/projection.ts",
  "src/lib/storeOpsKpi/audit.ts",
  "supabase/functions/evaluate-store-ops-kpi/index.ts",
];
const UI_FILE = "src/pages/admin/storeReleaseCenter/StoreOpsHealthCard.tsx";

const FORBIDDEN = [
  "submitForReview",
  "appStoreVersionReleaseRequest",
  "publishRelease",
  "rolloutRelease",
  "production_track",
  "androidpublisher.edits.commit",
  "appstoreconnect.apple.com/v1/appStoreVersions",
  "track: production",
];

const FORBIDDEN_SECRETS = [
  "GOOGLE_PLAY_SERVICE_ACCOUNT_JSON",
  "APP_STORE_CONNECT_API_KEY",
  "GITHUB_TOKEN",
];

const FORBIDDEN_IAP = [
  "validate-iap-receipt",
  "store_receipts",
  "entitlements",
];

const FORBIDDEN_CLIENT_TABLES = [
  "store_lifecycle_events",
  "store_release_candidates",
  "store_release_builds",
];

describe("STORE.OPS.KPI.OS.1 — guards", () => {
  for (const rel of SSOT_FILES) {
    it(`18-21. ${rel} contains no publishing/iap symbols`, () => {
      const src = readFileSync(join(ROOT, rel), "utf8");
      for (const sym of FORBIDDEN) {
        expect(src.includes(sym), `Forbidden publishing symbol "${sym}" in ${rel}`).toBe(false);
      }
      for (const sym of FORBIDDEN_IAP) {
        // Edge function may invoke other tables but must not touch IAP surfaces.
        expect(src.includes(sym), `Forbidden IAP symbol "${sym}" in ${rel}`).toBe(false);
      }
    });
  }

  it("22. SSOT modules contain no entitlement grant symbols", () => {
    for (const rel of SSOT_FILES.filter((f) => f.startsWith("src/lib/storeOpsKpi"))) {
      const src = readFileSync(join(ROOT, rel), "utf8");
      expect(src).not.toMatch(/grantMobileAccess|createMobileEntitlement|unlockCourseLocally/);
    }
  });

  it("24/25. UI shows no publish buttons and only invokes evaluate-store-ops-kpi", () => {
    const src = readFileSync(join(ROOT, UI_FILE), "utf8");
    expect(src).not.toMatch(/Veröffentlichen|Submit|Publish|Rollout|Production/i);
    expect(src.match(/functions\.invoke\("([a-z-]+)"/g) ?? []).toEqual([
      'functions.invoke("evaluate-store-ops-kpi"',
    ]);
  });

  it("26-27. No raw payloads / secrets in client", () => {
    const src = readFileSync(join(ROOT, UI_FILE), "utf8");
    for (const s of FORBIDDEN_SECRETS) {
      expect(src.includes(s), `Forbidden secret "${s}" in UI`).toBe(false);
    }
  });

  it("28. UI does not directly read sensitive tables", () => {
    const src = readFileSync(join(ROOT, UI_FILE), "utf8");
    for (const t of FORBIDDEN_CLIENT_TABLES) {
      expect(src.includes(`.from("${t}"`)).toBe(false);
      expect(src.includes(`.from('${t}'`)).toBe(false);
    }
  });

  it("35. memory leaf exists and documents scope", () => {
    const memo = readFileSync(
      join(ROOT, ".lovable/memory/features/store-ops-kpi-os-1.md"),
      "utf8",
    );
    expect(memo).toMatch(/STORE\.OPS\.KPI\.OS\.1/);
    expect(memo).toMatch(/health_score|Health Score/);
    expect(memo).toMatch(/no publish|Kein Store-API|Kein Publishing|no Store API/i);
  });
});
