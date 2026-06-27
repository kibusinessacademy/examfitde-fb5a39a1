/**
 * STORE.PUBLISH.ORCHESTRATION.OS.1 — No-Publish Guard for the orchestration layer.
 *
 * Hard guards: the orchestration module and its edge functions must NOT include
 * production-publish, submission, release, or rollout APIs.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(__dirname, "..", "..", "..");

const SCAN_DIRS = [
  "src/lib/storeRelease",
  "src/pages/admin/storeReleaseCenter/ReleaseOrchestrationCard.tsx",
  "src/pages/admin/storeReleaseCenter/ReleaseOrchestrationCenter.tsx",
  "supabase/functions/create-store-release-candidate",
  "supabase/functions/invalidate-store-release-candidate",
  "supabase/functions/approve-store-release",
  "supabase/functions/export-store-submission-package",
  "supabase/functions/_shared/storeRelease",
];

const FORBIDDEN = [
  "submitForReview",
  "appStoreVersionReleaseRequest",
  "publishProductionTrack",
  "GOOGLE_PLAY_PRODUCTION",
  "production-publish",
  "androidpublisher.googleapis.com",
  "api.appstoreconnect.apple.com",
];

function walk(dir: string, acc: string[] = []): string[] {
  const st = statSync(dir, { throwIfNoEntry: false } as any);
  if (!st) return acc;
  if (st.isFile()) { acc.push(dir); return acc; }
  if (!st.isDirectory()) return acc;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const sub = statSync(full);
    if (sub.isDirectory()) walk(full, acc);
    else if (/\.(ts|tsx)$/.test(entry)) acc.push(full);
  }
  return acc;
}

describe("STORE.PUBLISH.ORCHESTRATION.OS.1 — no-publish guard", () => {
  it("contains no production-publish/submission APIs", () => {
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

  it("admin orchestration UI exposes only the four allowed actions", () => {
    const src = readFileSync(
      resolve(root, "src/pages/admin/storeReleaseCenter/ReleaseOrchestrationCard.tsx"),
      "utf8",
    );
    expect(src).toContain("create-store-release-candidate");
    expect(src).toContain("invalidate-store-release-candidate");
    expect(src).toContain("approve-store-release");
    expect(src).toContain("export-store-submission-package");
    // The UI must never offer a publish/submit/release button label.
    // Strip line comments before scanning so doc-strings don't trip the guard.
    const code = src.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
    expect(code.toLowerCase()).not.toMatch(/publish to (app store|play store|production)/);
    expect(code).not.toMatch(/submitForReview/);
    expect(code).not.toMatch(/\brollout\b/i);
  });
});
