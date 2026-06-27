/**
 * Contract test for Store Release Center (Foundation).
 *
 * Asserts that the new store_release_* persistence layer is wired correctly and
 * not duplicating existing SSOTs:
 *   - StoreReleaseCenterPage uses the v_admin_store_release_status view
 *   - The page invokes the two new edge functions (no direct text generation in UI)
 *   - The runner script writes to store_release_screenshots (single source of truth)
 *   - No direct calls to Apple/Google APIs from client code
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const PAGE = join(ROOT, "src/pages/admin/StoreReleaseCenterPage.tsx");
const RUNNER = join(ROOT, "scripts/store-screenshots-runner.mjs");
const WORKFLOW = join(ROOT, ".github/workflows/store-screenshots.yml");
const FN_PERSIST = join(ROOT, "supabase/functions/store-listing-persist/index.ts");
const FN_ENQUEUE = join(ROOT, "supabase/functions/store-screenshots-enqueue/index.ts");

describe("Store Release Center — Foundation contract", () => {
  it("admin page reads from the status view, not the raw tables", () => {
    const src = readFileSync(PAGE, "utf8");
    expect(src).toContain("v_admin_store_release_status");
  });

  it("admin page invokes the two new edge functions and no others for store text", () => {
    const src = readFileSync(PAGE, "utf8");
    expect(src).toMatch(/functions\.invoke\(["']store-listing-persist["']/);
    expect(src).toMatch(/functions\.invoke\(["']store-screenshots-enqueue["']/);
    // Must not call the raw LLM generator from the UI (that's now wrapped server-side)
    expect(src).not.toMatch(/functions\.invoke\(["']generate-store-listing["']/);
  });

  it("persist function delegates to generate-store-listing and writes only to store_release_listings", () => {
    const src = readFileSync(FN_PERSIST, "utf8");
    expect(src).toContain("generate-store-listing");
    expect(src).toContain("store_release_listings");
    expect(src).toContain("source_hash"); // idempotency key present
  });

  it("enqueue function writes to the audit run + pending shots tables", () => {
    const src = readFileSync(FN_ENQUEUE, "utf8");
    expect(src).toContain("store_release_screenshot_runs");
    expect(src).toContain("store_release_screenshots");
  });

  it("github workflow exists and guards on required secrets", () => {
    expect(existsSync(WORKFLOW)).toBe(true);
    const src = readFileSync(WORKFLOW, "utf8");
    expect(src).toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(src).toContain("STORE_SHOTS_TARGET_URL");
    expect(src).toContain("Workflow exiting cleanly (no-op)");
  });

  it("runner writes results to the screenshots SSOT table", () => {
    const src = readFileSync(RUNNER, "utf8");
    expect(src).toContain("store_release_screenshots");
    expect(src).toContain("store_release_screenshot_runs");
    // Must not POST to Apple/Google directly from runner
    expect(src).not.toMatch(/api\.appstoreconnect\.apple\.com/);
    expect(src).not.toMatch(/androidpublisher\.googleapis\.com/);
  });
});
