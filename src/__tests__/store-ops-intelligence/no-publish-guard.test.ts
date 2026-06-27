/**
 * STORE.OPS.INTELLIGENCE.OS.1 — No-publish guard.
 * Scans SSOT, edge function and UI for forbidden symbols, secrets, store APIs.
 * Ensures the feature stays read-only with no new write paths.
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
  "APPLE_API_KEY",
  "PLAY_SERVICE_ACCOUNT",
];

const FORBIDDEN_RECO_TOKENS = ["publish", "submit_for_review", "production_rollout", "approve", "bypass_review"];

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
  "src/lib/storeOpsIntelligence",
  "supabase/functions/_shared/storeOpsIntelligence",
  "supabase/functions/analyze-store-ops",
  "src/pages/admin/storeReleaseCenter/StoreOpsIntelligenceCard.tsx",
];

const SSOT_ROOTS = ["src/lib/storeOpsIntelligence", "supabase/functions/_shared/storeOpsIntelligence"];

describe("STORE.OPS.INTELLIGENCE.OS.1 — no publish guard", () => {
  for (const root of ROOTS) {
    it(`is free of forbidden publishing / store API symbols: ${root}`, () => {
      let files: string[] = [];
      try {
        files = statSync(root).isDirectory() ? walk(root) : [root];
      } catch {
        return;
      }
      for (const f of files) {
        const src = readFileSync(f, "utf8");
        for (const sym of FORBIDDEN) {
          expect(src, `${f} contains forbidden symbol ${sym}`).not.toContain(sym);
        }
      }
    });
  }

  it("recommendation engine never references forbidden recommendation tokens as values", () => {
    const src = readFileSync("src/lib/storeOpsIntelligence/recommendation-engine.ts", "utf8");
    for (const tok of FORBIDDEN_RECO_TOKENS) {
      // Allow comments / type names; forbid string-literal usage like "publish".
      expect(src).not.toMatch(new RegExp(`["']${tok}["']`));
    }
  });

  it("SSOT modules have no DB / HTTP / clock / RNG / fetch usage", () => {
    for (const root of SSOT_ROOTS) {
      const files = walk(root);
      for (const f of files) {
        const src = readFileSync(f, "utf8");
        expect(src, `${f} uses fetch`).not.toMatch(/\bfetch\s*\(/);
        expect(src, `${f} uses Math.random`).not.toMatch(/Math\.random\(/);
        expect(src, `${f} uses Date.now`).not.toMatch(/Date\.now\(/);
        expect(src, `${f} instantiates new Date()`).not.toMatch(/new Date\(\)/);
        expect(src, `${f} imports supabase client`).not.toMatch(/from\s+["']@supabase\/supabase-js/);
        expect(src, `${f} imports app supabase client`).not.toMatch(/@\/integrations\/supabase\/client/);
      }
    }
  });

  it("edge function only writes to intelligence tables (no new write paths)", () => {
    const src = readFileSync("supabase/functions/analyze-store-ops/index.ts", "utf8");
    const insertMatches = src.match(/\.from\(["']([^"']+)["']\)\s*\.insert\(/g) ?? [];
    const allowed = new Set([
      'from("store_ops_intelligence_runs").insert(',
      'from("store_ops_intelligence_findings").insert(',
      'from("security_events").insert(',
    ]);
    for (const m of insertMatches) {
      expect(allowed.has(m), `unexpected write path: ${m}`).toBe(true);
    }
  });

  it("edge function never updates or deletes intelligence tables (append-only)", () => {
    const src = readFileSync("supabase/functions/analyze-store-ops/index.ts", "utf8");
    expect(src).not.toMatch(/store_ops_intelligence_(runs|findings)["']\)\s*\.(update|delete)\(/);
  });

  it("UI exposes no publish / submit / rollout buttons", () => {
    const src = readFileSync("src/pages/admin/storeReleaseCenter/StoreOpsIntelligenceCard.tsx", "utf8");
    expect(src.toLowerCase()).not.toMatch(/publish|submit|rollout/);
  });
});
