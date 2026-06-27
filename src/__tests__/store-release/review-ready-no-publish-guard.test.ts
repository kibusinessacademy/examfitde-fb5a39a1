/**
 * REVIEW.READY.GATE.OS.1 — No-Publish Guard
 *
 * Stellt sicher, dass weder UI noch Edge Functions Production-Publish-/
 * Release-/submitForReview-Pfade einführen.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(__dirname, "..", "..", "..");

const SCAN_DIRS = [
  "src/pages/admin/storeReleaseCenter",
  "src/pages/admin/StoreReleaseCenterPage.tsx",
  "src/lib/storeReviewReady",
  "supabase/functions/evaluate-store-review-ready",
];

const FORBIDDEN = [
  "submitForReview",
  "appStoreVersionReleaseRequest",
  "publishProductionTrack",
  "GOOGLE_PLAY_PRODUCTION",
  "production-publish",
];

function walk(dir: string, acc: string[] = []): string[] {
  if (!statSync(dir, { throwIfNoEntry: false } as any)?.isDirectory()) {
    if (statSync(dir, { throwIfNoEntry: false } as any)?.isFile()) acc.push(dir);
    return acc;
  }
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, acc);
    else if (/\.(ts|tsx)$/.test(entry)) acc.push(full);
  }
  return acc;
}

describe("REVIEW.READY.GATE.OS.1 — no-publish guard", () => {
  it("contains no production-publish APIs", () => {
    const files = SCAN_DIRS.flatMap((p) => walk(resolve(root, p)));
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      for (const needle of FORBIDDEN) {
        if (src.includes(needle)) offenders.push(`${f} → ${needle}`);
      }
    }
    expect(offenders, offenders.join("\n")).toHaveLength(0);
  });
});
