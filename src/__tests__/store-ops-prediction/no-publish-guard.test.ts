/**
 * STORE.OPS.PREDICTION.OS.1 — No-publish guard.
 * Scans SSOT, edge function, and UI for forbidden symbols, secrets, and store APIs.
 * Ensures the feature remains a read-only predictive layer with no new write paths.
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
  "src/lib/storeOpsPrediction",
  "supabase/functions/_shared/storeOpsPrediction",
  "supabase/functions/predict-store-ops",
  "src/pages/admin/storeReleaseCenter/StoreOpsPredictionCard.tsx",
];

const SSOT_ROOTS = ["src/lib/storeOpsPrediction", "supabase/functions/_shared/storeOpsPrediction"];

describe("STORE.OPS.PREDICTION.OS.1 — no publish guard", () => {
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

  it("policy never references forbidden tokens as string literals outside the allow-list", () => {
    const src = readFileSync("src/lib/storeOpsPrediction/contracts.ts", "utf8");
    // Forbidden tokens may appear in the FORBIDDEN_PREDICTION_ACTIONS allow-list of denied actions, that's expected.
    // Ensure they are not also used elsewhere as e.g. recommendation codes — there is no recommendation engine here.
    for (const tok of FORBIDDEN_RECO_TOKENS) {
      const allowedListContext = `"${tok}"`;
      const matches = src.match(new RegExp(allowedListContext, "g")) ?? [];
      // Exactly one occurrence is allowed — inside FORBIDDEN_PREDICTION_ACTIONS.
      expect(matches.length).toBeLessThanOrEqual(1);
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

  it("edge function only writes to prediction tables (no new write paths)", () => {
    const src = readFileSync("supabase/functions/predict-store-ops/index.ts", "utf8");
    const insertMatches = src.match(/\.from\(["']([^"']+)["']\)[\s\n]*\.insert\(/g) ?? [];
    const allowed = new Set([
      "store_ops_prediction_runs",
      "store_ops_prediction_results",
      "security_events",
    ]);
    for (const m of insertMatches) {
      const table = m.match(/["']([^"']+)["']/)![1];
      expect(allowed.has(table), `unexpected write path: ${table}`).toBe(true);
    }
  });

  it("edge function never updates or deletes prediction tables (append-only)", () => {
    const src = readFileSync("supabase/functions/predict-store-ops/index.ts", "utf8");
    expect(src).not.toMatch(/store_ops_prediction_(runs|results)["']\)\s*\.(update|delete)\(/);
  });

  it("edge function does not mutate existing autopilot / intelligence / kpi tables", () => {
    const src = readFileSync("supabase/functions/predict-store-ops/index.ts", "utf8");
    for (const t of [
      "store_ops_autopilot_runs",
      "store_ops_autopilot_actions",
      "store_ops_kpi_snapshots",
      "store_ops_intelligence_runs",
      "store_ops_intelligence_findings",
      "store_ops_batches",
      "store_ops_batch_items",
    ]) {
      expect(src).not.toMatch(new RegExp(`from\\(["']${t}["']\\)[\\s\\n]*\\.(insert|update|delete)\\(`));
    }
  });

  it("UI invokes only the predict-store-ops edge function", () => {
    const raw = readFileSync(
      "src/pages/admin/storeReleaseCenter/StoreOpsPredictionCard.tsx",
      "utf8",
    );
    const invokes = raw.match(/functions\.invoke\(["']([^"']+)["']/g) ?? [];
    for (const m of invokes) {
      const fn = m.match(/["']([^"']+)["']/)![1];
      expect(fn, `unexpected edge function invocation: ${fn}`).toBe("predict-store-ops");
    }
  });

  it("UI source contains no Publish/Submit/Rollout/Approve button labels", () => {
    const raw = readFileSync(
      "src/pages/admin/storeReleaseCenter/StoreOpsPredictionCard.tsx",
      "utf8",
    );
    // Strip comments before scanning visible labels / handler names.
    const stripped = raw.replace(/\/\/[^\n]*\n/g, "\n").replace(/\/\*[\s\S]*?\*\//g, "");
    for (const tok of ["Publish", "Submit", "Rollout", "Approve", "Bypass"]) {
      expect(stripped, `forbidden token: ${tok}`).not.toContain(tok);
    }
  });
});
