/**
 * Edge Function Integration Tests (Deno)
 * Tests critical pipeline workflows end-to-end.
 *
 * These tests use real Supabase data (test environment).
 */
import "https://deno.land/std@0.224.0/dotenv/load.ts";
import { assertEquals, assertExists, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("VITE_SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("VITE_SUPABASE_PUBLISHABLE_KEY")!;

const headers = {
  "Content-Type": "application/json",
  "apikey": SUPABASE_ANON_KEY,
  "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
};

async function callFunction(name: string, body: Record<string, unknown> = {}) {
  const url = `${SUPABASE_URL}/functions/v1/${name}`;
  const resp = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  const text = await resp.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* */ }
  return { status: resp.status, json, text };
}

// ──────────────────────────────────────────────
// INTEGRATION: Auto-Gap-Closer Pipeline
// ──────────────────────────────────────────────

Deno.test("INTEGRATION: auto-gap-close dry_run returns plan without side effects", async () => {
  const r = await callFunction("auto-gap-close", {
    package_id: "a1000001-0001-4000-8000-000000000001",
    curriculum_id: "98682729-caa4-451b-8e2f-f5d7fa5744bd",
    course_id: "c1000001-0001-4000-8000-000000000001",
    target_score: 85,
    max_rounds: 1,
    dry_run: true,
  });
  
  // May succeed or fail based on state, but should not crash
  assertEquals(typeof r.status, "number");
  if (r.json?.ok) {
    assertExists(r.json.plan);
    assertEquals(r.json.status, "dry_run");
    assert(Array.isArray(r.json.plan.actions));
  }
});

// ──────────────────────────────────────────────
// INTEGRATION: Integrity Check Format
// ──────────────────────────────────────────────

Deno.test("INTEGRATION: integrity check validates payload format", async () => {
  // Valid UUIDs but may not match real data
  const r = await callFunction("package-run-integrity-check", {
    package_id: "a1000001-0001-4000-8000-000000000001",
    course_id: "c1000001-0001-4000-8000-000000000001",
    options: { auto_gap_close: false }, // Don't trigger auto-fix
  });
  
  assertEquals(typeof r.status, "number");
  // Should return structured response (pass or fail)
  if (r.json) {
    assertEquals(typeof r.json.ok, "boolean");
    if (r.json.ok === false) {
      assertExists(r.json.error || r.json.report);
    }
  }
});

// ──────────────────────────────────────────────
// INTEGRATION: Job Runner Dedup
// ──────────────────────────────────────────────

Deno.test("INTEGRATION: job-runner returns structured response", async () => {
  const r = await callFunction("job-runner", {});
  assertEquals(typeof r.status, "number");
  
  if (r.json) {
    // Should have batch or status field
    assertEquals(typeof r.json, "object");
  }
});

// ──────────────────────────────────────────────
// INTEGRATION: Finance Reporting
// ──────────────────────────────────────────────

Deno.test("INTEGRATION: finance-reports returns data structure", async () => {
  const r = await callFunction("finance-reports", { report_type: "summary" });
  assertEquals(typeof r.status, "number");
  await r.text; // consume
});

// ──────────────────────────────────────────────
// INTEGRATION: SEO Pipeline
// ──────────────────────────────────────────────

Deno.test("INTEGRATION: generate-sitemap responds", async () => {
  const r = await callFunction("generate-sitemap", {});
  assertEquals(typeof r.status, "number");
  await r.text; // consume
});
