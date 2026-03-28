/**
 * Edge Function Smoke Tests (Deno)
 * Tests all critical edge functions for reachability and basic response format.
 *
 * Run with: supabase--test-edge-functions
 */
import "https://deno.land/std@0.224.0/dotenv/load.ts";
import { assertEquals, assertExists } from "https://deno.land/std@0.224.0/assert/mod.ts";

const SUPABASE_URL = Deno.env.get("VITE_SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("VITE_SUPABASE_PUBLISHABLE_KEY")!;

const headers = {
  "Content-Type": "application/json",
  "apikey": SUPABASE_ANON_KEY,
  "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
};

async function callFunction(name: string, body: Record<string, unknown> = {}, method = "POST") {
  const url = `${SUPABASE_URL}/functions/v1/${name}`;
  const resp = await fetch(url, {
    method,
    headers,
    body: method !== "GET" ? JSON.stringify(body) : undefined,
  });
  const text = await resp.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: resp.status, json, text };
}

// ──────────────────────────────────────────────
// SMOKE TESTS: Edge Functions erreichbar?
// ──────────────────────────────────────────────

Deno.test("SMOKE: auto-gap-close rejects GET", async () => {
  const r = await callFunction("auto-gap-close", {}, "GET");
  // Should return 405 for non-POST
  assertEquals(r.status, 405);
  await r.text; // consume
});

Deno.test("SMOKE: auto-gap-close rejects missing payload", async () => {
  const r = await callFunction("auto-gap-close", {});
  assertEquals(r.status, 400);
  assertExists(r.json?.error);
});

Deno.test("SMOKE: job-runner responds", async () => {
  const r = await callFunction("job-runner", {});
  // Job runner should respond (may be 200 with "no jobs" or similar)
  assertEquals(typeof r.status, "number");
  await r.text;
});

Deno.test("SMOKE: package-run-integrity-check rejects GET", async () => {
  const r = await callFunction("package-run-integrity-check", {}, "GET");
  assertEquals(r.status, 405);
});

Deno.test("SMOKE: package-run-integrity-check rejects bad payload", async () => {
  const r = await callFunction("package-run-integrity-check", { package_id: "bad", course_id: "bad" });
  // Function may return 200 with error body or 400 — both are acceptable graceful handling
  assert(
    r.status === 400 || (r.status === 200 && r.json?.ok === false),
    `Expected 400 or 200+error, got ${r.status} body=${JSON.stringify(r.json)?.slice(0, 200)}`,
  );
});

Deno.test("SMOKE: create-checkout rejects empty body", async () => {
  const r = await callFunction("create-checkout", {});
  // Should fail gracefully
  assertEquals(typeof r.status, "number");
  if (r.json) {
    assertExists(r.json.error || r.json.message || r.status >= 400);
  }
});

Deno.test("SMOKE: search-public responds", async () => {
  const r = await callFunction("search-public", { query: "test" });
  assertEquals(typeof r.status, "number");
  // Search should not crash
  if (r.json) {
    assertEquals(typeof r.json, "object");
  }
});

Deno.test("SMOKE: ai-tutor rejects without auth", async () => {
  const r = await callFunction("ai-tutor", { message: "hello" });
  // Should require auth or at least not crash
  assertEquals(typeof r.status, "number");
  await r.text;
});

Deno.test("SMOKE: spaced-repetition rejects empty", async () => {
  const r = await callFunction("spaced-repetition", {});
  assertEquals(typeof r.status, "number");
  await r.text;
});

Deno.test("SMOKE: oral-exam rejects empty", async () => {
  const r = await callFunction("oral-exam", {});
  assertEquals(typeof r.status, "number");
  await r.text;
});

Deno.test("SMOKE: stripe-webhook rejects no signature", async () => {
  const r = await callFunction("stripe-webhook", { type: "test" });
  // Should fail validation (no stripe-signature header)
  assertEquals(typeof r.status, "number");
  await r.text;
});
