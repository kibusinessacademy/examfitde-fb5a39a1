/**
 * STORE.OPS.BATCH.OS.1 — No-publish guard.
 * Scans SSOT, edge functions and UI for forbidden publishing symbols.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const FORBIDDEN = [
  "submitForReview",
  "publishRelease",
  "rolloutRelease",
  "appStoreVersionReleaseRequest",
  "production_track",
  "googleapis.com/androidpublisher",
  "api.appstoreconnect.apple.com",
  "GITHUB_TOKEN",
  "APPLE_API_KEY",
  "PLAY_SERVICE_ACCOUNT",
];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    const s = statSync(p);
    if (s.isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx)$/.test(p)) out.push(p);
  }
  return out;
}

const ROOTS = [
  "src/lib/storeOpsBatch",
  "supabase/functions/_shared/storeOpsBatch",
  "supabase/functions/plan-store-ops-batch",
  "supabase/functions/record-store-ops-batch-result",
  "src/pages/admin/storeReleaseCenter/StoreOpsBatchCard.tsx",
];

describe("STORE.OPS.BATCH.OS.1 — no publish guard", () => {
  for (const root of ROOTS) {
    it(`is free of forbidden publishing/secret symbols: ${root}`, () => {
      let files: string[] = [];
      try {
        files = statSync(root).isDirectory() ? walk(root) : [root];
      } catch {
        return;
      }
      for (const f of files) {
        const src = readFileSync(f, "utf8");
        for (const needle of FORBIDDEN) {
          expect(src.includes(needle), `${needle} found in ${f}`).toBe(false);
        }
      }
    });
  }

  it("SSOT module has no DB/HTTP/clock/RNG calls", () => {
    for (const f of walk("src/lib/storeOpsBatch")) {
      const src = readFileSync(f, "utf8");
      expect(src).not.toMatch(/\bfetch\(/);
      expect(src).not.toMatch(/createClient\(/);
      expect(src).not.toMatch(/Math\.random\(/);
      expect(src).not.toMatch(/new Date\(\)/);
    }
  });
});
