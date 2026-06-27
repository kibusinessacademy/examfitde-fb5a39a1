import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * STORE.LIFECYCLE.OS.1 — No-Publish Guard.
 * Scans the lifecycle SSOT + edge functions for forbidden Store-API publishing symbols.
 */
const ROOT = process.cwd();
const FILES = [
  "src/lib/storeLifecycle/contracts.ts",
  "src/lib/storeLifecycle/lifecycleState.ts",
  "src/lib/storeLifecycle/storeFeedback.ts",
  "src/lib/storeLifecycle/rollbackPolicy.ts",
  "src/lib/storeLifecycle/versionPolicy.ts",
  "src/lib/storeLifecycle/lifecycleProjection.ts",
  "src/lib/storeLifecycle/audit.ts",
  "supabase/functions/record-store-feedback/index.ts",
  "supabase/functions/project-store-lifecycle/index.ts",
];

const FORBIDDEN = [
  "submitForReview",
  "appStoreVersionReleaseRequest",
  "publishOnApprove",
  "rollOutToProduction",
  "production_track",
  "androidpublisher.edits.commit",
  "appstoreconnect.apple.com/v1/appStoreVersions",
];

describe("STORE.LIFECYCLE.OS.1 — no-publish guard", () => {
  for (const rel of FILES) {
    it(`${rel} contains no publishing symbols`, () => {
      const src = readFileSync(join(ROOT, rel), "utf8");
      for (const sym of FORBIDDEN) {
        expect(src.includes(sym), `Forbidden symbol "${sym}" found in ${rel}`).toBe(false);
      }
    });
  }
});
